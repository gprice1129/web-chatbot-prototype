// documents.test.ts
//
// Exercises document rows against the real database: ownership, the head
// pointer at rest, and attachment to chats.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { make_db_services } from "db";
import { DocumentAuthor } from "common";
import { make_test_pool, reset_db } from "./harness.js";
import { make_chat, make_file, make_user } from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

const BOTH = [DocumentAuthor.USER, DocumentAuthor.ASSISTANT];

describe("create_document", () => {
  it("starts a document at revision 0 with the template and writers given", async () => {
    const user_id = await make_user(pool, "creator");

    const document = await db.document_db.create_document(user_id, "irb-protocol", BOTH);

    assert.equal(document.user_id, user_id);
    assert.equal(document.template_id, "irb-protocol");
    assert.deepEqual(document.writable_by, BOTH);
    assert.equal(document.revision, 0);
  });

  it("accepts a document with no template that nobody writes", async () => {
    const user_id = await make_user(pool, "uploader");

    const document = await db.document_db.create_document(user_id, null, []);

    assert.equal(document.template_id, null);
    assert.deepEqual(document.writable_by, []);
  });

  it("refuses a writer the schema does not know", async () => {
    const user_id = await make_user(pool, "strict");

    await assert.rejects(
      () => db.document_db.create_document(user_id, null, ["system" as DocumentAuthor]),
      /writable_by/);
  });
});

describe("get_document_by_id", () => {
  it("returns the user's document and not another user's", async () => {
    const owner = await make_user(pool, "owner");
    const other = await make_user(pool, "other");
    const created = await db.document_db.create_document(owner, "irb-protocol", BOTH);

    assert.deepEqual(await db.document_db.get_document_by_id(created.id, owner), created);
    assert.equal(await db.document_db.get_document_by_id(created.id, other), null);
  });
});

describe("attach_document and get_documents_by_chat", () => {
  it("lists a chat's documents in the order attached", async () => {
    const user_id = await make_user(pool, "attacher");
    const chat_id = await make_chat(pool, user_id);
    const first = await db.document_db.create_document(user_id, "irb-protocol", BOTH);
    const second = await db.document_db.create_document(user_id, null, []);

    assert.equal(await db.document_db.attach_document(chat_id, first.id, user_id), true);
    assert.equal(await db.document_db.attach_document(chat_id, second.id, user_id), true);

    const listed = await db.document_db.get_documents_by_chat(chat_id, user_id);
    assert.deepEqual(listed.map((d) => d.id), [first.id, second.id]);
  });

  it("attaches once however often it is asked", async () => {
    const user_id = await make_user(pool, "repeat");
    const chat_id = await make_chat(pool, user_id);
    const document = await db.document_db.create_document(user_id, null, []);

    assert.equal(await db.document_db.attach_document(chat_id, document.id, user_id), true);
    assert.equal(await db.document_db.attach_document(chat_id, document.id, user_id), true);

    assert.equal((await db.document_db.get_documents_by_chat(chat_id, user_id)).length, 1);
  });

  it("refuses to attach across users, and lists nothing for another user", async () => {
    const owner = await make_user(pool, "doc-owner");
    const other = await make_user(pool, "chat-owner");
    const own_chat = await make_chat(pool, owner);
    const other_chat = await make_chat(pool, other);
    const document = await db.document_db.create_document(owner, null, []);

    assert.equal(await db.document_db.attach_document(other_chat, document.id, owner), false);
    assert.equal(await db.document_db.attach_document(own_chat, document.id, other), false);
    assert.equal(await db.document_db.attach_document(own_chat, document.id, owner), true);
    assert.deepEqual(await db.document_db.get_documents_by_chat(own_chat, other), []);
  });
});

