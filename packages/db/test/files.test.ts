// files.test.ts
//
// Exercises file rows against the real database: a file is attached to the
// chat it was uploaded to, or to no chat at all.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { make_db_services, FileStatus } from "db";
import { make_test_pool, reset_db } from "./harness.js";
import { make_chat, make_user } from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

// The chats a file is attached to, read straight from the junction.
async function attached_to(file_id: string): Promise<string[]> {
  const result = await pool.query(
    "SELECT chat_id FROM chat_files WHERE file_id = $1", [file_id]);
  return result.rows.map((row) => row.chat_id);
}

function create(user_id: string, chat_id: string | null, checksum: string) {
  return db.file_db.create_file_if_absent(
    crypto.randomUUID(), user_id, chat_id, "f.txt", "text/plain", 4, checksum,
    "local", `test/${crypto.randomUUID()}`, FileStatus.UPLOADED);
}

describe("get_user_file", () => {
  it("finds the user's file whether or not it is in a chat, and nobody else's", async () => {
    const owner = await make_user(pool, "file-owner");
    const other = await make_user(pool, "file-other");
    const chat_id = await make_chat(pool, owner);
    const attached = await create(owner, chat_id, "d".repeat(64));
    const loose = await create(owner, null, "e".repeat(64));

    assert.equal((await db.file_db.get_user_file(attached.file.id, owner))?.id, attached.file.id);
    assert.equal((await db.file_db.get_user_file(loose.file.id, owner))?.id, loose.file.id);
    assert.equal(await db.file_db.get_user_file(loose.file.id, other), null);
    assert.equal(await db.file_db.get_user_file(crypto.randomUUID(), owner), null);
  });
});

describe("create_file_if_absent", () => {
  it("attaches the file to the chat it was given", async () => {
    const user_id = await make_user(pool, "uploader");
    const chat_id = await make_chat(pool, user_id);

    const { file, created } = await create(user_id, chat_id, "a".repeat(64));

    assert.equal(created, true);
    assert.deepEqual(await attached_to(file.id), [chat_id]);
  });

  it("attaches a file given no chat to nothing", async () => {
    const user_id = await make_user(pool, "versioner");

    const { file, created } = await create(user_id, null, "b".repeat(64));

    assert.equal(created, true);
    assert.deepEqual(await attached_to(file.id), []);
  });

  it("hands back the user's existing file for the same content, attaching it to the chat given", async () => {
    const user_id = await make_user(pool, "repeater");
    const chat_id = await make_chat(pool, user_id);
    const first = await create(user_id, null, "c".repeat(64));

    const again = await create(user_id, chat_id, "c".repeat(64));

    assert.equal(again.created, false);
    assert.equal(again.file.id, first.file.id);
    assert.deepEqual(await attached_to(first.file.id), [chat_id]);
  });
});
