#!/usr/bin/env node
// Render a docker config profile into the flat .env file compose reads.
//
//   node scripts/gen_env.mjs local                config/docker/local.json -> .env
//   node scripts/gen_env.mjs production           config/docker/production.json -> .env
//   node scripts/gen_env.mjs <profile> --force    overwrite an existing .env
//   node scripts/gen_env.mjs --config X --out Y   other paths
//   node scripts/gen_env.mjs --override X         another override file
//
// Two profiles are committed: `local` is the developer stack (mock auth, debug
// traces, no rate limits, localhost) and `production` is the real one. Neither
// is a default; the profile is always named, so a stack is never generated
// from the wrong one by accident. override.json beside the profile, when
// present, is merged over it and is gitignored: it holds what is specific to
// one machine, such as the model endpoint.

export { SHAPE, variables, flatten, merge, load_config, render_env };

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG_DIR = path.join(REPO_ROOT, "config", "docker");
const PROFILES = ["local", "production"];
const OVERRIDE_NAME = "override.json";
const DEFAULT_OUT = path.join(REPO_ROOT, ".env");

// A variable compose has no default for. Everything else is optional.
function required(name) {
  return { name, required: true };
}

// The four generation parameters every model accepts.
function model_vars(prefix) {
  return {
    effort: `${prefix}_EFFORT`,
    thinking: `${prefix}_THINKING`,
    caching: `${prefix}_CACHING`,
    max_tokens: `${prefix}_MAX_TOKENS`,
  };
}

// A rate limit is a count and a window.
function limit_vars(prefix) {
  return { max: `${prefix}_MAX`, window: `${prefix}_WINDOW` };
}

// The one place that ties a config path to the variable compose reads. A leaf
// is the variable name; sections nest. This is also the schema the config is
// checked against.
const SHAPE = {
  anthropic: { base_url: required("ANTHROPIC_BASE_URL") },
  postgres: {
    superuser: required("POSTGRES_USER"),
    app_user: required("APP_DB_USER"),
    app_database: required("APP_DB_NAME"),
  },
  app: {
    auth_mode: "AUTH_MODE",
    model_mode: "MODEL_MODE",
    debug_mode: "DEBUG_MODE",
    files_base_path: required("FILES_BASE_PATH"),
    trust_proxy: "TRUST_PROXY",
  },
  nginx: { server_name: required("SERVER_NAME") },
  frontend: { base_path: "VITE_BASE_PATH", api_url: "VITE_API_URL" },
  secrets_dir: "SECRETS_DIR",
  sources: { knowledge: required("KNOWLEDGE_ROOT"), prompts: required("PROMPTS_ROOT") },
  rate_limits: {
    login: limit_vars("RATE_LIMIT_LOGIN"),
    ally: limit_vars("RATE_LIMIT_ALLY"),
    grant_review: limit_vars("RATE_LIMIT_GRANT_REVIEW"),
  },
  login_limits: {
    username_max_length: "LOGIN_USERNAME_MAX_LENGTH",
    password_max_length: "LOGIN_PASSWORD_MAX_LENGTH",
    body_limit: "LOGIN_BODY_LIMIT",
  },
  models: {
    ally: model_vars("MODEL_ALLY"),
    grant_review: model_vars("MODEL_GRANT_REVIEW"),
    summary: model_vars("MODEL_SUMMARY"),
  },
};

// Whether a shape node names a variable rather than a section.
function is_leaf(spec) {
  if ("string" === typeof spec) return true;
  return "name" in spec;
}

// Read a leaf as { name, required }.
function as_leaf(spec) {
  if ("string" === typeof spec) return { name: spec, required: false };
  return spec;
}

// Every variable the shape can produce, in output order.
function variables(shape = SHAPE) {
  const names = [];
  for (const spec of Object.values(shape)) {
    if (is_leaf(spec)) {
      names.push(as_leaf(spec).name);
      continue;
    }
    names.push(...variables(spec));
  }
  return names;
}

