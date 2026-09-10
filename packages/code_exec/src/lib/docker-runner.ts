export {
  DockerRunner,
}

import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type { Result } from "common";
import type { RunnerConfig } from "#lib/config.js";
import type {
  CodeExecutor,
  ExecFailure,
  ExecOutcome,
  ExecRequest,
} from "#lib/execution.js";
import { CappedCollector } from "#lib/capped-collector.js";
import {
  build_kill_argv,
  build_rm_argv,
  build_run_argv,
  build_sweep_ps_argv,
} from "#lib/docker-args.js";

const _exec_file = promisify(execFile);

// docker's own exit code, distinct from the program's.
const DOCKER_CLI_FAILURE = 125;

// Grace period after the kill before force-removing and giving up.
const BACKSTOP_MS = 5000;

// Runs code in one-shot hardened containers on the host docker daemon.
class DockerRunner implements CodeExecutor {
  private readonly _cfg: RunnerConfig;

  constructor(cfg: RunnerConfig) {
    this._cfg = cfg;
  }

  // Spawn one container, feed stdin, collect capped output, kill on timeout.
  async run(req: ExecRequest): Promise<Result<ExecOutcome, ExecFailure>> {
    const name = `code-exec-${randomUUID()}`;
    const code_b64 = Buffer.from(req.code, "utf8").toString("base64");
    const stdout = new CappedCollector(this._cfg.max_output_bytes);
    const stderr = new CappedCollector(this._cfg.max_output_bytes);
    const started = performance.now();
    const child = spawn("docker", build_run_argv(this._cfg, name, code_b64));

    // EPIPE when the program exits without reading stdin is not an error.
    child.stdin?.on("error", () => {});
    child.stdin?.write(req.stdin ?? "");
    child.stdin?.end();
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));

    let timed_out = false;
    const kill_timer = setTimeout(() => {
      timed_out = true;
      execFile("docker", build_kill_argv(name), () => {});
    }, this._cfg.timeout_ms);
    const backstop_timer = setTimeout(() => {
      execFile("docker", build_rm_argv([name]), () => {});
      child.kill("SIGKILL");
    }, this._cfg.timeout_ms + BACKSTOP_MS);

    return await new Promise((resolve) => {
      let settled = false;
      function __settle(result: Result<ExecOutcome, ExecFailure>): void {
        if (settled) return;
        settled = true;
        clearTimeout(kill_timer);
        clearTimeout(backstop_timer);
        resolve(result);
      }

      child.on("error", (err) => {
        __settle({ ok: false, error: { kind: "spawn_failure", message: err.message } });
      });
      child.on("close", (code) => {
        const duration_ms = Math.round(performance.now() - started);
        if (code === DOCKER_CLI_FAILURE && !timed_out) {
          __settle({ ok: false, error: { kind: "docker_error", message: stderr.text().trim() } });
          return;
        }
        __settle({
          ok: true,
          value: {
            exit_code: code ?? -1,
            stdout: stdout.text(),
            stderr: stderr.text(),
            stdout_truncated: stdout.truncated,
            stderr_truncated: stderr.truncated,
            timed_out,
            duration_ms,
          },
        });
      });
    });
  }

  // Remove leftover runner containers; returns how many were removed.
  async sweep_orphans(): Promise<number> {
    const listing = await _exec_file("docker", build_sweep_ps_argv());
    const ids = listing.stdout
      .split("\n")
      .map((id) => id.trim())
      .filter((id) => id !== "");
    if (ids.length === 0) {
      return 0;
    }
    await _exec_file("docker", build_rm_argv(ids));
    return ids.length;
  }
}
