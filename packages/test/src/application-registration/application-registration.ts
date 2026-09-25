// End-to-end check of chat registration with applications (migration 012).
//
// As `testuser`, logging in once:
//   1. The register route registers a new chat and stays 200 when repeated.
//   2. A chat registered to one application is refused with 409 by another
//      application's message and register routes.
//   3. An application route answers 404 for a chat that does not exist.
//   4. A grant review registers its chat to the grant reviewer.
//
//   npm run application-registration -- [base-url]
//
// Checks 1-3 are answered by the chat-register hook before any handler runs,
// so they make no model calls. Check 4 runs one real grant review. The server
// must be running with AUTH_MODE=mock, which seeds `testuser` and configures
// the mock auth service to ignore the password.

import assert from "node:assert";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { grant_review_full } from "../grant-review-full/grant-review-full.js";

// Match `curl -k` for the local self-signed cert. Set before any fetch so undici
// picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface Session {
  base_url: string;
  cookie: string;
}

interface Response {
  status: number;
  body: string;
}

// Log in and keep the session cookie for every later request.
async function login(base_url: string, username: string, password: string): Promise<Session> {
  const res = await fetch(`${base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (res.status !== 200) {
    throw new Error(`Login failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const cookie = res.headers.getSetCookie()
    .map((sc) => sc.split(";", 1)[0]!)
    .find((c) => c.startsWith("session="));
  if (!cookie) throw new Error("Login response had no session cookie");
  return { base_url, cookie };
}

// One API request that returns its status instead of throwing.
async function request(
    session: Session, method: string, api_path: string, body?: object): Promise<Response> {
  const headers: Record<string, string> = { Cookie: session.cookie };
  if (undefined !== body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${session.base_url}/api${api_path}`, {
    method,
    headers,
    body: undefined === body ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
}

// A new, unregistered chat's id.
async function create_chat(session: Session, title: string): Promise<string> {
  const res = await request(session, "POST", "/chats", { title });
  assert.strictEqual(res.status, 200, `chat create failed: ${res.body}`);
  return (JSON.parse(res.body) as { id: string }).id;
}

// The application a chat is registered to, as GET /chats reports it.
async function application_of(session: Session, chat_id: string): Promise<string | null> {
  const res = await request(session, "GET", "/chats");
  assert.strictEqual(res.status, 200, `chat list failed: ${res.body}`);
  const { chats } = JSON.parse(res.body) as {
    chats: { id: string; application: string | null }[];
  };
  const chat = chats.find((c) => c.id === chat_id);
  assert.ok(chat, `chat ${chat_id} missing from GET /chats`);
  return chat.application;
}

// Asserts a response's status, showing its body on failure.
function expect_status(res: Response, status: number, what: string): void {
  assert.strictEqual(res.status, status, `${what}: expected ${status}, got ${res.status}: ${res.body}`);
}

// The register route registers a chat, and repeating it stays 200.
async function check_register_route(session: Session, chat_ids: string[]): Promise<void> {
  const chat_id = await create_chat(session, "Registration: register route");
  chat_ids.push(chat_id);
  const route = `/applications/budget-justification/chats/${chat_id}`;

  expect_status(await request(session, "PUT", route), 200, "first registration");
  assert.strictEqual(await application_of(session, chat_id), "budget-justification");
  expect_status(await request(session, "PUT", route), 200, "repeated registration");
}

// Another application's routes refuse a registered chat, which stays put.
async function check_conflicts(session: Session, chat_ids: string[]): Promise<void> {
  const chat_id = await create_chat(session, "Registration: conflicts");
  chat_ids.push(chat_id);
  expect_status(
    await request(session, "PUT", `/applications/ally/chats/${chat_id}`), 200,
    "registration to ally");

  expect_status(
    await request(session, "POST", "/applications/budget-justification",
      { chat_id, message: "hello" }),
    409, "message to another application");
  expect_status(
    await request(session, "PUT", `/applications/budget-justification/chats/${chat_id}`),
    409, "registration to another application");
  assert.strictEqual(await application_of(session, chat_id), "ally");
}

// Application routes answer 404 for a chat that does not exist.
async function check_unknown_chat(session: Session): Promise<void> {
  const chat_id = randomUUID();
  expect_status(
    await request(session, "POST", "/applications/ally", { chat_id, message: "hello" }),
    404, "message for an unknown chat");
  expect_status(
    await request(session, "PUT", `/applications/ally/chats/${chat_id}`),
    404, "registration of an unknown chat");
}

// A grant review registers its chat to the grant reviewer.
async function check_grant_review(
    session: Session, username: string, password: string, chat_ids: string[]): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "application-registration-"));
  try {
    const rfa_path = path.join(dir, "rfa.txt");
    const proposal_path = path.join(dir, "proposal.txt");
    await fs.writeFile(rfa_path,
      "Request for Applications: one-year pilot grants in precision medicine.\n");
    await fs.writeFile(proposal_path,
      "Proposal: a pharmacogenomic screening pilot enrolling 100 patients.\n");
    const result = await grant_review_full({
      base_url: session.base_url,
      rfa_path,
      companion_path: proposal_path,
      mode: "summary",
      title: "Registration: grant review",
      username,
      password,
      poll_interval_ms: 500,
      poll_timeout_ms: 60_000,
    });
    chat_ids.push(result.chat_id);
    assert.strictEqual(await application_of(session, result.chat_id), "grant-reviewer");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export async function application_registration(base_url: string): Promise<void> {
  const username = process.env.TEST_USERNAME ?? "testuser";
  const password = process.env.TEST_PASSWORD ?? "irrelevant";
  const session = await login(base_url, username, password);
  const chat_ids: string[] = [];
  try {
    await check_register_route(session, chat_ids);
    await check_conflicts(session, chat_ids);
    await check_unknown_chat(session);
    await check_grant_review(session, username, password, chat_ids);
  } finally {
    for (const chat_id of chat_ids) {
      await request(session, "DELETE", `/chats/${chat_id}`);
    }
  }
}

// CLI driver — when run via `npm run application-registration`, exercise the
// checks against a live server. Throws on any failed assertion or request,
// which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  await application_registration(process.argv[2] ?? "http://localhost:8080");
  console.log("application registration: OK");
}
