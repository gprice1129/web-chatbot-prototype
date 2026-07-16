export { MemoryDbService };

import * as pg from "pg";

class MemoryDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async upsert_chat_memory(
    chat_id: string,
    user_id: string,
    content: string,
    source_through: Date,
    kind: string = "summary",
  ): Promise<void> {
    await this._pool.query(
      `INSERT INTO chat_memories (chat_id, user_id, kind, content, source_through)
       SELECT $1, $2, $5, $3, $4
        WHERE EXISTS (SELECT 1 FROM chats WHERE id = $1 AND user_id = $2)
       ON CONFLICT (chat_id, kind) DO UPDATE SET
         content        = EXCLUDED.content,
         source_through = EXCLUDED.source_through,
         updated_at     = now()
        WHERE chat_memories.source_through <= EXCLUDED.source_through`,
      [chat_id, user_id, content, source_through, kind]);
  }

  async get_stale_summary_chats(
    limit: number
  ): Promise<{ chat_id: string; user_id: string }[]> {
    const result = await this._pool.query(
      `SELECT c.id AS chat_id, c.user_id
         FROM chats c
         JOIN LATERAL (
           SELECT max(cm.created_at) AS last_message_at
             FROM chat_messages cm
            WHERE cm.chat_id = c.id
              AND cm.role IN ('user', 'assistant')
         ) m ON m.last_message_at IS NOT NULL
         LEFT JOIN chat_memories mem
           ON mem.chat_id = c.id AND mem.kind = 'summary'
        WHERE mem.chat_id IS NULL
           OR mem.source_through < date_trunc('milliseconds', m.last_message_at)
        ORDER BY m.last_message_at ASC
        LIMIT $1`,
      [limit]);
    return result.rows;
  }

  // The summaries of the other chats in the active chat's project.
  async get_sibling_summaries(
    chat_id: string, user_id: string
  ): Promise<{ chat_id: string; title: string; summary: string }[]> {
    const result = await this._pool.query(
      `SELECT sib.id AS chat_id, sib.title, mem.content AS summary
         FROM project_chats active_pc
         JOIN projects p
           ON p.id = active_pc.project_id
          AND p.user_id = $2
          AND p.memory_enabled = true
         JOIN project_chats sib_pc ON sib_pc.project_id = p.id
         JOIN chats sib ON sib.id = sib_pc.chat_id AND sib.user_id = $2
         JOIN chat_memories mem
           ON mem.chat_id = sib.id AND mem.kind = 'summary' AND mem.user_id = $2
        WHERE active_pc.chat_id = $1
          AND sib.id <> $1
        ORDER BY mem.source_through DESC`,
      [chat_id, user_id]);
    return result.rows;
  }
}
