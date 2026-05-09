export {
  Application,
  Chat,
  File,
  FileStatus,
  Session,
  User
}

import assert from "node:assert";
import * as pg from "pg";

enum FileStatus {
  UPLOADED = "uploaded",
  QUEUED = "queued",
  PARSED = "parsed",
  PARSE_FAILED = "parse_failed",
}

interface Session {
  id: string;
  user_id: string;
  session_token: string;
  auth_method: string;
  created_at: Date;
  expires_at: Date;
  last_activity_at: Date;
  revoked_at: Date | null;
  ip_address: string | null;
  user_agent: string | null;
}

interface User {
  id: string;
  password_hash: string;
}

interface Application {
  id: string;
  name: string;
  description: string | null;
}

interface Chat {
  id: string;
  user_id: string;
  application_id: string;
  title: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface File {
  id: string;
  user_id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: string; // bigint deserializes to string from pg
  checksum_sha256: string | null;
  storage_backend: string;
  storage_key: string;
  status: FileStatus;
  parse_error: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

class DatabaseService {
  private _pool: pg.Pool;
  constructor() {
    this._pool = new pg.Pool();
  }

  async get_user_by_username(username: string): Promise<User | null> {
    const result = await this._pool.query(
      "SELECT id, password_hash FROM users WHERE username = $1",
      [username]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create_session(
    user_id: string,
    session_token: string,
    auth_method: string,
    expires_at: Date,
    ip_address: string | null,
    user_agent: string | null
  ): Promise<Session> {
    const result = await this._pool.query(
      `INSERT INTO sessions (user_id, session_token, auth_method, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, session_token, auth_method, expires_at, ip_address, user_agent]);
    return result.rows[0];
  }

  async get_session_by_token(session_token: string): Promise<Session | null> {
    const result = await this._pool.query(
      `SELECT * FROM sessions
       WHERE session_token = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [session_token]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async touch_session(session_token: string): Promise<void> {
    await this._pool.query(
      "UPDATE sessions SET last_activity_at = now() WHERE session_token = $1",
      [session_token]);
  }

  async revoke_session(session_token: string): Promise<void> {
    await this._pool.query(
      "UPDATE sessions SET revoked_at = now() WHERE session_token = $1 AND revoked_at IS NULL",
      [session_token]);
  }

  async revoke_all_user_sessions(user_id: string): Promise<void> {
    await this._pool.query(
      "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [user_id]);
  }

  async create_file_if_absent(
    id: string,
    user_id: string,
    chat_id: string,
    original_filename: string | null,
    mime_type: string,
    // TODO:[db] size_bytes is string on read and number on write
    size_bytes: number,
    checksum_sha256: string,
    storage_backend: string,
    storage_key: string,
    status: FileStatus,
  ): Promise<{ file: File; created: boolean }> {
    // Single CTE so the file insert, the dedup fallback, and the chat_files
    // attachment all land atomically.
    const result = await this._pool.query(
      `WITH ins AS (
         INSERT INTO files (id, user_id, original_filename, mime_type, size_bytes,
                            checksum_sha256, storage_backend, storage_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (user_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL
           DO NOTHING
         RETURNING *, true AS created
       ),
       existing AS (
         SELECT *, false AS created FROM files
          WHERE user_id = $2 AND checksum_sha256 = $6
            AND NOT EXISTS (SELECT 1 FROM ins)
       ),
       combined AS (
         SELECT * FROM ins UNION ALL SELECT * FROM existing
       ),
       linked AS (
         INSERT INTO chat_files (chat_id, file_id)
         SELECT $10, id FROM combined
         ON CONFLICT DO NOTHING
       )
       SELECT * FROM combined`,
      [id, user_id, original_filename, mime_type, size_bytes,
       checksum_sha256, storage_backend, storage_key, status, chat_id]);
    assert(result.rows.length === 1);
    const { created, ...file } = result.rows[0];
    return { file: file as File, created };
  }

  async get_file_by_id(
    id: string, chat_id: string, user_id: string
  ): Promise<File | null> {
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE f.id = $1 AND cf.chat_id = $2 AND f.user_id = $3`,
      [id, chat_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async update_file_status(
    id: string,
    status: FileStatus,
    parse_error: string | null = null
  ): Promise<void> {
    await this._pool.query(
      "UPDATE files SET status = $2, parse_error = $3 WHERE id = $1",
      [id, status, parse_error]);
  }

  async list_enabled_applications(): Promise<Application[]> {
    const result = await this._pool.query(
      "SELECT id, name, description FROM applications WHERE enabled ORDER BY created_at");
    return result.rows;
  }

  async get_chat_by_id(id: string, user_id: string): Promise<Chat | null> {
    const result = await this._pool.query(
      "SELECT * FROM chats WHERE id = $1 AND user_id = $2",
      [id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create_chat(
    user_id: string,
    application_id: string,
  ): Promise<Chat | null> {
    // Insert only if the application exists AND is enabled. Returning zero
    // rows means the caller passed an unknown or disabled application_id.
    const result = await this._pool.query(
      `INSERT INTO chats (user_id, application_id)
       SELECT $1, $2
       WHERE EXISTS (SELECT 1 FROM applications WHERE id = $2 AND enabled)
       RETURNING *`,
      [user_id, application_id]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async close(): Promise<void> {
    await this._pool.end();
  }

  async create_user_if_absent(
    username: string,
    email: string,
    password_hash: string
  ): Promise<void> {
    await this._pool.query(
      `INSERT INTO users (username, email, email_verified, password_hash)
       VALUES ($1, $2, true, $3)
       ON CONFLICT DO NOTHING`,
      [username, email, password_hash]);
  }
}

export default DatabaseService;
