import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

import { SHAPE, variables, flatten, merge, load_config, render_env } from "./gen_env.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The smallest config that satisfies every required variable.
function minimal() {
  return {
    anthropic: { base_url: "https://api.example" },
    postgres: { superuser: "pg", app_user: "app", app_database: "db" },
    app: { files_base_path: "/uploads" },
    nginx: { server_name: "example.test" },
  };
}

test("render_env: one KEY=value line per set value, grouped by section", () => {
  const text = render_env(minimal());
  assert.match(text, /^# anthropic\nANTHROPIC_BASE_URL=https:\/\/api\.example$/m);
  assert.match(text, /^# postgres\nPOSTGRES_USER=pg\nAPP_DB_USER=app\nAPP_DB_NAME=db$/m);
  assert.match(text, /^SERVER_NAME=example\.test$/m);
});

test("flatten: a null value is left out so the compose default applies", () => {
  const config = { ...minimal(), models: { ally: { effort: null, max_tokens: 100 } } };
  const names = flatten(config).map((entry) => entry.name);
  assert.equal(names.includes("MODEL_ALLY_EFFORT"), false);
  assert.equal(names.includes("MODEL_ALLY_MAX_TOKENS"), true);
});

test("flatten: an unknown key is an error that names its path", () => {
  const config = { ...minimal(), rate_limits: { login: { maximum: 5 } } };
  assert.throws(() => flatten(config), /unknown key 'rate_limits\.login\.maximum'/);
});

test("flatten: a missing required value is an error that names the variable", () => {
  const config = minimal();
  delete config.nginx;
  assert.throws(() => flatten(config), /'nginx\.server_name' is required \(SERVER_NAME\)/);
});

test("render_env: a value with spaces is quoted", () => {
  const config = { ...minimal(), rate_limits: { login: { max: 5, window: "1 minute" } } };
  assert.match(render_env(config), /^RATE_LIMIT_LOGIN_WINDOW="1 minute"$/m);
});

test("SHAPE covers every variable docker-compose.yml reads", () => {
  // If compose grows a new ${VAR}, the config must learn to set it.
  const compose = readFileSync(path.join(REPO_ROOT, "docker-compose.yml"), "utf8");
  const read = new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const known = new Set(variables(SHAPE));
  assert.deepEqual([...read].filter((name) => !known.has(name)), []);
});

test("merge: a local section overrides one key and keeps its siblings", () => {
  const merged = merge(minimal(), { postgres: { app_user: "other" } });
  assert.equal(merged.postgres.app_user, "other");
  assert.equal(merged.postgres.superuser, "pg");
});

test("merge: a null in the override unsets what the base set", () => {
  const base = { ...minimal(), app: { files_base_path: "/uploads", trust_proxy: false } };
  const merged = merge(base, { app: { trust_proxy: null } });
  const names = flatten(merged).map((entry) => entry.name);
  assert.equal(names.includes("TRUST_PROXY"), false);
});

test("merge: the override can add a section the base lacks", () => {
  const merged = merge(minimal(), { knowledge_base: { root: "/srv/kb" } });
  assert.equal(merged.knowledge_base.root, "/srv/kb");
});

test("load_config: config.local.json beside the config is merged in when present", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gen-env-"));
  const config_path = path.join(dir, "config.json");
  try {
    await writeFile(config_path, JSON.stringify(minimal()));
    const alone = load_config(config_path);
    assert.equal(alone.local, null);
    assert.equal(alone.config.nginx.server_name, "example.test");

    await writeFile(path.join(dir, "config.local.json"),
      JSON.stringify({ nginx: { server_name: "local.test" } }));
    const merged = load_config(config_path);
    assert.equal(merged.local, path.join(dir, "config.local.json"));
    assert.equal(merged.config.nginx.server_name, "local.test");
    assert.equal(merged.config.postgres.superuser, "pg");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("the committed config renders without error", () => {
  const file = path.join(REPO_ROOT, "config", "docker", "config.json");
  const config = JSON.parse(readFileSync(file, "utf8"));
  assert.doesNotThrow(() => render_env(config));
});
