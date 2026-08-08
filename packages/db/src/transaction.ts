export { with_transaction };
export type { Executor, Tx };

import * as pg from "pg";

// What database services can use to run a query.
type Executor = pg.Pool | pg.PoolClient;

// The connection a transaction body runs on.
type Tx = pg.PoolClient;

/*
 * (pg.Pool, (Tx) => Promise<T>) => Promise<T>
 * Runs `fn` inside one BEGIN/COMMIT on a single pooled connection. Commits on
 * return, rolls back on throw, and always releases the connection.
 *
 * Every query that must be atomic with the others has to run on the `tx` handed
 * to `fn`. Services built on the pool run outside the transaction -- see
 * make_db_services, which hands the body its own set bound to `tx`.
 *
 * Not re-entrant: nesting a call inside another checks out a second connection
 * and opens an unrelated transaction. Postgres also warns on a nested BEGIN.
 * Pass the existing `tx` down instead.
 */
async function with_transaction<T>(
  pool: pg.Pool,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  // A connection whose ROLLBACK failed may still hold an open transaction.
  // Returning it to the pool would leak that state into the next caller, so it
  // is destroyed instead.
  let poisoned = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Never let a failed ROLLBACK mask the failure that triggered it: the
    // caller needs the original error, not the cleanup error.
    poisoned = await client.query("ROLLBACK").then(() => false, () => true);
    throw err;
  } finally {
    client.release(poisoned);
  }
}
