export { ChatDbService };

import assert from "node:assert";
import * as pg from "pg";
import type {
  Chat,
  ChatMessage,
  ChatMessageRole,
  ChatMessageWithFileIds,
  ChatTranscriptTurn,
} from "./types.js";

class ChatDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async get_chat_by_id(chat_id: string, user_id: string): Promise<Chat | null> {
    const result = await this._pool.query(
      "SELECT * FROM chats WHERE id = $1 AND user_id = $2",
      [chat_id, user_id]);
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

  async get_chat_transcript(
    chat_id: string, user_id: string
  ): Promise<ChatTranscriptTurn[]> {
    // Conversational transcript only. Omits file ids.
    const result = await this._pool.query(
      `SELECT cm.role, cm.content, cm.created_at
         FROM chat_messages cm
         JOIN chats c ON c.id = cm.chat_id
        WHERE cm.chat_id = $1 AND c.user_id = $2
          AND cm.role IN ('user', 'assistant')
        ORDER BY cm.created_at ASC`,
      [chat_id, user_id]);
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
    // land atomically.
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
    chat_id: string, user_id: string, title: string
  ): Promise<Chat | null> {
    const result = await this._pool.query(
      `UPDATE chats SET title = $3
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [chat_id, user_id, title]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async delete_chat(chat_id: string, user_id: string): Promise<boolean> {
    const result = await this._pool.query(
      "DELETE FROM chats WHERE id = $1 AND user_id = $2",
      [chat_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }
}
