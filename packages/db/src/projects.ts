export { ProjectDbService };

import assert from "node:assert";
import * as pg from "pg";
import type { Chat, File, Project } from "./types.js";

class ProjectDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async get_projects_by_user(user_id: string): Promise<Project[]> {
    const result = await this._pool.query(
      "SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]);
    return result.rows;
  }

  async get_project_by_id(project_id: string, user_id: string): Promise<Project | null> {
    const result = await this._pool.query(
      "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
      [project_id, user_id]);
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

  async update_project(
    project_id: string,
    user_id: string,
    fields: {
      name?: string;
      description?: string | null;
      instructions?: string | null;
      memory_enabled?: boolean;
    },
  ): Promise<Project | null> {
    const result = await this._pool.query(
      `UPDATE projects SET
         name           = COALESCE($3, name),
         description    = CASE WHEN $4::boolean
                               THEN $5::text
                               ELSE description
                          END,
         instructions   = CASE WHEN $6::boolean
                               THEN $7::text
                               ELSE instructions
                          END,
         memory_enabled = COALESCE($8, memory_enabled)
        WHERE id = $1 AND user_id = $2
        RETURNING *`,
      [
        project_id,
        user_id,
        fields.name ?? null,
        fields.description !== undefined, fields.description ?? null,
        fields.instructions !== undefined, fields.instructions ?? null,
        fields.memory_enabled ?? null,
      ]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async delete_project(project_id: string, user_id: string): Promise<boolean> {
    const result = await this._pool.query(
      "DELETE FROM projects WHERE id = $1 AND user_id = $2",
      [project_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async get_chats_by_project(
    project_id: string, user_id: string
  ): Promise<Chat[]> {
    const result = await this._pool.query(
      `SELECT c.* FROM chats c
         JOIN project_chats pc ON pc.chat_id = c.id
         JOIN projects p ON p.id = pc.project_id
        WHERE pc.project_id = $1 AND p.user_id = $2 AND c.user_id = $2
        ORDER BY c.created_at DESC`,
      [project_id, user_id]);
    return result.rows;
  }

  async get_project_by_chat_id(
    chat_id: string, user_id: string
  ): Promise<Project | null> {
    // Assumes chats are scoped to a single project.
    const result = await this._pool.query(
      `SELECT p.* FROM projects p
         JOIN project_chats pc ON pc.project_id = p.id
         JOIN chats c ON c.id = pc.chat_id
        WHERE pc.chat_id = $1 AND p.user_id = $2 AND c.user_id = $2`,
      [chat_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async add_chat_to_project(
    project_id: string, chat_id: string, user_id: string
  ): Promise<boolean> {
    const result = await this._pool.query(
      `INSERT INTO project_chats (project_id, chat_id)
       SELECT p.id, c.id
         FROM projects p, chats c
        WHERE p.id = $1 AND p.user_id = $3
          AND c.id = $2 AND c.user_id = $3
       ON CONFLICT (project_id, chat_id) DO NOTHING`,
      [project_id, chat_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async remove_chat_from_project(
    project_id: string, chat_id: string, user_id: string
  ): Promise<boolean> {
    const result = await this._pool.query(
      `DELETE FROM project_chats pc
         USING projects p
        WHERE pc.project_id = p.id
          AND p.id = $1 AND p.user_id = $3
          AND pc.chat_id = $2`,
      [project_id, chat_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async get_project_files(
    project_id: string, user_id: string
  ): Promise<File[]> {
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN project_files pf ON pf.file_id = f.id
         JOIN projects p ON p.id = pf.project_id
        WHERE pf.project_id = $1 AND p.user_id = $2 AND f.user_id = $2
        ORDER BY f.created_at DESC`,
      [project_id, user_id]);
    return result.rows;
  }

  async add_file_to_project(
    project_id: string, file_id: string, user_id: string
  ): Promise<boolean> {
    const result = await this._pool.query(
      `INSERT INTO project_files (project_id, file_id)
       SELECT p.id, f.id
         FROM projects p, files f
        WHERE p.id = $1 AND p.user_id = $3
          AND f.id = $2 AND f.user_id = $3
       ON CONFLICT DO NOTHING`,
      [project_id, file_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }

  async remove_file_from_project(
    project_id: string, file_id: string, user_id: string
  ): Promise<boolean> {
    const result = await this._pool.query(
      `DELETE FROM project_files pf
         USING projects p
        WHERE pf.project_id = p.id
          AND p.id = $1 AND p.user_id = $3
          AND pf.file_id = $2`,
      [project_id, file_id, user_id]);
    return (result.rowCount ?? 0) > 0;
  }
}
