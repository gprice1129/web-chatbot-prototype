export { ApplicationDbService };

import * as pg from "pg";
import type { Application } from "./types.js";

class ApplicationDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async list_enabled_applications(): Promise<Application[]> {
    const result = await this._pool.query(
      "SELECT id, slug, name, description FROM applications WHERE enabled ORDER BY created_at");
    return result.rows;
  }
}
