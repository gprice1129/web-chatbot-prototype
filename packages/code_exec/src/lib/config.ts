export {
  RunnerConfig,
  ServerSettings,
  MAX_CODE_BYTES_CEILING,
  resolve_runner_config,
  resolve_server_settings,
}

import { ok_or_throw, parse_positive_int } from "common";

// Everything one container run needs: image, limits, and kill deadline.
interface RunnerConfig {
  image: string;
  runtime?: string;
  timeout_ms: number;
  max_output_bytes: number;
  memory_mb: number;
  cpus: string;
  pids_limit: number;
  workspace_mb: number;
  tmp_mb: number;
}

// Request admission limits for the HTTP layer.
interface ServerSettings {
  max_code_bytes: number;
  max_stdin_bytes: number;
  max_concurrency: number;
}

// Highest allowed code size: its base64 must fit one env string under
// Linux's 128 KiB MAX_ARG_STRLEN.
const MAX_CODE_BYTES_CEILING = 90000;

// Resolve the container-side config from CODE_EXEC_* env vars.
function resolve_runner_config(): RunnerConfig {
  return {
    image: _required_env("CODE_EXEC_RUNNER_IMAGE"),
    runtime: _optional_env("CODE_EXEC_RUNTIME"),
    timeout_ms: _int_env("CODE_EXEC_TIMEOUT_MS"),
    max_output_bytes: _int_env("CODE_EXEC_MAX_OUTPUT_BYTES"),
    memory_mb: _int_env("CODE_EXEC_MEMORY_MB"),
    cpus: _cpus_env("CODE_EXEC_CPUS"),
    pids_limit: _int_env("CODE_EXEC_PIDS_LIMIT"),
    workspace_mb: _int_env("CODE_EXEC_WORKSPACE_MB"),
    tmp_mb: _int_env("CODE_EXEC_TMP_MB"),
  };
}

// Resolve the admission limits from CODE_EXEC_* env vars.
function resolve_server_settings(): ServerSettings {
  const max_code_bytes = _int_env("CODE_EXEC_MAX_CODE_BYTES");
  if (max_code_bytes > MAX_CODE_BYTES_CEILING) {
    throw new Error(
      `CODE_EXEC_MAX_CODE_BYTES must be at most ${MAX_CODE_BYTES_CEILING}, got ${max_code_bytes}`);
  }
  return {
    max_code_bytes,
    max_stdin_bytes: _int_env("CODE_EXEC_MAX_STDIN_BYTES"),
    max_concurrency: _int_env("CODE_EXEC_MAX_CONCURRENCY"),
  };
}

function _int_env(name: string): number {
  return ok_or_throw(parse_positive_int(process.env[name]), name);
}

function _required_env(name: string): string {
  const val = process.env[name];
  if (undefined === val || "" === val.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val.trim();
}

// Unset or blank means absent.
function _optional_env(name: string): string | undefined {
  const val = process.env[name];
  if (undefined === val || "" === val.trim()) {
    return undefined;
  }
  return val.trim();
}

// A decimal cpu count as docker --cpus accepts it.
function _cpus_env(name: string): string {
  const val = _required_env(name);
  if (!/^\d+(\.\d+)?$/.test(val)) {
    throw new Error(`${name} must be a decimal cpu count, got "${val}"`);
  }
  return val;
}
