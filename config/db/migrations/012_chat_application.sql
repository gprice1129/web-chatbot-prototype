-- 012_chat_application.sql
--
-- records which application created each chat.
--
-- model:
--   * chats.application_id points at the backend application (005) whose
--     endpoint the chat talks to, e.g. 'ally' or 'grant-reviewer'.
--   * the column is nullable. chats created before this migration have no
--     record of their application and stay NULL. new chats always set it;
--     the service layer enforces that.
--
-- key design choices:
--   * a real foreign key, not a metadata jsonb key: provenance is
--     first-class and must name a known application.
--   * on delete restrict: an application with chats cannot be dropped.
--     applications are retired with the enabled flag instead, so a chat
--     never loses its provenance.
--   * no index on application_id: nothing lists chats by application yet,
--     and applications are almost never deleted.

begin;

-------------------------------------------------------------------------------
-- 1. chats.application_id
-------------------------------------------------------------------------------
alter table chats
    add column application_id uuid references applications (id) on delete restrict;

comment on column chats.application_id is
    'application that created the chat. NULL for chats created before this column existed.';

-------------------------------------------------------------------------------
-- 2. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (12, '012_chat_application')
on conflict (version) do nothing;

commit;
