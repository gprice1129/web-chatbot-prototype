// chats.test.ts
//
// Exercises ChatDbService.create_chat against the real database: a new chat
// records the application that created it, looked up by slug.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { make_db_services } from "db";
import { make_test_pool, reset_db } from "./harness.js";
import { count_by_user, make_user } from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

// The id of a seeded application.
async function application_id(slug: string): Promise<string> {
  const result = await pool.query(
    "SELECT id FROM applications WHERE slug = $1", [slug]);
  return result.rows[0].id;
}

describe("create_chat", () => {
  it("records the application named by the slug", async () => {
    const user_id = await make_user(pool, "records");

    const chat = await db.chat_db.create_chat(user_id, "c", "grant-reviewer");

    assert.ok(chat);
    assert.equal(chat.application_id, await application_id("grant-reviewer"));
  });

  it("matches the slug case-insensitively", async () => {
    const user_id = await make_user(pool, "caseless");

    const chat = await db.chat_db.create_chat(user_id, "c", "ALLY");

    assert.ok(chat);
    assert.equal(chat.application_id, await application_id("ally"));
  });

  it("returns null and inserts nothing for an unknown slug", async () => {
    const user_id = await make_user(pool, "unknown");

    const chat = await db.chat_db.create_chat(user_id, "c", "no-such-app");

    assert.equal(chat, null);
    assert.equal(await count_by_user(pool, "chats", user_id), 0);
  });

  it("returns null and inserts nothing for a disabled application", async () => {
    const user_id = await make_user(pool, "disabled");
    await pool.query("UPDATE applications SET enabled = false WHERE slug = 'ally'");

    try {
      const chat = await db.chat_db.create_chat(user_id, "c", "ally");

      assert.equal(chat, null);
      assert.equal(await count_by_user(pool, "chats", user_id), 0);
    } finally {
      await pool.query("UPDATE applications SET enabled = true WHERE slug = 'ally'");
    }
  });
});
