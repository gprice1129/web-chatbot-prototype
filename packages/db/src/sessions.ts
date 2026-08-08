export { SessionDbService };

import assert from "node:assert";
import type { Executor } from "./transaction.js";
import type { Session } from "./types.js";

class SessionDbService {
  private _exec: Executor;
  constructor(exec: Executor) {
    this._exec = exec;
  }

  async create_session(
    user_id: string,
    session_token: string,
    auth_method: string,
    expires_at: Date,
    ip_address: string | null,
    user_agent: string | null
  ): Promise<Session> {
    const result = await this._exec.query(
      `INSERT INTO sessions (user_id, session_token, auth_method, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [user_id, session_token, auth_method, expires_at, ip_address, user_agent]);
    return result.rows[0];
  }

  async get_session_by_token(session_token: string): Promise<Session | null> {
    const result = await this._exec.query(
      `SELECT * FROM sessions
       WHERE session_token = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [session_token]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async touch_session(session_token: string): Promise<void> {
    await this._exec.query(
      "UPDATE sessions SET last_activity_at = now() WHERE session_token = $1",
      [session_token]);
  }

  async revoke_session(session_token: string): Promise<void> {
    await this._exec.query(
      "UPDATE sessions SET revoked_at = now() WHERE session_token = $1 AND revoked_at IS NULL",
      [session_token]);
  }

  async revoke_all_user_sessions(user_id: string): Promise<void> {
    await this._exec.query(
      "UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
      [user_id]);
  }
}
