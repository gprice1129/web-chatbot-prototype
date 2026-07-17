export { FileDbService };

import assert from "node:assert";
import * as pg from "pg";
import type { File, FileStatus } from "./types.js";

class FileDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async create_file_if_absent(
    file_id: string,
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
      [file_id, user_id, original_filename, mime_type, size_bytes,
       checksum_sha256, storage_backend, storage_key, status, chat_id,
       metadata]);
    assert(result.rows.length === 1);
    const { created, ...file } = result.rows[0];
    return { file: file as File, created };
  }

  async update_file_status(
    file_id: string,
    status: FileStatus,
    parse_error: string | null = null
  ): Promise<void> {
    await this._pool.query(
      "UPDATE files SET status = $2, parse_error = $3 WHERE id = $1",
      [file_id, status, parse_error]);
  }

  async get_chat_files(chat_id: string, user_id: string): Promise<File[]> {
    const result = await this._pool.query(
      `SELECT f.*
       FROM files f
       JOIN chat_files cf ON cf.file_id = f.id
       WHERE cf.chat_id = $1 AND f.user_id = $2
       ORDER BY f.created_at DESC`,
      [chat_id, user_id]);
    return result.rows;
  }

  async get_file_by_id(
    file_id: string, chat_id: string, user_id: string
  ): Promise<File | null> {
    const files = await this.get_files_by_ids([file_id], chat_id, user_id);
    assert(files.length <= 1);
    return files[0] ?? null;
  }

  async get_files_by_ids(
    file_ids: string[], chat_id: string, user_id: string
  ): Promise<File[]> {
    if (file_ids.length === 0) return [];
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE f.id = ANY($1::uuid[])
          AND cf.chat_id = $2
          AND f.user_id = $3`,
      [file_ids, chat_id, user_id]);
    return result.rows;
  }
}
