export {
  add_message,
  add_to_project,
  count_by_user,
  make_chat,
  make_file,
  make_project,
  make_user,
};

import * as pg from "pg";

// Row fixtures shared by the integration tests. These insert directly rather
// than going through the services, so a test for one service is never gated on
// another service being correct.
//
// Connection setup and the between-test wipe live in harness.ts; this file is
// only about getting rows into the tables.

async function make_user(pool: pg.Pool, name: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, 'test-hash') RETURNING id`,
    [name, `${name}@example.test`]);
  return result.rows[0].id;
}

async function make_chat(
  pool: pg.Pool, user_id: string, title = "chat",
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING id`,
    [user_id, title]);
  return result.rows[0].id;
}

// created_at accepts a Date, or a string when a test needs microsecond
// precision (a JS Date carries only milliseconds). The returned Date is what
// pg hands back -- millisecond-truncated -- exactly what the summarizer job
// sees in production.
async function add_message(
  pool: pg.Pool,
  chat_id: string,
  role: string,
  created_at?: Date | string,
): Promise<Date> {
  const result = await pool.query(
    `INSERT INTO chat_messages (chat_id, role, content, created_at)
     VALUES ($1, $2, 'msg', coalesce($3::timestamptz, now()))
     RETURNING created_at`,
    [chat_id, role, created_at ?? null]);
  return result.rows[0].created_at;
}

// memory_enabled defaults to false, matching the column default; the memory
// tests pass true explicitly because that flag is what they exercise.
async function make_project(
  pool: pg.Pool,
  user_id: string,
  memory_enabled = false,
  name = "project",
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO projects (user_id, name, memory_enabled)
     VALUES ($1, $2, $3) RETURNING id`,
    [user_id, name, memory_enabled]);
  return result.rows[0].id;
}

async function add_to_project(
  pool: pg.Pool, project_id: string, chat_id: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO project_chats (project_id, chat_id) VALUES ($1, $2)`,
    [project_id, chat_id]);
}

// A committed file row, ready to be linked to a chat or a project. The id
// doubles as the storage key, matching uuid_to_path's contract closely enough
// for tests that never touch a blob.
async function make_file(
  pool: pg.Pool, user_id: string, status = "uploaded",
): Promise<string> {
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO files (id, user_id, mime_type, size_bytes, storage_backend,
                        storage_key, status)
     VALUES ($1, $2, 'text/plain', 4, 'local', $3, $4)`,
    [id, user_id, `test/${id}`, status]);
  return id;
}

// Rows in `table` belonging to a user. `table` is interpolated, so it must be a
// literal from the caller -- never test input.
async function count_by_user(
  pool: pg.Pool, table: string, user_id: string,
): Promise<number> {
  const result = await pool.query(
    `SELECT count(*)::int AS n FROM ${table} WHERE user_id = $1`, [user_id]);
  return result.rows[0].n;
}
