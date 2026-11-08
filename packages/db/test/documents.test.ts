// documents.test.ts
//
// Exercises document rows against the real database: ownership, the head
// pointer at rest, and attachment to chats.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import { make_db_services } from "db";
import { DocumentAuthor } from "common";
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
