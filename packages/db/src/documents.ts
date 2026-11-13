export { DocumentDbService };

import assert from "node:assert";
import type { DocumentAuthor } from "common";
import type { Executor } from "./transaction.js";
import type { DocumentHead, DocumentRecord, DocumentVersion } from "./types.js";

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

  // Moves the head pointer and records the version in one statement, only
  // when the document is the user's and still at `revision`. Null means it was
  // not: the write was made against a revision that has moved on, and nothing
  // changed. `file_id` must already hold the content.
  async add_version(
    document_id: string,
    user_id: string,
    revision: number,
    file_id: string,
    written_by: DocumentAuthor,
    section_id: string,
  ): Promise<DocumentRecord | null> {
    const result = await this._exec.query(
      `WITH moved AS (
         UPDATE documents SET revision = revision + 1
          WHERE id = $1 AND user_id = $2 AND revision = $3
          RETURNING *
       ),
       versioned AS (
         INSERT INTO document_versions (document_id, revision, file_id, written_by, section_id)
         SELECT id, revision, $4, $5, $6 FROM moved
       )
       SELECT * FROM moved`,
      [document_id, user_id, revision, file_id, written_by, section_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  // The document's row and the id of the file holding its current content,
  // read together so the two always agree. `file_id` is null before the first
  // write.
  async get_document_head(
    document_id: string, user_id: string,
  ): Promise<DocumentHead | null> {
    const result = await this._exec.query(
      `SELECT d.*, v.file_id AS head_file_id
         FROM documents d
         LEFT JOIN document_versions v
                ON v.document_id = d.id AND v.revision = d.revision
        WHERE d.id = $1 AND d.user_id = $2`,
      [document_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    const { head_file_id, ...document } = result.rows[0];
    return { document, file_id: head_file_id };
  }

  // The version the head pointer names; null before the first write.
  async get_head_version(
    document_id: string, user_id: string,
  ): Promise<DocumentVersion | null> {
    const result = await this._exec.query(
      `SELECT v.*
         FROM document_versions v
         JOIN documents d ON d.id = v.document_id AND d.revision = v.revision
        WHERE d.id = $1 AND d.user_id = $2`,
      [document_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async get_versions(
    document_id: string, user_id: string,
  ): Promise<DocumentVersion[]> {
    const result = await this._exec.query(
      `SELECT v.*
         FROM document_versions v
         JOIN documents d ON d.id = v.document_id
        WHERE d.id = $1 AND d.user_id = $2
        ORDER BY v.revision ASC`,
      [document_id, user_id]);
    return result.rows;
  }

  async delete_document(document_id: string, user_id: string): Promise<boolean> {
    const result = await this._exec.query(
      "DELETE FROM documents WHERE id = $1 AND user_id = $2",
      [document_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }
}
