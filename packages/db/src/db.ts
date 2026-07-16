export { make_db_services };
export type { DbServices };
export { make_pool } from "./pool.js";
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
import { UserDbService } from "./users.js";
import { SessionDbService } from "./sessions.js";
import { FileDbService } from "./files.js";
import { ApplicationDbService } from "./applications.js";
import { ChatDbService } from "./chats.js";
import { ProjectDbService } from "./projects.js";
import { MemoryDbService } from "./memory.js";

interface DbServices {
  user_db: UserDbService;
  session_db: SessionDbService;
  file_db: FileDbService;
  application_db: ApplicationDbService;
  chat_db: ChatDbService;
  project_db: ProjectDbService;
  memory_db: MemoryDbService;
  close(): Promise<void>;
}

// All services share the one pool (pg.Pool opens no connections until first
// use), so constructing the full set is free and close() ends the shared pool.
function make_db_services(pool: pg.Pool = make_pool()): DbServices {
  return {
    user_db: new UserDbService(pool),
    session_db: new SessionDbService(pool),
    file_db: new FileDbService(pool),
    application_db: new ApplicationDbService(pool),
    chat_db: new ChatDbService(pool),
    project_db: new ProjectDbService(pool),
    memory_db: new MemoryDbService(pool),
    close: () => pool.end(),
  };
}
