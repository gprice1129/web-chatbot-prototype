import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunnerConfig } from "#lib/config.js";
import {
  build_run_argv,
  build_kill_argv,
  build_sweep_ps_argv,
  build_rm_argv,
} from "#lib/docker-args.js";

const CFG: RunnerConfig = {
  image: "aim-hi-code-runner-python:3.13",
  runtime: undefined,
  timeout_ms: 10000,
  max_output_bytes: 262144,
  memory_mb: 256,
  cpus: "1.0",
  pids_limit: 128,
  workspace_mb: 64,
  tmp_mb: 16,
};

// Golden argv: any change to the sandbox flags must show up as a test diff.
test("renders the full hardened run argv", () => {
  assert.deepEqual(build_run_argv(CFG, "code-exec-abc", "cHJpbnQoKQ=="), [
    "run", "--rm", "-i",
    "--name", "code-exec-abc",
    "--label", "aim-hi-code-exec=1",
    "--pull", "never",
    "--init",
    "--network", "none",
    "--read-only",
    "--tmpfs", "/workspace:rw,nosuid,nodev,noexec,size=64m,mode=1777",
    "--tmpfs", "/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777",
    "--user", "65534:65534",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", "128",
    "--memory", "256m",
    "--memory-swap", "256m",
    "--cpus", "1.0",
    "--stop-timeout", "2",
    "-e", "CODE_B64=cHJpbnQoKQ==",
    "aim-hi-code-runner-python:3.13",
  ]);
});

test("appends --runtime before the image only when configured", () => {
  const argv = build_run_argv({ ...CFG, runtime: "runsc" }, "n", "YQ==");
  const runtime_at = argv.indexOf("--runtime");
  assert.notEqual(runtime_at, -1);
  assert.equal(argv[runtime_at + 1], "runsc");
  assert.equal(argv[argv.length - 1], CFG.image);
  assert.equal(build_run_argv(CFG, "n", "YQ==").includes("--runtime"), false);
});

test("kill targets the container by name", () => {
  assert.deepEqual(build_kill_argv("code-exec-abc"), ["kill", "code-exec-abc"]);
});

test("sweep lists all containers with the runner label", () => {
  assert.deepEqual(build_sweep_ps_argv(),
    ["ps", "-aq", "--filter", "label=aim-hi-code-exec=1"]);
});

test("rm force-removes the given ids", () => {
  assert.deepEqual(build_rm_argv(["a1", "b2"]), ["rm", "-f", "a1", "b2"]);
});
