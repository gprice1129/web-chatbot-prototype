// End-to-end round trip for the projects API. Exercises the full lifecycle as
// `testuser` and asserts the expected state at each step:
//
//   create project -> create chat -> add chat to project -> list membership
//   -> remove chat -> rename project -> delete project
//
// It also verifies the key junction behaviour: deleting a project leaves its
// member chat intact (only the project_chats link rows cascade). Reuses the
// per-endpoint helpers so this doubles as a usage example of the whole API.
//
//   npm run project-round-trip -- [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

import assert from "node:assert";
import { project_create } from "../project-create/project-create.js";
import { project_get } from "../project-get/project-get.js";
import { project_update } from "../project-update/project-update.js";
import { project_delete } from "../project-delete/project-delete.js";
import { project_chats_get } from "../project-chats-get/project-chats-get.js";
import { project_chat_add } from "../project-chat-add/project-chat-add.js";
import { project_chat_remove } from "../project-chat-remove/project-chat-remove.js";
import { chat_create } from "../chat-create/chat-create.js";
import { chat_get } from "../chat-get/chat-get.js";

export async function project_round_trip(base_url: string): Promise<void> {
  const username = process.env.USERNAME ?? "testuser";
  const password = process.env.PASSWORD ?? "irrelevant";
  const auth = { base_url, username, password };

  // 1. Create a project and a chat to put in it.
  const project = await project_create({ ...auth, name: "Round-trip project" });
  assert.ok(project.id, "expected a project id");
  const chat = await chat_create({ ...auth, title: "Round-trip chat" });

  // 2. Add the chat to the project; it should now appear in the membership.
  await project_chat_add({ ...auth, project_id: project.id, chat_id: chat.id });
  const after_add = await project_chats_get({ ...auth, project_id: project.id });
  assert.ok(after_add.chats.some((c) => c.id === chat.id),
    "chat should be a member after add");

  // 3. Adding it again is idempotent — membership stays a single entry.
  await project_chat_add({ ...auth, project_id: project.id, chat_id: chat.id });
  const after_readd = await project_chats_get({ ...auth, project_id: project.id });
  assert.strictEqual(
    after_readd.chats.filter((c) => c.id === chat.id).length, 1,
    "re-adding a chat should not duplicate membership");

  // 4. Remove the chat; membership should be empty again.
  await project_chat_remove({ ...auth, project_id: project.id, chat_id: chat.id });
  const after_remove = await project_chats_get({ ...auth, project_id: project.id });
  assert.ok(!after_remove.chats.some((c) => c.id === chat.id),
    "chat should not be a member after remove");

  // 5. Rename the project; the new name should be reflected in the listing.
  const renamed = await project_update(
    { ...auth, project_id: project.id, name: "Round-trip renamed" });
  assert.strictEqual(renamed.name, "Round-trip renamed");
  const listed = await project_get(auth);
  assert.ok(
    listed.projects.some((p) => p.id === project.id && p.name === "Round-trip renamed"),
    "renamed project should appear in the listing");

  // 6. Re-add the chat, then delete the project. The project should disappear
  //    from the listing, but the chat that was a member must survive (only the
  //    junction rows cascade).
  await project_chat_add({ ...auth, project_id: project.id, chat_id: chat.id });
  await project_delete({ ...auth, project_id: project.id });
  const after_delete = await project_get(auth);
  assert.ok(!after_delete.projects.some((p) => p.id === project.id),
    "deleted project should not be listed");
  const chats = await chat_get(auth);
  assert.ok(chats.chats.some((c) => c.id === chat.id),
    "member chat should survive project deletion");
}

// CLI driver — when run via `npm run project-round-trip`, exercise the full
// lifecycle against a live server. Throws on any failed assertion or request,
// which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  await project_round_trip(process.argv[2] ?? "https://localhost");
  console.log("project round trip: OK");
}
