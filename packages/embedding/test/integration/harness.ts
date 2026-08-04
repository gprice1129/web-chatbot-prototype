export {
  embedder_config,
  skip_reason,
}

import * as child_process from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Shared setup for tests that talk to the real embedding server.
//
// These tests need the compose stack running. Rather than fail when it is not,
// they resolve the server once here and hand the suite a skip reason, so a
// developer without containers up gets an explicit "skipped, and here is why"
// instead of a wall of connection errors. The skip is reported loudly on
// purpose -- a silently skipped integration suite is worse than none.

// This file runs as TypeScript directly (see the test:integration script), so
// the repo root is four directories up from test/integration/.
const repo_root = fileURLToPath(new URL("../../../..", import.meta.url));

// The model compose asks the container to load. The adapter discovers this for
// itself; the suite keeps a copy only so it can check that discovery agrees with
// how the stack was actually configured. Mirrors docker-compose.yml.
const expected_model = process.env["EMBEDDER_MODEL"] ?? "BAAI/bge-large-en-v1.5";


/*
 * (void) => string | null
 * Resolve the embedder's base URL. The compose file publishes no host port for
 * it, so by default we ask docker for the container's IP on the compose
 * network -- the same approach packages/db/test/harness.ts uses for postgres.
 * Returns null when the container cannot be found.
 */
function resolve_base_url(): string | null {
  const direct = process.env["TEST_EMBEDDER_BASE_URL"];
  if (undefined !== direct && "" !== direct) return direct;
  const container = `${path.basename(repo_root)}-embedder-1`;
  try {
    const ip = child_process
      .execFileSync(
        "docker",
        ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", container],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      )
      .trim();
    if ("" === ip) return null;
    return `http://${ip}:80`;
  } catch {
    return null;
  }
}

const base_url = resolve_base_url();

/*
 * Probe the server once at import time. A reachable /health is the cheapest
 * signal that the model finished loading -- TEI does not serve it until the
 * backend is warmed up, so this doubles as the readiness gate.
 */
async function probe(url: string): Promise<string | false> {
  try {
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      return `embedder at ${url} returned ${response.status} from /health`;
    }
    return false;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return `embedder at ${url} is unreachable (${detail})`;
  }
}

const skip_reason: string | false = null === base_url
  ? "embedder container not found -- start it with `docker compose up -d embedder`"
  : await probe(base_url);

if (false !== skip_reason) {
  console.warn(`\n[integration] SKIPPING embedding integration tests: ${skip_reason}\n`);
}

// base_url is non-null whenever skip_reason is false; the cast keeps the
// suite's call sites free of null checks they can never hit.
const embedder_config = {
  base_url: base_url as string,
  model: expected_model,
};
