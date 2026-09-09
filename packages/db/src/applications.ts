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
}
