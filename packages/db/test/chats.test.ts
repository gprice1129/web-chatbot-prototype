// chats.test.ts
//
// Exercises chat registration against the real database: a chat is bound to
// the application that serves it, only while it is unregistered.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { make_db_services } from "db";
import { make_test_pool, reset_db } from "./harness.js";
import { add_message, make_chat, make_user } from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

// The application a chat is registered to, read straight from the table.
async function registered_to(chat_id: string): Promise<string | null> {
  const result = await pool.query(
    "SELECT application_slug FROM chats WHERE id = $1", [chat_id]);
  return result.rows[0].application_slug;
}

describe("create_chat", () => {
  it("creates an unregistered chat", async () => {
    const user_id = await make_user(pool, "unregistered");

    const chat = await db.chat_db.create_chat(user_id, "c");

    assert.equal(chat.application_slug, null);
  });
});

describe("register_chat", () => {
  it("registers an unregistered chat", async () => {
    const user_id = await make_user(pool, "registers");
    const chat_id = await make_chat(pool, user_id);

    const chat = await db.chat_db.register_chat(chat_id, user_id, "ally");

    assert.ok(chat);
    assert.equal(chat.application_slug, "ally");
  });

  it("registers a chat that already has messages", async () => {
    const user_id = await make_user(pool, "has-messages");
    const chat_id = await make_chat(pool, user_id);
    await add_message(pool, chat_id, "user");

    const chat = await db.chat_db.register_chat(chat_id, user_id, "ally");

    assert.ok(chat);
    assert.equal(chat.application_slug, "ally");
  });

  it("refuses a chat that is already registered", async () => {
    const user_id = await make_user(pool, "already");
    const chat_id = await make_chat(pool, user_id);
    await db.chat_db.register_chat(chat_id, user_id, "ally");

    const chat = await db.chat_db.register_chat(chat_id, user_id, "grant-reviewer");

    assert.equal(chat, null);
    assert.equal(await registered_to(chat_id), "ally");
  });

  it("refuses another user's chat", async () => {
    const owner_id = await make_user(pool, "owner");
    const other_id = await make_user(pool, "other");
    const chat_id = await make_chat(pool, owner_id);

    const chat = await db.chat_db.register_chat(chat_id, other_id, "ally");

    assert.equal(chat, null);
    assert.equal(await registered_to(chat_id), null);
  });

  it("rejects a slug with no application", async () => {
    const user_id = await make_user(pool, "unknown");
    const chat_id = await make_chat(pool, user_id);

    await assert.rejects(db.chat_db.register_chat(chat_id, user_id, "no-such-app"));
    assert.equal(await registered_to(chat_id), null);
  });
});

describe("get_chats_by_user", () => {
  it("returns each chat's application slug, or null while unregistered", async () => {
    const user_id = await make_user(pool, "lists");
    const registered_id = await make_chat(pool, user_id, "registered");
    const unregistered_id = await make_chat(pool, user_id, "unregistered");
    await db.chat_db.register_chat(registered_id, user_id, "grant-reviewer");

    const chats = await db.chat_db.get_chats_by_user(user_id);

    const slugs = Object.fromEntries(chats.map((c) => [c.id, c.application_slug]));
    assert.deepEqual(slugs, {
      [registered_id]: "grant-reviewer",
      [unregistered_id]: null,
    });
  });
});

describe("applications.slug", () => {
  it("must be lowercase", async () => {
    await assert.rejects(pool.query(
      "INSERT INTO applications (slug, name) VALUES ('Mixed-Case', 'x')"));
  });
});

describe("get_application_by_slug", () => {
  it("finds an enabled application case-insensitively", async () => {
    const app = await db.application_db.get_application_by_slug("ALLY");

    assert.ok(app);
    assert.equal(app.slug, "ally");
  });

  it("returns null for an unknown slug", async () => {
    assert.equal(await db.application_db.get_application_by_slug("no-such-app"), null);
  });

  it("returns null for a disabled application", async () => {
    await pool.query("UPDATE applications SET enabled = false WHERE slug = 'ally'");
    try {
      assert.equal(await db.application_db.get_application_by_slug("ally"), null);
    } finally {
      await pool.query("UPDATE applications SET enabled = true WHERE slug = 'ally'");
    }
  });
});
