export { make_db_services };
export type { DbServiceSet, DbServices, Transaction };
export { make_pool } from "./pool.js";
export { with_transaction } from "./transaction.js";
export type { Executor, Tx } from "./transaction.js";
export * from "./types.js";
export { UserDbService } from "./users.js";
export { SessionDbService } from "./sessions.js";
export { FileDbService } from "./files.js";
export { ApplicationDbService } from "./applications.js";
export { ChatDbService } from "./chats.js";
export { ProjectDbService } from "./projects.js";
export { MemoryDbService } from "./memory.js";

import * as pg from "pg";
import { make_pool } from "./pool.js";
import { with_transaction } from "./transaction.js";
import type { Executor } from "./transaction.js";
import { UserDbService } from "./users.js";
import { SessionDbService } from "./sessions.js";
import { FileDbService } from "./files.js";
import { ApplicationDbService } from "./applications.js";
import { ChatDbService } from "./chats.js";
import { ProjectDbService } from "./projects.js";
import { MemoryDbService } from "./memory.js";

// All services running on the same Executor
interface DbServiceSet {
  user_db: UserDbService;
  session_db: SessionDbService;
  file_db: FileDbService;
  application_db: ApplicationDbService;
  chat_db: ChatDbService;
  project_db: ProjectDbService;
  memory_db: MemoryDbService;
}

// Runs a body of work in one transaction, passing it a service set bound to
// the transaction's connection.
type Transaction = <T>(fn: (db: DbServiceSet) => Promise<T>) => Promise<T>;

interface DbServices extends DbServiceSet {
  transaction: Transaction;
  close(): Promise<void>;
}

function make_service_set(exec: Executor): DbServiceSet {
  return {
    user_db: new UserDbService(exec),
    session_db: new SessionDbService(exec),
    file_db: new FileDbService(exec),
    application_db: new ApplicationDbService(exec),
    chat_db: new ChatDbService(exec),
    project_db: new ProjectDbService(exec),
    memory_db: new MemoryDbService(exec),
  };
}

// All services share the one pool
function make_db_services(pool: pg.Pool = make_pool()): DbServices {
  return {
    ...make_service_set(pool),
    transaction: (fn) => with_transaction(pool, (tx) => fn(make_service_set(tx))),
    close: () => pool.end(),
  };
}
