export {
  CONTAINER_LABEL,
  build_run_argv,
  build_kill_argv,
  build_sweep_ps_argv,
  build_rm_argv,
}

import type { RunnerConfig } from "#lib/config.js";

// Label on every runner container so orphans can be found and removed.
const CONTAINER_LABEL = "code-exec=1";

// Argv for one hardened, one-shot runner container.
function build_run_argv(cfg: RunnerConfig, name: string, code_b64: string): string[] {
  const argv = [
    "run", "--rm", "-i",
    "--name", name,
    "--label", CONTAINER_LABEL,
    "--pull", "never",
    "--init",
    "--network", "none",
    "--read-only",
    "--tmpfs", `/workspace:rw,nosuid,nodev,noexec,size=${cfg.workspace_mb}m,mode=1777`,
    "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,size=${cfg.tmp_mb}m,mode=1777`,
    "--user", "65534:65534",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--pids-limit", String(cfg.pids_limit),
    "--memory", `${cfg.memory_mb}m`,
    "--memory-swap", `${cfg.memory_mb}m`,
    "--cpus", cfg.cpus,
    "--stop-timeout", "2",
  ];
  if (cfg.runtime !== undefined) {
    argv.push("--runtime", cfg.runtime);
  }
  argv.push("-e", `CODE_B64=${code_b64}`, cfg.image);
  return argv;
}

// Argv to hard-stop a runner by name.
function build_kill_argv(name: string): string[] {
  return ["kill", name];
}

// Argv listing ids of all containers carrying the runner label.
function build_sweep_ps_argv(): string[] {
  return ["ps", "-aq", "--filter", `label=${CONTAINER_LABEL}`];
}

// Argv to force-remove containers by id or name.
function build_rm_argv(ids: string[]): string[] {
  return ["rm", "-f", ...ids];
}
