export { DocumentDbService };

import assert from "node:assert";
import type { DocumentAuthor } from "common";
import type { Executor } from "./transaction.js";
import type { DocumentRecord } from "./types.js";

// Documents as rows: identity, ownership and the head pointer. Content lives
// in versions, which are files.
class DocumentDbService {
  private _exec: Executor;
  constructor(exec: Executor) {
    this._exec = exec;
  }

  async create_document(
    user_id: string, template_id: string | null, writable_by: DocumentAuthor[],
  ): Promise<DocumentRecord> {
    const result = await this._exec.query(
      `INSERT INTO documents (user_id, template_id, writable_by)
       VALUES ($1, $2, $3::text[]) RETURNING *`,
      [user_id, template_id, writable_by]);
    assert(result.rows.length === 1);
    return result.rows[0];
  }

  async get_document_by_id(
    document_id: string, user_id: string,
  ): Promise<DocumentRecord | null> {
    const result = await this._exec.query(
      "SELECT * FROM documents WHERE id = $1 AND user_id = $2",
      [document_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async get_documents_by_chat(
    chat_id: string, user_id: string,
  ): Promise<DocumentRecord[]> {
    const result = await this._exec.query(
      `SELECT d.*
         FROM documents d
         JOIN chat_documents cd ON cd.document_id = d.id
        WHERE cd.chat_id = $1 AND d.user_id = $2
        ORDER BY cd.created_at ASC`,
      [chat_id, user_id]);
    return result.rows;
  }

  // False when the chat or the document is not the user's. Attaching twice is
  // a no-op that still reports true.
  async attach_document(
    chat_id: string, document_id: string, user_id: string,
  ): Promise<boolean> {
    const result = await this._exec.query(
      `WITH owned AS (
         SELECT c.id AS chat_id, d.id AS document_id
           FROM chats c, documents d
          WHERE c.id = $1 AND c.user_id = $3
            AND d.id = $2 AND d.user_id = $3
       ),
       linked AS (
         INSERT INTO chat_documents (chat_id, document_id)
         SELECT chat_id, document_id FROM owned
         ON CONFLICT DO NOTHING
       )
       SELECT count(*)::int AS n FROM owned`,
      [chat_id, document_id, user_id]);
    return result.rows[0].n > 0;
  }

  async delete_document(document_id: string, user_id: string): Promise<boolean> {
    const result = await this._exec.query(
      "DELETE FROM documents WHERE id = $1 AND user_id = $2",
      [document_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }
}
