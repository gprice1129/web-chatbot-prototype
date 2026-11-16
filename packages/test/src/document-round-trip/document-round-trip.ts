// End-to-end check of a chat's document: opened through an application, then
// read and written by its id.
//
// As `testuser`, logging in once:
//   1. The IRB protocol application opens a chat's document, and opening it
//      again answers the same document.
//   2. The document's template is read by id, a section is written, and the
//      document reads back as written.
//   3. A write is refused when its revision is stale, its section or document
//      is unknown, or its body or document id is malformed.
//   4. A chat of another application, or an unknown chat, is refused on open.
//
//   npm run document-round-trip -- [base-url]
//
// No check makes a model call. The server must be running with AUTH_MODE=mock,
// which seeds `testuser` and configures the mock auth service to ignore the
// password.

import assert from "node:assert";
import { randomUUID } from "node:crypto";

// Match `curl -k` for the local self-signed cert. Set before any fetch so undici
// picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const IRB_PROTOCOL = "irb-protocol";

interface Session {
  base_url: string;
  cookie: string;
}

interface Response {
  status: number;
  body: string;
}

interface Section {
  text: string;
  status: string;
  written_by: string;
  written_at: string;
}

interface Document {
  template_id: string | null;
  writable_by: string[];
  revision: number;
  sections: Record<string, Section>;
}

interface OpenedDocument {
  id: string;
  document: Document;
}

