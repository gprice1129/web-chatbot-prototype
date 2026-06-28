// End-to-end check of the single-project-per-chat invariant (migration 009).
//
// As `testuser`: create two projects and one chat, add the chat to project 1
// (success), then attempt to add the SAME chat to project 2 and assert it is
// rejected with 409 -- the UNIQUE (chat_id) constraint surfaced by the route as
// a Conflict. Finally confirm the chat is a member of project 1 only (the
// invariant held), and that re-adding it to project 1 stays idempotent.
//
//   npm run project-chat-single -- [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

import assert from "node:assert";
import { project_create } from "../project-create/project-create.js";
import { chat_create } from "../chat-create/chat-create.js";
import { project_chat_add } from "../project-chat-add/project-chat-add.js";
import { project_chats_get } from "../project-chats-get/project-chats-get.js";
import { project_delete } from "../project-delete/project-delete.js";

// Match `curl -k` for the local self-signed cert. Set before any fetch so undici
// picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AddAttempt {
  status: number;
  body: string;
}

// Raw add so an expected *failure* can be inspected: the shared project_chat_add
// helper throws on any non-200, which a test can't assert a status on. Mirrors
// that helper's login + POST, but returns the status instead of throwing.
async function add_chat_raw(opts: {
  base_url: string; project_id: string; chat_id: string;
  username: string; password: string;
}): Promise<AddAttempt> {
  const login_res = await fetch(`${opts.base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (login_res.status !== 200) {
    throw new Error(`Login failed (HTTP ${login_res.status})`);
  }
  const session_cookie = login_res.headers.getSetCookie()
    .map((sc) => sc.split(";", 1)[0]!)
    .find((c) => c.startsWith("session="));
  if (!session_cookie) throw new Error("Login response had no session cookie");

  const res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}/chats`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: session_cookie },
      body: JSON.stringify({ chat_id: opts.chat_id }),
    });
  return { status: res.status, body: await res.text() };
}

export async function project_chat_single(base_url: string): Promise<void> {
  const username = process.env.TEST_USERNAME ?? "testuser";
  const password = process.env.TEST_PASSWORD ?? "irrelevant";
  const auth = { base_url, username, password };

  // 1. Two projects and one chat to move between them.
  const project1 = await project_create({ ...auth, name: "Single-project A" });
  const project2 = await project_create({ ...auth, name: "Single-project B" });
  const chat = await chat_create({ ...auth, title: "Single-project chat" });

  // 2. Add the chat to project 1 -- succeeds and shows up in the membership.
  await project_chat_add({ ...auth, project_id: project1.id, chat_id: chat.id });
  const in_p1 = await project_chats_get({ ...auth, project_id: project1.id });
  assert.ok(in_p1.chats.some((c) => c.id === chat.id),
    "chat should be a member of project 1 after add");

  // 3. Adding the SAME chat to project 2 is rejected with 409.
  const rejected = await add_chat_raw(
    { ...auth, project_id: project2.id, chat_id: chat.id });
  assert.strictEqual(rejected.status, 409,
    `second-project add should be rejected with 409, got ${rejected.status}: ${rejected.body}`);

  // 4. The invariant held: the chat is still only in project 1, never project 2.
  const p1_after = await project_chats_get({ ...auth, project_id: project1.id });
  assert.ok(p1_after.chats.some((c) => c.id === chat.id),
    "chat should remain a member of project 1 after the rejected add");
  const p2_after = await project_chats_get({ ...auth, project_id: project2.id });
  assert.ok(!p2_after.chats.some((c) => c.id === chat.id),
    "chat must NOT have been added to project 2");

  // 5. Re-adding to project 1 stays idempotent (the same-project conflict on the
  //    PK is swallowed; only a cross-project add hits UNIQUE (chat_id)).
  const readd = await add_chat_raw(
    { ...auth, project_id: project1.id, chat_id: chat.id });
  assert.strictEqual(readd.status, 200,
    `re-adding to the same project should stay 200, got ${readd.status}: ${readd.body}`);

  // 6. Cleanup: delete both projects (junction rows cascade; the chat survives).
  await project_delete({ ...auth, project_id: project1.id });
  await project_delete({ ...auth, project_id: project2.id });
}

// CLI driver — when run via `npm run project-chat-single`, exercise the invariant
// against a live server. Throws on any failed assertion or request, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  await project_chat_single(process.argv[2] ?? "http://localhost:8080");
  console.log("project chat single: OK");
}
