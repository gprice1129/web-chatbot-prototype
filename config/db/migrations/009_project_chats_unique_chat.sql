-- 009_project_chats_unique_chat.sql
--
-- two changes, both in the projects feature area:
--   * project_chats: UNIQUE (chat_id) -- a chat belongs to at most one project.
--   * projects.instructions comment update

begin;

-------------------------------------------------------------------------------
-- 1. enforce single-project-per-chat
-------------------------------------------------------------------------------
alter table project_chats add constraint project_chats_unique_chat unique (chat_id);

comment on constraint project_chats_unique_chat on project_chats is
    'a chat belongs to at most one project';

-------------------------------------------------------------------------------
-- 2. correct the 008 instructions doc (append-only; do not edit 008 in place)
-------------------------------------------------------------------------------
comment on column projects.instructions is
    'free-form text appended (after a precedence frame) to the system prompt of every chat in the project.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (9, '009_project_chats_unique_chat')
on conflict (version) do nothing;

commit;
