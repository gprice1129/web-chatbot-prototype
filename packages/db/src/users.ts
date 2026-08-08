export { UserDbService };

import assert from "node:assert";
import type { Executor } from "./transaction.js";
import type { User } from "./types.js";

class UserDbService {
  private _exec: Executor;
  constructor(exec: Executor) {
    this._exec = exec;
  }

  async get_user_by_username(username: string): Promise<User | null> {
    const result = await this._exec.query(
      "SELECT id, password_hash FROM users WHERE username = $1",
      [username]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async create_user_if_absent(
    username: string,
    email: string,
    password_hash: string
  ): Promise<void> {
    await this._exec.query(
      `INSERT INTO users (username, email, email_verified, password_hash)
       VALUES ($1, $2, true, $3)
       ON CONFLICT DO NOTHING`,
      [username, email, password_hash]);
  }
}
