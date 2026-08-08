// transaction.test.ts
//
// Exercises with_transaction against the real database. The behaviour under
// test is not in any one service -- it is that writes made through several
// services commit or roll back together, and that connections are returned to
// the pool either way.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import * as pg from "pg";
import { make_db_services } from "db";
import { make_test_pool, reset_db } from "./harness.js";
import { count_by_user, make_file, make_user } from "./common.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

// Distinguishes a failure the test caused on purpose from a real one.
class Boom extends Error {}

//------------------------------------------------------------------------------
// commit / rollback
//------------------------------------------------------------------------------

describe("with_transaction", () => {
  it("commits every service's writes when the body returns", async () => {
    const user_id = await make_user(pool, "commits");

    const chat_id = await db.transaction(async (tx) => {
      const chat = await tx.chat_db.create_chat(user_id, "kept");
      const project = await tx.project_db.create_project(user_id, "kept");
      await tx.project_db.add_chat_to_project(project.id, chat.id, user_id);
      return chat.id;
    });

    assert.equal(await count_by_user(pool, "chats", user_id), 1);
    assert.equal(await count_by_user(pool, "projects", user_id), 1);
    const links = await pool.query(
      "SELECT 1 FROM project_chats WHERE chat_id = $1", [chat_id]);
    assert.equal(links.rows.length, 1);
  });

  it("rolls back every service's writes when the body throws", async () => {
    const user_id = await make_user(pool, "rollsback");

    await assert.rejects(
      db.transaction(async (tx) => {
        const chat = await tx.chat_db.create_chat(user_id, "discarded");
        const project = await tx.project_db.create_project(user_id, "discarded");
        await tx.project_db.add_chat_to_project(project.id, chat.id, user_id);
        throw new Boom("body failed");
      }),
      Boom);

    assert.equal(await count_by_user(pool, "chats", user_id), 0);
    assert.equal(await count_by_user(pool, "projects", user_id), 0);
  });

  it("propagates the body's error, not a cleanup error", async () => {
    const user_id = await make_user(pool, "propagates");

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.chat_db.create_chat(user_id, "discarded");
        throw new Boom("the original failure");
      }),
      (err: unknown) => err instanceof Boom &&
        err.message === "the original failure");
  });

  it("rolls back a partially applied multi-table write", async () => {
    // The shape the file-upload path needs: a row and its junction link either
    // both land or neither does.
    const user_id = await make_user(pool, "partial");
    const file_id = await make_file(pool, user_id);

    await assert.rejects(
      db.transaction(async (tx) => {
        const project = await tx.project_db.create_project(user_id, "p");
        await tx.project_db.add_file_to_project(project.id, file_id, user_id);
        await tx.file_db.update_file_status(file_id, "parsed" as never);
        throw new Boom("failed after linking");
      }),
      Boom);

    assert.equal(await count_by_user(pool, "projects", user_id), 0);
    const links = await pool.query(
      "SELECT 1 FROM project_files WHERE file_id = $1", [file_id]);
    assert.equal(links.rows.length, 0);
    const file = await pool.query(
      "SELECT status FROM files WHERE id = $1", [file_id]);
    assert.equal(file.rows[0].status, "uploaded");
  });

  it("returns the body's value", async () => {
    assert.equal(await db.transaction(async () => 42), 42);
  });
});

//------------------------------------------------------------------------------
// enlistment
//------------------------------------------------------------------------------

describe("with_transaction enlistment", () => {
  it("does not roll back a service still bound to the pool", async () => {
    // Pins the documented footgun: only the service set the body is handed is
    // in the transaction. A service captured from an enclosing scope still runs
    // on the pool, so its write survives the rollback.
    const user_id = await make_user(pool, "unenlisted");

    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.chat_db.create_chat(user_id, "enlisted");
        await db.project_db.create_project(user_id, "not enlisted");
        throw new Boom("body failed");
      }),
      Boom);

    assert.equal(await count_by_user(pool, "chats", user_id), 0);
    assert.equal(await count_by_user(pool, "projects", user_id), 1);
  });

  it("leaves the pool-bound services usable after a transaction", async () => {
    const user_id = await make_user(pool, "nonmutating");

    await db.transaction(async (tx) => {
      await tx.chat_db.create_chat(user_id, "in tx");
    });
    await db.chat_db.create_chat(user_id, "after tx");

    assert.equal(await count_by_user(pool, "chats", user_id), 2);
  });
});

//------------------------------------------------------------------------------
// connection handling
//------------------------------------------------------------------------------

describe("with_transaction connection handling", () => {
  it("releases the connection on both paths", async () => {
    // More iterations than the pool's default max (10), so a leak on either
    // path exhausts the pool and this hangs rather than fails.
    const user_id = await make_user(pool, "released");

    for (let i = 0; i < 25; i++) {
      await db.transaction(async (tx) => {
        await tx.chat_db.create_chat(user_id, `ok-${i}`);
      });
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.chat_db.create_chat(user_id, `bad-${i}`);
          throw new Boom("discarded");
        }),
        Boom);
    }

    assert.equal(await count_by_user(pool, "chats", user_id), 25);
    assert.equal((pool as pg.Pool).idleCount > 0, true);
  });

  it("does not leave an open transaction on a reused connection", async () => {
    // A connection returned to the pool mid-transaction would make the next
    // caller's writes vanish. Force reuse by running sequentially.
    const user_id = await make_user(pool, "noleak");

    await assert.rejects(
      db.transaction(async () => { throw new Boom("discarded"); }), Boom);
    await db.chat_db.create_chat(user_id, "after a failed transaction");

    assert.equal(await count_by_user(pool, "chats", user_id), 1);
  });
});
