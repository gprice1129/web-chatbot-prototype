import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CODE_BYTES_CEILING,
  resolve_runner_config,
  resolve_server_settings,
} from "#lib/config.js";

const RUNNER_ENV: Record<string, string> = {
  CODE_EXEC_RUNNER_IMAGE: "aim-hi-code-runner-python:3.13",
  CODE_EXEC_TIMEOUT_MS: "10000",
  CODE_EXEC_MAX_OUTPUT_BYTES: "262144",
  CODE_EXEC_MEMORY_MB: "256",
  CODE_EXEC_CPUS: "1.0",
  CODE_EXEC_PIDS_LIMIT: "128",
  CODE_EXEC_WORKSPACE_MB: "64",
  CODE_EXEC_TMP_MB: "16",
};

const SERVER_ENV: Record<string, string> = {
  CODE_EXEC_MAX_CODE_BYTES: "65536",
  CODE_EXEC_MAX_STDIN_BYTES: "65536",
  CODE_EXEC_MAX_CONCURRENCY: "2",
};

// Run fn with the given env vars set (undefined means unset), then restore.
function with_env(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(vars)) {
    saved[key] = process.env[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  try {
    fn();
  } finally {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  }
}

test("resolves a full runner config", () => {
  with_env(RUNNER_ENV, () => {
    assert.deepEqual(resolve_runner_config(), {
      image: "aim-hi-code-runner-python:3.13",
      runtime: undefined,
      timeout_ms: 10000,
      max_output_bytes: 262144,
      memory_mb: 256,
      cpus: "1.0",
      pids_limit: 128,
      workspace_mb: 64,
      tmp_mb: 16,
    });
  });
});

test("runtime is set only when the env var is non-blank", () => {
  with_env({ ...RUNNER_ENV, CODE_EXEC_RUNTIME: "runsc" }, () => {
    assert.equal(resolve_runner_config().runtime, "runsc");
  });
  with_env({ ...RUNNER_ENV, CODE_EXEC_RUNTIME: "  " }, () => {
    assert.equal(resolve_runner_config().runtime, undefined);
  });
});

test("missing image throws with the variable name", () => {
  with_env({ ...RUNNER_ENV, CODE_EXEC_RUNNER_IMAGE: undefined }, () => {
    assert.throws(() => resolve_runner_config(), /CODE_EXEC_RUNNER_IMAGE/);
  });
});

test("non-integer limit throws with the variable name", () => {
  with_env({ ...RUNNER_ENV, CODE_EXEC_MEMORY_MB: "lots" }, () => {
    assert.throws(() => resolve_runner_config(), /CODE_EXEC_MEMORY_MB/);
  });
});

test("cpus must be a decimal count", () => {
  with_env({ ...RUNNER_ENV, CODE_EXEC_CPUS: "0.5" }, () => {
    assert.equal(resolve_runner_config().cpus, "0.5");
  });
  with_env({ ...RUNNER_ENV, CODE_EXEC_CPUS: "half" }, () => {
    assert.throws(() => resolve_runner_config(), /CODE_EXEC_CPUS/);
  });
});

test("resolves the server settings", () => {
  with_env(SERVER_ENV, () => {
    assert.deepEqual(resolve_server_settings(), {
      max_code_bytes: 65536,
      max_stdin_bytes: 65536,
      max_concurrency: 2,
    });
  });
});

test("code size above the MAX_ARG_STRLEN ceiling throws", () => {
  const over = String(MAX_CODE_BYTES_CEILING + 1);
  with_env({ ...SERVER_ENV, CODE_EXEC_MAX_CODE_BYTES: over }, () => {
    assert.throws(() => resolve_server_settings(), /CODE_EXEC_MAX_CODE_BYTES/);
  });
  with_env({ ...SERVER_ENV, CODE_EXEC_MAX_CODE_BYTES: String(MAX_CODE_BYTES_CEILING) }, () => {
    assert.equal(resolve_server_settings().max_code_bytes, MAX_CODE_BYTES_CEILING);
  });
});
