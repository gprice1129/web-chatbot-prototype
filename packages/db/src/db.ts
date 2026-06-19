export {
  Application,
  Chat,
  ChatMessage,
  ChatMessageRole,
  ChatMessageWithFileIds,
  File,
  FileStatus,
  Project,
  Session,
  User,
  resolve_secret
}

import assert from "node:assert";
import * as fs from "node:fs";
import * as pg from "pg";

// Resolve a secret from either NAME (a plaintext env var) or NAME_FILE (a path
// to a file holding the value, e.g. a Docker secret mounted at /run/secrets).
// The plaintext env var wins when both are set; a trailing newline in the file
// is stripped. Returns undefined when neither is provided.
function resolve_secret(name: string): string | undefined {
  const direct = process.env[name];
  if (undefined !== direct && "" !== direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, "utf8").trim();
  return undefined;
}

enum FileStatus {
  UPLOADED = "uploaded",
  QUEUED = "queued",
  PARSED = "parsed",
  PARSE_FAILED = "parse_failed",
}

enum ChatMessageRole {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
  TOOL = "tool",
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
  slug: string;
  name: string;
  description: string | null;
}

interface Chat {
  id: string;
  user_id: string;
  title: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface Project {
  id: string;
  user_id: string;
  name: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
}

// Messages carry only the ids of attached files; clients hydrate to full File
// rows through get_files_by_ids (the POST /chats/:chat_id/files/info endpoint)
// so status transitions (queued -> parsed) reflect without snapshotting.
interface ChatMessageWithFileIds extends ChatMessage {
  file_ids: string[];
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
    // pg reads PGHOST/PGPORT/PGUSER/PGDATABASE from the environment directly;
    // the password additionally supports the *_FILE secret convention. When no
    // password is resolved, fall back to pg's own env handling (no change).
    const password = resolve_secret("PGPASSWORD");
    this._pool = new pg.Pool(undefined !== password ? { password } : {});
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
    metadata: Record<string, unknown> = {},
  ): Promise<{ file: File; created: boolean }> {
    // Single CTE so the file insert, the dedup fallback, and the chat_files
    // attachment all land atomically.
    const result = await this._pool.query(
      `WITH ins AS (
         INSERT INTO files (id, user_id, original_filename, mime_type, size_bytes,
                            checksum_sha256, storage_backend, storage_key, status,
                            metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $11)
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
       checksum_sha256, storage_backend, storage_key, status, chat_id,
       metadata]);
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
      "SELECT id, slug, name, description FROM applications WHERE enabled ORDER BY created_at");
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

  async get_chats_by_user(user_id: string): Promise<Chat[]> {
    const result = await this._pool.query(
      "SELECT * FROM chats WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]);
    return result.rows;
  }

  async create_chat(user_id: string, title: string): Promise<Chat> {
    const result = await this._pool.query(
      `INSERT INTO chats (user_id, title) VALUES ($1, $2) RETURNING *`,
      [user_id, title]);
    return result.rows[0];
  }

  async get_chat_messages_by_chat_id(
    chat_id: string, user_id: string
  ): Promise<ChatMessageWithFileIds[]> {
    // Attached file ids are aggregated in a LATERAL subquery so the result is
    // one row per message (no fanout) and one round-trip (no N+1). array_agg
    // returns NULL when there are no matches, hence the COALESCE to {}.
    const result = await this._pool.query(
      `SELECT cm.id, cm.chat_id, cm.role, cm.content, cm.metadata, cm.created_at,
              COALESCE(mf.file_ids, '{}'::uuid[]) AS file_ids
         FROM chat_messages cm
         JOIN chats c ON c.id = cm.chat_id
         LEFT JOIN LATERAL (
           SELECT array_agg(cmf.file_id ORDER BY cmf.created_at) AS file_ids
             FROM chat_message_files cmf
            WHERE cmf.message_id = cm.id
         ) mf ON true
        WHERE cm.chat_id = $1 AND c.user_id = $2
        ORDER BY cm.created_at ASC`,
      [chat_id, user_id]);
    return result.rows;
  }

  async get_chat_files(chat_id: string, user_id: string): Promise<File[]> {
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE cf.chat_id = $1 AND f.user_id = $2
        ORDER BY f.created_at DESC`,
      [chat_id, user_id]);
    return result.rows;
  }