describe("delete_document", () => {
  it("removes the user's document and its chat links, leaving the chat", async () => {
    const user_id = await make_user(pool, "deleter");
    const chat_id = await make_chat(pool, user_id);
    const document = await db.document_db.create_document(user_id, null, []);
    await db.document_db.attach_document(chat_id, document.id, user_id);

    assert.equal(await db.document_db.delete_document(document.id, user_id), true);

    assert.equal(await db.document_db.get_document_by_id(document.id, user_id), null);
    assert.deepEqual(await db.document_db.get_documents_by_chat(chat_id, user_id), []);
    assert.equal(await db.chat_db.get_chat_by_id(chat_id, user_id) !== null, true);
  });

  it("deletes nothing for another user", async () => {
    const owner = await make_user(pool, "keeper");
    const other = await make_user(pool, "intruder");
    const document = await db.document_db.create_document(owner, null, []);

    assert.equal(await db.document_db.delete_document(document.id, other), false);
    assert.notEqual(await db.document_db.get_document_by_id(document.id, owner), null);
  });
});

describe("add_version", () => {
  it("moves the head pointer and records the version, in order", async () => {
    const user_id = await make_user(pool, "writer");
    const document = await db.document_db.create_document(user_id, "irb-protocol", BOTH);
    const first_file = await make_file(pool, user_id);
    const second_file = await make_file(pool, user_id);

    const first = await db.document_db.add_version(
      document.id, user_id, 0, first_file, DocumentAuthor.ASSISTANT, "aims");
    const second = await db.document_db.add_version(
      document.id, user_id, 1, second_file, DocumentAuthor.USER, "background");

    assert.equal(first?.revision, 1);
    assert.equal(second?.revision, 2);
    const head = await db.document_db.get_head_version(document.id, user_id);
    assert.equal(head?.revision, 2);
    assert.equal(head?.file_id, second_file);
    assert.equal(head?.written_by, DocumentAuthor.USER);
    assert.equal(head?.section_id, "background");
    const versions = await db.document_db.get_versions(document.id, user_id);
    assert.deepEqual(versions.map((v) => [v.revision, v.file_id]), [[1, first_file], [2, second_file]]);
  });

  it("has no head version before the first write", async () => {
    const user_id = await make_user(pool, "unwritten");
    const document = await db.document_db.create_document(user_id, null, []);

    assert.equal(await db.document_db.get_head_version(document.id, user_id), null);
    assert.deepEqual(await db.document_db.get_versions(document.id, user_id), []);
  });

  it("refuses a write against a revision that has moved on, recording nothing", async () => {
    const user_id = await make_user(pool, "racer");
    const document = await db.document_db.create_document(user_id, "irb-protocol", BOTH);
    const by_user = await make_file(pool, user_id);
    const by_assistant = await make_file(pool, user_id);
    await db.document_db.add_version(document.id, user_id, 0, by_user, DocumentAuthor.USER, "aims");

    const stale = await db.document_db.add_version(
      document.id, user_id, 0, by_assistant, DocumentAuthor.ASSISTANT, "aims");

    assert.equal(stale, null);
    assert.equal((await db.document_db.get_document_by_id(document.id, user_id))?.revision, 1);
    assert.equal((await db.document_db.get_versions(document.id, user_id)).length, 1);
  });

  it("refuses another user's document, and a file that does not exist", async () => {
    const owner = await make_user(pool, "version-owner");
    const other = await make_user(pool, "version-other");
    const document = await db.document_db.create_document(owner, null, [DocumentAuthor.USER]);
    const file_id = await make_file(pool, owner);

    assert.equal(
      await db.document_db.add_version(document.id, other, 0, file_id, DocumentAuthor.USER, "body"),
      null);
    await assert.rejects(
      () => db.document_db.add_version(
        document.id, owner, 0, crypto.randomUUID(), DocumentAuthor.USER, "body"),
      /document_versions_file_id_fkey/);
    assert.equal((await db.document_db.get_document_by_id(document.id, owner))?.revision, 0);
  });

  it("shares one file between revisions, and keeps the file when the document goes", async () => {
    const user_id = await make_user(pool, "sharer");
    const document = await db.document_db.create_document(user_id, "irb-protocol", BOTH);
    const file_id = await make_file(pool, user_id);
    await db.document_db.add_version(document.id, user_id, 0, file_id, DocumentAuthor.USER, "aims");
    await db.document_db.add_version(document.id, user_id, 1, file_id, DocumentAuthor.USER, "aims");

    assert.equal(await db.document_db.delete_document(document.id, user_id), true);

    const file = await pool.query("SELECT 1 FROM files WHERE id = $1", [file_id]);
    assert.equal(file.rows.length, 1);
  });
});