interface Template {
  id: string;
  title: string;
  sections: { id: string; title: string; required: boolean }[];
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

// Asserts a response's status, showing its body on failure.
function expect_status(res: Response, status: number, what: string): void {
  assert.strictEqual(res.status, status, `${what}: expected ${status}, got ${res.status}: ${res.body}`);
}

// A new, unregistered chat's id.
async function create_chat(session: Session, title: string): Promise<string> {
  const res = await request(session, "POST", "/chats", { title });
  expect_status(res, 200, "chat create");
  return (JSON.parse(res.body) as { id: string }).id;
}

// The application a chat is registered to, as GET /chats reports it.
async function application_of(session: Session, chat_id: string): Promise<string | null> {
  const res = await request(session, "GET", "/chats");
  expect_status(res, 200, "chat list");
  const { chats } = JSON.parse(res.body) as {
    chats: { id: string; application: string | null }[];
  };
  const chat = chats.find((c) => c.id === chat_id);
  assert.ok(chat, `chat ${chat_id} missing from GET /chats`);
  return chat.application;
}

// The chat's document as the IRB protocol application opens it.
async function open_document(session: Session, chat_id: string): Promise<OpenedDocument> {
  const res = await request(
    session, "PUT", `/applications/${IRB_PROTOCOL}/chats/${chat_id}/document`);
  expect_status(res, 200, "document open");
  return JSON.parse(res.body) as OpenedDocument;
}

// The document as it stands, read by its id.
async function read_document(session: Session, document_id: string): Promise<Document> {
  const res = await request(session, "GET", `/documents/${document_id}`);
  expect_status(res, 200, "document read");
  return (JSON.parse(res.body) as { document: Document }).document;
}

// One section write, answered with whatever the server says.
async function write_section(
    session: Session,
    document_id: string,
    section_id: string,
    body: object): Promise<Response> {
  return request(session, "PUT", `/documents/${document_id}/sections/${section_id}`, body);
}

// Opening makes the chat's document once, and registers the chat.
async function check_open(session: Session, chat_id: string): Promise<OpenedDocument> {
  const opened = await open_document(session, chat_id);

  assert.deepStrictEqual(opened.document, {
    template_id: IRB_PROTOCOL,
    writable_by: ["user", "assistant"],
    revision: 0,
    sections: {},
  });
  assert.strictEqual(await application_of(session, chat_id), IRB_PROTOCOL);
  assert.deepStrictEqual(await open_document(session, chat_id), opened, "repeated open");
  return opened;
}

// The document's template is served by id, without what is written for the model.
async function check_template(session: Session, template_id: string): Promise<Template> {
  const res = await request(session, "GET", `/templates/${template_id}`);
  expect_status(res, 200, "template read");
  const { template } = JSON.parse(res.body) as { template: Template };

  assert.strictEqual(template.id, template_id);
  assert.ok(template.sections.length > 0, "template has no sections");
  for (const section of template.sections) {
    assert.deepStrictEqual(Object.keys(section).sort(), ["id", "required", "title"]);
  }
  expect_status(await request(session, "GET", "/templates/no-such-template"), 404,
    "unknown template");
  return template;
}

// A written section is answered, read back by id, and seen on the next open.
async function check_write(
    session: Session,
    chat_id: string,
    document_id: string,
    section_id: string): Promise<void> {
  const res = await write_section(session, document_id, section_id,
    { revision: 0, text: "Written by the round trip.", status: "draft" });
  expect_status(res, 200, "section write");
  const { document } = JSON.parse(res.body) as { document: Document };

  assert.strictEqual(document.revision, 1);
  assert.deepStrictEqual(Object.keys(document.sections), [section_id]);
  const section = document.sections[section_id]!;
  assert.strictEqual(section.text, "Written by the round trip.");
  assert.strictEqual(section.status, "draft");
  assert.strictEqual(section.written_by, "user");
  assert.deepStrictEqual(await read_document(session, document_id), document, "read after write");
  assert.deepStrictEqual(
    await open_document(session, chat_id), { id: document_id, document }, "open after write");
}

// Writes the server must refuse, none of which moves the document.
async function check_refused_writes(
    session: Session, document_id: string, section_id: string): Promise<void> {
  const before = await read_document(session, document_id);
  const write = { revision: before.revision, text: "Refused.", status: "draft" };

  expect_status(
    await write_section(session, document_id, section_id, { ...write, revision: 0 }),
    409, "write against a stale revision");
  expect_status(
    await write_section(session, document_id, "no_such_section", write),
    404, "write of an unknown section");
  expect_status(
    await write_section(session, document_id, section_id, { ...write, status: "empty" }),
    400, "write with an unknown status");
  expect_status(
    await write_section(session, randomUUID(), section_id, write),
    404, "write to an unknown document");
  expect_status(
    await write_section(session, "not-a-uuid", section_id, write),
    400, "write to a malformed document id");
  assert.deepStrictEqual(await read_document(session, document_id), before, "document moved");
}

// Reads the server must refuse.
async function check_refused_reads(session: Session): Promise<void> {
  expect_status(await request(session, "GET", `/documents/${randomUUID()}`), 404,
    "read of an unknown document");
  expect_status(await request(session, "GET", "/documents/not-a-uuid"), 400,
    "read of a malformed document id");
}

// Another application's chat, and an unknown chat, are refused on open.
async function check_refused_opens(session: Session, chat_ids: string[]): Promise<void> {
  const chat_id = await create_chat(session, "Document: another application's chat");
  chat_ids.push(chat_id);
  expect_status(
    await request(session, "PUT", `/applications/ally/chats/${chat_id}`), 200,
    "registration to ally");

  expect_status(
    await request(session, "PUT", `/applications/${IRB_PROTOCOL}/chats/${chat_id}/document`),
    409, "open for another application's chat");
  expect_status(
    await request(
      session, "PUT", `/applications/${IRB_PROTOCOL}/chats/${randomUUID()}/document`),
    404, "open for an unknown chat");
}

export async function document_round_trip(base_url: string): Promise<void> {
  const username = process.env.TEST_USERNAME ?? "testuser";
  const password = process.env.TEST_PASSWORD ?? "irrelevant";
  const session = await login(base_url, username, password);
  const chat_ids: string[] = [];
  try {
    const chat_id = await create_chat(session, "Document: round trip");
    chat_ids.push(chat_id);
    const opened = await check_open(session, chat_id);
    const template = await check_template(session, IRB_PROTOCOL);
    const section_id = template.sections[0]!.id;
    await check_write(session, chat_id, opened.id, section_id);
    await check_refused_writes(session, opened.id, section_id);
    await check_refused_reads(session);
    await check_refused_opens(session, chat_ids);
  } finally {
    for (const chat_id of chat_ids) {
      await request(session, "DELETE", `/chats/${chat_id}`);
    }
  }
}

// CLI driver — when run via `npm run document-round-trip`, exercise the checks
// against a live server. Throws on any failed assertion or request, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  await document_round_trip(process.argv[2] ?? "http://localhost:8080");
  console.log("document round trip: OK");
}