// Walk the config against the shape and return { section, name, value }
// entries in shape order. An unknown key or a missing required value is an
// error. A null value is skipped, which leaves the compose default in force.
function flatten(config, shape = SHAPE, at = []) {
  for (const key of Object.keys(config)) {
    if (!(key in shape)) throw new Error(`unknown key '${[...at, key].join(".")}'`);
  }
  const entries = [];
  for (const [key, spec] of Object.entries(shape)) {
    const here = [...at, key];
    const value = config[key];
    if (is_leaf(spec)) {
      entries.push(..._leaf_entries(as_leaf(spec), value, here));
      continue;
    }
    entries.push(..._section_entries(spec, value, here));
  }
  return entries;
}

// The entry for one leaf, or none when the value is absent.
function _leaf_entries(leaf, value, here) {
  if (undefined === value || null === value) {
    if (leaf.required) {
      throw new Error(`'${here.join(".")}' is required (${leaf.name})`);
    }
    return [];
  }
  return [{ section: here[0], name: leaf.name, value }];
}

// The entries under one section. An absent section still owes its required
// leaves, so it is walked as empty rather than skipped.
function _section_entries(spec, value, here) {
  if (undefined === value || null === value) return flatten({}, spec, here);
  if ("object" !== typeof value || Array.isArray(value)) {
    throw new Error(`'${here.join(".")}' must be an object`);
  }
  return flatten(value, spec, here);
}

// Whether a value is a section of settings rather than one setting.
function _is_section(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}

// Merge `over` onto `base`. Sections merge key by key. Anything else
// replaces, so a null in `over` unsets what `base` had.
function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    if (_is_section(value) && _is_section(out[key])) {
      out[key] = merge(out[key], value);
      continue;
    }
    out[key] = value;
  }
  return out;
}

// The override file that belongs to a profile: override.json in its directory.
function _override_path_for(config_path) {
  return path.join(path.dirname(config_path), OVERRIDE_NAME);
}

// Read a profile, with the machine override merged over it when one exists.
function load_config(config_path, override_path = _override_path_for(config_path)) {
  const base = JSON.parse(readFileSync(config_path, "utf8"));
  if (!existsSync(override_path)) return { config: base, override: null };
  const over = JSON.parse(readFileSync(override_path, "utf8"));
  return { config: merge(base, over), override: override_path };
}

// Quote a value when the .env grammar would otherwise misread it.
function _quote(text) {
  if (!/[\s#"'\\]/.test(text)) return text;
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// Render the config as the text of a .env file, one block per section.
function render_env(config) {
  const lines = [
    "# Generated by scripts/gen_env.mjs from a profile under config/docker/.",
    "# Edit the JSON and re-run the script rather than editing this file.",
  ];
  let section = null;
  for (const entry of flatten(config)) {
    if (entry.section !== section) {
      section = entry.section;
      lines.push("", `# ${section}`);
    }
    lines.push(`${entry.name}=${_quote(String(entry.value))}`);
  }
  return lines.join("\n") + "\n";
}

// Read the profile name and flags this script accepts. A profile names a
// committed file; --config names any file and needs no profile.
function _parse_args(argv) {
  const args = { config: undefined, override: undefined, out: DEFAULT_OUT, force: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (PROFILES.includes(flag)) {
      args.config = path.join(CONFIG_DIR, `${flag}.json`);
      continue;
    }
    if ("--force" === flag) {
      args.force = true;
      continue;
    }
    if ("--config" === flag || "--override" === flag || "--out" === flag) {
      const value = argv[++i];
      if (undefined === value) throw new Error(`${flag} needs a path`);
      args[flag.slice(2)] = path.resolve(value);
      continue;
    }
    throw new Error(`unknown argument '${flag}'`);
  }
  if (undefined === args.config) {
    throw new Error(`name a profile (${PROFILES.join("|")}) or pass --config`);
  }
  return args;
}

// Render the profile to the .env file, refusing to overwrite unless told.
function main() {
  const args = _parse_args(process.argv.slice(2));
  if (existsSync(args.out) && !args.force) {
    throw new Error(`${args.out} exists; pass --force to overwrite it`);
  }
  const { config, override } = load_config(args.config, args.override);
  writeFileSync(args.out, render_env(config));
  const sources = [args.config];
  if (null !== override) sources.push(override);
  console.log(`wrote ${args.out} from ${sources.join(" + ")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`gen_env: ${err.message}`);
    process.exit(1);
  }
}
