export { ApplicationDbService };

import type { Executor } from "./transaction.js";
import type { Application } from "./types.js";

class ApplicationDbService {
  private _exec: Executor;
  constructor(exec: Executor) {
    this._exec = exec;
  }

  async list_enabled_applications(): Promise<Application[]> {
    const result = await this._exec.query(
      "SELECT id, slug, name, description FROM applications WHERE enabled ORDER BY created_at");
    return result.rows;
  }

  async get_application_by_slug(slug: string): Promise<Application | null> {
    const result = await this._exec.query(
      `SELECT id, slug, name, description FROM applications
        WHERE lower(slug) = lower($1) AND enabled`,
      [slug]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }
}
