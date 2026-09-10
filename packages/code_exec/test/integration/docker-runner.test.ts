// Real-docker tests, not part of `npm test`. Prerequisite:
//   docker build -t code-runner-python:3.13 runner/python
// Override the image with TEST_CODE_EXEC_IMAGE.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ok_or_throw } from "common";
import type { RunnerConfig } from "#lib/config.js";
import { Language } from "#lib/execution.js";
import { DockerRunner } from "#lib/docker-runner.js";

const _exec_file = promisify(execFile);

const TEST_IMAGE = process.env["TEST_CODE_EXEC_IMAGE"] ?? "code-runner-python:3.13";

function make_cfg(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    image: TEST_IMAGE,
    runtime: undefined,
    timeout_ms: 15000,
    max_output_bytes: 65536,
    memory_mb: 128,
    cpus: "0.5",
    pids_limit: 64,
    workspace_mb: 16,
    tmp_mb: 16,
    ...overrides,
  };
}

// Container removal by --rm is asynchronous; poll briefly for it.
async function assert_no_runners_left(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    const ps = await _exec_file("docker",
      ["ps", "-aq", "--filter", "label=code-exec=1"]);
    if (ps.stdout.trim() === "") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail("labeled runner containers left behind");
}

test("runs code and captures stdout", async () => {
  const runner = new DockerRunner(make_cfg());
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: 'print("hi")',
  }));
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout, "hi\n");
  assert.equal(out.stderr, "");
  assert.equal(out.stdout_truncated, false);
  assert.equal(out.stderr_truncated, false);
  assert.equal(out.timed_out, false);
  assert.ok(out.duration_ms > 0);
});

test("stdin reaches the program", async () => {
  const runner = new DockerRunner(make_cfg());
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: "print(input()[::-1])",
    stdin: "hello\n",
  }));
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout, "olleh\n");
});

test("nonzero exit and stderr are a normal outcome", async () => {
  const runner = new DockerRunner(make_cfg());
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: 'import sys\nsys.stderr.write("boom\\n")\nsys.exit(3)',
  }));
  assert.equal(out.exit_code, 3);
  assert.equal(out.stderr, "boom\n");
});

test("timeout kills the container and keeps partial output", async () => {
  const runner = new DockerRunner(make_cfg({ timeout_ms: 1500 }));
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: 'print("start", flush=True)\nimport time\ntime.sleep(60)',
  }));
  assert.equal(out.timed_out, true);
  assert.equal(out.stdout, "start\n");
  await assert_no_runners_left();
});

test("output past the cap is truncated", async () => {
  const runner = new DockerRunner(make_cfg({ max_output_bytes: 1000 }));
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: 'print("x" * 5000)',
  }));
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout.length, 1000);
  assert.equal(out.stdout_truncated, true);
});

test("the network is unreachable", async () => {
  const runner = new DockerRunner(make_cfg());
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: [
      "import urllib.request",
      "try:",
      '    urllib.request.urlopen("http://example.com", timeout=3)',
      '    print("reached")',
      "except Exception:",
      '    print("blocked")',
    ].join("\n"),
  }));
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout, "blocked\n");
});

test("the rootfs is read-only and the workspace is writable", async () => {
  const runner = new DockerRunner(make_cfg());
  const out = ok_or_throw(await runner.run({
    language: Language.PYTHON,
    code: [
      "try:",
      '    open("/etc/pwned", "w")',
      '    print("writable")',
      "except OSError:",
      '    print("readonly")',
      'with open("/workspace/f.txt", "w") as f:',
      '    f.write("ok")',
      'print("workspace-ok")',
    ].join("\n"),
  }));
  assert.equal(out.exit_code, 0);
  assert.equal(out.stdout, "readonly\nworkspace-ok\n");
});

test("sweep_orphans removes leftover labeled containers", async () => {
  const sleep_b64 = Buffer.from("import time\ntime.sleep(60)").toString("base64");
  await _exec_file("docker", [
    "run", "-d",
    "--label", "code-exec=1",
    "--name", "code-exec-orphan-test",
    "-e", `CODE_B64=${sleep_b64}`,
    TEST_IMAGE,
  ]);
  const count = await new DockerRunner(make_cfg()).sweep_orphans();
  assert.ok(count >= 1);
  await assert_no_runners_left();
});

test("a missing image is a docker_error", async () => {
  const runner = new DockerRunner(make_cfg({ image: "code-exec-no-such-image:none" }));
  const result = await runner.run({
    language: Language.PYTHON,
    code: "print(1)",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "docker_error");
    assert.notEqual(result.error.message, "");
  }
});
