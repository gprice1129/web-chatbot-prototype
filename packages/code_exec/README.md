# code_exec

HTTP service that runs untrusted code in isolated one-shot containers and
returns a structured result. It is stateless and credential-free. Callers own
persistence and per-user scoping.

## Execution model

Each request spawns one hardened container from the runner image via the
host docker daemon:

- `--network none`, read-only rootfs, tmpfs `/workspace` and `/tmp`
  (`noexec,nosuid,nodev`, size-capped)
- user `nobody` (65534), `--cap-drop ALL`, `--security-opt
  no-new-privileges`, pids/memory/cpu limits, swap pinned to memory
- wall-clock timeout enforced by the service (`docker kill` by name)
- `--runtime` is configurable (`CODE_EXEC_RUNTIME`) so gVisor's `runsc`
  can be swapped in without code changes

The exact flags live in `src/lib/docker-args.ts` and are locked by a
unit test.

## How code reaches the runner

The service base64-encodes the program and passes it as one env var
(`-e CODE_B64=...`); the runner entrypoint decodes it to
`/workspace/main.py` and `exec`s `python3 /workspace/main.py`. Stdin is
never consumed by the entrypoint, so the request's `stdin` flows straight
through to the program.

Linux caps each argv/env string at 128 KiB (`MAX_ARG_STRLEN`), so
`CODE_EXEC_MAX_CODE_BYTES` refuses values above 90000 raw bytes at
startup; the operational default is 65536.

## Runner image

```
docker build -t code-runner-python:3.13 packages/code_exec/runner/python
```

The image holds only the pinned interpreter (`python:3.13-slim`) and the
entrypoint. No packages are installed and no network is available at run
time. The service finds it via `CODE_EXEC_RUNNER_IMAGE` and passes
`--pull never`, so a missing local image fails fast instead of pulling
from a registry.

## Tests

```
npm test                      # unit tests, no docker needed
npm run test:integration      # real docker + the runner image (later chunk)
```
