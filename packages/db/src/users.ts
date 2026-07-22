export { UserDbService };

import assert from "node:assert";
import * as pg from "pg";
import type { User } from "./types.js";

class UserDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async get_user_by_username(username: string): Promise<User | null> {
    const result = await this._pool.query(
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
    await this._pool.query(
      `INSERT INTO users (username, email, email_verified, password_hash)
       VALUES ($1, $2, true, $3)
       ON CONFLICT DO NOTHING`,
      [username, email, password_hash]);
  }
}
