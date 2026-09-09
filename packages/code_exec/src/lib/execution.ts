export {
  Language,
  ExecRequest,
  ExecOutcome,
  ExecFailure,
  ExecFailureKind,
  CodeExecutor,
}

import type { Result } from "common";

// Languages the service can execute.
enum Language {
  PYTHON = "python",
}

// One request to run code.
interface ExecRequest {
  language: Language;
  code: string;
  stdin?: string;
}

// Outcome of a code run.
interface ExecOutcome {
  exit_code: number;
  stdout: string;
  stderr: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  timed_out: boolean;
  duration_ms: number;
}

// Execution failures at the service level
type ExecFailureKind = "spawn_failure" | "docker_error";
interface ExecFailure {
  kind: ExecFailureKind;
  message: string;
}

// The boundary the HTTP layer talks to.
interface CodeExecutor {
  run(req: ExecRequest): Promise<Result<ExecOutcome, ExecFailure>>;
}