  async get_files_by_ids(
    ids: string[], chat_id: string, user_id: string
  ): Promise<File[]> {
    // Scoped to the chat (via chat_files) and the user, matching the
    // existence semantics of get_file_by_id — ids the caller cannot see are
    // silently omitted rather than 404'd, so a partial result is normal.
    if (ids.length === 0) return [];
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE f.id = ANY($1::uuid[])
          AND cf.chat_id = $2
          AND f.user_id = $3`,
      [ids, chat_id, user_id]);
    return result.rows;
  }

  async create_chat_message(
    chat_id: string,
    role: ChatMessageRole,
    content: string,
    metadata: Record<string, unknown> = {},
    file_ids: string[] = [],
  ): Promise<ChatMessage> {
    // Single CTE so the message insert and any chat_message_files attachments
    // land atomically. An empty file_ids array yields no attachment rows.
    const result = await this._pool.query(
      `WITH msg AS (
         INSERT INTO chat_messages (chat_id, role, content, metadata)
         VALUES ($1, $2, $3, $4)
         RETURNING *
       ),
       attached AS (
         INSERT INTO chat_message_files (message_id, file_id)
         SELECT msg.id, file_id
           FROM msg, unnest($5::uuid[]) AS file_id
         ON CONFLICT DO NOTHING
       )
       SELECT * FROM msg`,
      [chat_id, role, content, metadata, file_ids]);
    assert(result.rows.length === 1);
    return result.rows[0];
  }

  async update_chat_title(
    id: string, user_id: string, title: string
  ): Promise<Chat | null> {
    const result = await this._pool.query(
      `UPDATE chats SET title = $3
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [id, user_id, title]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async get_projects_by_user(user_id: string): Promise<Project[]> {
    const result = await this._pool.query(
      "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]);
    return result.rows;
  }

  async get_project_by_id(id: string, user_id: string): Promise<Project | null> {
    const result = await this._pool.query(
      "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
      [id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create_project(user_id: string, name: string): Promise<Project> {
    const result = await this._pool.query(
      `INSERT INTO projects (user_id, name) VALUES ($1, $2) RETURNING *`,
      [user_id, name]);
    return result.rows[0];
  }

  async update_project_name(
    id: string, user_id: string, name: string
  ): Promise<Project | null> {
    const result = await this._pool.query(
      `UPDATE projects SET name = $3
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [id, user_id, name]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async delete_project(id: string, user_id: string): Promise<boolean> {
    const result = await this._pool.query(
      "DELETE FROM projects WHERE id = $1 AND user_id = $2",
      [id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async get_chats_by_project(
    project_id: string, user_id: string
  ): Promise<Chat[]> {
    // Joined through projects so the project ownership is re-checked here too
    // (defense in depth alongside the project-validate hook), matching the
    // user-scoped style of get_chat_messages_by_chat_id.
    const result = await this._pool.query(
      `SELECT c.* FROM chats c
         JOIN project_chats pc ON pc.chat_id = c.id
         JOIN projects p ON p.id = pc.project_id
        WHERE pc.project_id = $1 AND p.user_id = $2 AND c.user_id = $2
        ORDER BY c.created_at DESC`,
      [project_id, user_id]);
    return result.rows;
  }

  async add_chat_to_project(
    project_id: string, chat_id: string, user_id: string
  ): Promise<boolean> {
    // Guarded insert: the link lands only if BOTH the project and the chat
    // belong to user_id. ON CONFLICT keeps re-adding idempotent (an existing
    // link yields rowCount 0).
    const result = await this._pool.query(
      `INSERT INTO project_chats (project_id, chat_id)
       SELECT p.id, c.id
         FROM projects p, chats c
        WHERE p.id = $1 AND p.user_id = $3
          AND c.id = $2 AND c.user_id = $3
       ON CONFLICT DO NOTHING`,
      [project_id, chat_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async remove_chat_from_project(
    project_id: string, chat_id: string, user_id: string
  ): Promise<boolean> {
    // Scoped by project ownership so a user can only edit their own projects'
    // membership.
    const result = await this._pool.query(
      `DELETE FROM project_chats pc
         USING projects p
        WHERE pc.project_id = p.id
          AND p.id = $1 AND p.user_id = $3
          AND pc.chat_id = $2`,
      [project_id, chat_id, user_id]);
    return (result.rowCount ?? 0) > 0;
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
