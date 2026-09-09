// memory.test.ts
//
// Exercises MemoryDbService against the real schema in the scratch test
// database (built by setup_db.ts). Focuses on behavior that lives in the SQL
// and is invisible at the API layer: the upsert's ownership and watermark
// guards, and the staleness query's millisecond-truncation contract.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import * as pg from "pg";
import { make_db_services } from "db";
import { make_test_pool, reset_db } from "./harness.js";
import {
  add_message,
  add_to_project,
  make_chat,
  make_project,
  make_user,
} from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

//------------------------------------------------------------------------------
// fixtures
//------------------------------------------------------------------------------

async function get_summary(
  pool: pg.Pool,
  chat_id: string,
): Promise<{ content: string; source_through: Date } | undefined> {
  const result = await pool.query(
    `SELECT content, source_through FROM chat_memories
      WHERE chat_id = $1 AND kind = 'summary'`,
    [chat_id]);
  return result.rows[0];
}

const T0 = new Date("2026-01-01T10:00:00.000Z");
const T1 = new Date("2026-01-01T11:00:00.000Z");

//------------------------------------------------------------------------------
// upsert_chat_memory
//------------------------------------------------------------------------------

describe("upsert_chat_memory", () => {
  it("inserts a summary for a chat the user owns", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    await db.memory_db.upsert_chat_memory(chat, user, "v1", T0);

    const row = await get_summary(pool, chat);
    assert.ok(row);
    assert.equal(row.content, "v1");
    assert.equal(row.source_through.getTime(), T0.getTime());
  });

  it("inserts nothing when the user does not own the chat", async () => {
    const alice = await make_user(pool, "alice");
    const mallory = await make_user(pool, "mallory");
    const chat = await make_chat(pool, alice);

    await db.memory_db.upsert_chat_memory(chat, mallory, "planted", T0);
    assert.equal(await get_summary(pool, chat), undefined);

    // Nor can a mismatched user clobber an existing summary.
    await db.memory_db.upsert_chat_memory(chat, alice, "v1", T0);
    await db.memory_db.upsert_chat_memory(chat, mallory, "clobbered", T1);
    assert.equal((await get_summary(pool, chat))?.content, "v1");
  });

  it("replaces the summary when source_through advances", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    await db.memory_db.upsert_chat_memory(chat, user, "v1", T0);
    await db.memory_db.upsert_chat_memory(chat, user, "v2", T1);

    const row = await get_summary(pool, chat);
    assert.equal(row?.content, "v2");
    assert.equal(row?.source_through.getTime(), T1.getTime());
  });

  it("ignores an upsert whose source_through is older than the stored one", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    await db.memory_db.upsert_chat_memory(chat, user, "v1", T1);
    await db.memory_db.upsert_chat_memory(chat, user, "stale-rewrite", T0);

    const row = await get_summary(pool, chat);
    assert.equal(row?.content, "v1");
    assert.equal(row?.source_through.getTime(), T1.getTime());
  });

  it("accepts a re-upsert at the same watermark (guard is <=)", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    await db.memory_db.upsert_chat_memory(chat, user, "v1", T0);
    await db.memory_db.upsert_chat_memory(chat, user, "v1-regenerated", T0);

    assert.equal((await get_summary(pool, chat))?.content, "v1-regenerated");
  });

  it("keeps kinds independent — the conflict key is (chat_id, kind)", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    await db.memory_db.upsert_chat_memory(chat, user, "the summary", T0);
    await db.memory_db.upsert_chat_memory(chat, user, "the facts", T0, "facts");

    const result = await pool.query(
      `SELECT kind, content FROM chat_memories WHERE chat_id = $1 ORDER BY kind`,
      [chat]);
    assert.deepEqual(result.rows, [
      { kind: "facts", content: "the facts" },
      { kind: "summary", content: "the summary" },
    ]);
  });
});

//------------------------------------------------------------------------------
// get_stale_summary_chats
//------------------------------------------------------------------------------

describe("get_stale_summary_chats", () => {
  it("reports a chat that has messages but no summary", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);
    await add_message(pool, chat, "user", T0);

    assert.deepEqual(await db.memory_db.get_stale_summary_chats(10), [
      { chat_id: chat, user_id: user },
    ]);
  });

  it("ignores a chat with no user/assistant messages", async () => {
    const user = await make_user(pool, "alice");
    const empty = await make_chat(pool, user, "no messages");
    const system_only = await make_chat(pool, user, "system only");
    await add_message(pool, system_only, "system", T0);

    assert.deepEqual(await db.memory_db.get_stale_summary_chats(10), []);
  });

  it("is not fooled by microsecond precision: a summary at the last message's pg-returned timestamp is fresh", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);

    // Store the message with sub-millisecond precision, as now() does. pg
    // returns created_at as a JS Date, silently dropping the microseconds;
    // the summarizer writes that truncated value back as source_through.
    // Without the query's date_trunc('milliseconds', ...) this chat would
    // register stale forever.
    const at = await add_message(pool, chat, "user", "2026-01-01T10:00:00.123567Z");
    await db.memory_db.upsert_chat_memory(chat, user, "covers everything", at);

    assert.deepEqual(await db.memory_db.get_stale_summary_chats(10), []);
  });

  it("reports the chat again once a newer message arrives", async () => {
    const user = await make_user(pool, "alice");
    const chat = await make_chat(pool, user);
    const at = await add_message(pool, chat, "user", T0);
    await db.memory_db.upsert_chat_memory(chat, user, "covers T0", at);

    await add_message(pool, chat, "assistant", T1);

    assert.deepEqual(await db.memory_db.get_stale_summary_chats(10), [
      { chat_id: chat, user_id: user },
    ]);
  });

  it("orders stalest-first and honors the limit", async () => {
    const user = await make_user(pool, "alice");
    const newest = await make_chat(pool, user, "newest");
    const oldest = await make_chat(pool, user, "oldest");
    const middle = await make_chat(pool, user, "middle");
    await add_message(pool, newest, "user", new Date("2026-01-03T00:00:00Z"));
    await add_message(pool, oldest, "user", new Date("2026-01-01T00:00:00Z"));
    await add_message(pool, middle, "user", new Date("2026-01-02T00:00:00Z"));

    const stale = await db.memory_db.get_stale_summary_chats(2);
    assert.deepEqual(stale.map((s) => s.chat_id), [oldest, middle]);
  });
});

//------------------------------------------------------------------------------
// get_sibling_summaries
//------------------------------------------------------------------------------

describe("get_sibling_summaries", () => {
  it("returns the other chats' summaries, newest watermark first, never the active chat's own", async () => {
    const user = await make_user(pool, "alice");
    const project = await make_project(pool, user, true);
    const active = await make_chat(pool, user, "active");
    const older = await make_chat(pool, user, "older");
    const newer = await make_chat(pool, user, "newer");
    await add_to_project(pool, project, active);
    await add_to_project(pool, project, older);
    await add_to_project(pool, project, newer);
    await db.memory_db.upsert_chat_memory(active, user, "about the active chat", T1);
    await db.memory_db.upsert_chat_memory(older, user, "about the older chat", T0);
    await db.memory_db.upsert_chat_memory(newer, user, "about the newer chat", T1);

    assert.deepEqual(await db.memory_db.get_sibling_summaries(active, user), [
      { chat_id: newer, title: "newer", summary: "about the newer chat" },
      { chat_id: older, title: "older", summary: "about the older chat" },
    ]);
  });

  it("omits siblings that have no summary (other memory kinds don't count)", async () => {
    const user = await make_user(pool, "alice");
    const project = await make_project(pool, user, true);
    const active = await make_chat(pool, user, "active");
    const summarized = await make_chat(pool, user, "summarized");
    const unsummarized = await make_chat(pool, user, "unsummarized");
    const facts_only = await make_chat(pool, user, "facts only");
    await add_to_project(pool, project, active);
    await add_to_project(pool, project, summarized);
    await add_to_project(pool, project, unsummarized);
    await add_to_project(pool, project, facts_only);
    await db.memory_db.upsert_chat_memory(summarized, user, "a summary", T0);
    await db.memory_db.upsert_chat_memory(facts_only, user, "some facts", T0, "facts");

    const siblings = await db.memory_db.get_sibling_summaries(active, user);
    assert.deepEqual(siblings.map((s) => s.chat_id), [summarized]);
  });

  it("returns nothing when the project's memory is disabled", async () => {
    const user = await make_user(pool, "alice");
    const project = await make_project(pool, user, false);
    const active = await make_chat(pool, user, "active");
    const sibling = await make_chat(pool, user, "sibling");
    await add_to_project(pool, project, active);
    await add_to_project(pool, project, sibling);
    await db.memory_db.upsert_chat_memory(sibling, user, "a summary", T0);

    assert.deepEqual(await db.memory_db.get_sibling_summaries(active, user), []);
  });

  it("returns nothing for a chat that is not in a project", async () => {
    const user = await make_user(pool, "alice");
    const project = await make_project(pool, user, true);
    const loose = await make_chat(pool, user, "not in any project");
    const in_project = await make_chat(pool, user, "in the project");
    await add_to_project(pool, project, in_project);
    await db.memory_db.upsert_chat_memory(in_project, user, "a summary", T0);

    assert.deepEqual(await db.memory_db.get_sibling_summaries(loose, user), []);
  });

  it("never crosses user boundaries", async () => {
    const alice = await make_user(pool, "alice");
    const mallory = await make_user(pool, "mallory");
    const project = await make_project(pool, alice, true);
    const active = await make_chat(pool, alice, "active");
    const sibling = await make_chat(pool, alice, "sibling");
    await add_to_project(pool, project, active);
    await add_to_project(pool, project, sibling);
    await db.memory_db.upsert_chat_memory(sibling, alice, "alice's summary", T0);

    // Another user probing with alice's chat id sees nothing.
    assert.deepEqual(await db.memory_db.get_sibling_summaries(active, mallory), []);

    // Defense in depth: project_chats has no user-consistency constraint, so
    // even if another user's chat were linked into alice's project, its
    // summary must not surface for alice.
    const planted = await make_chat(pool, mallory, "mallory's chat");
    await add_to_project(pool, project, planted);
    await db.memory_db.upsert_chat_memory(planted, mallory, "mallory's summary", T1);

    assert.deepEqual(
      (await db.memory_db.get_sibling_summaries(active, alice)).map((s) => s.chat_id),
      [sibling]);
  });

  // Soft-delete (011) is still in flight: nothing filters trashed siblings
  // out of this query yet, so a summary of a chat in the trash still
  // surfaces. Decide whether that's intended once the service-layer
  // filtering lands, then pin it with a real test.
  it.todo("trashed (deleted_at set) siblings — include or exclude?");
});
