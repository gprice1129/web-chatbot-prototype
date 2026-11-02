-- 012_chat_application.sql
--
-- records which application each chat is registered to.
--
-- model:
--   * chats.application_slug names the application (005) whose routes serve
--     the chat.
--   * the column is nullable. a new chat starts unregistered; the first
--     application route it reaches registers it. chats created before this
--     migration also stay NULL until then.
--
-- key design choices:
--   * the foreign key targets applications.slug, not applications.id. the
--     slug is the identity code, seeds, and routes already use, so a chat row
--     carries it directly and reads need no join.
--   * applications.slug gains a plain unique constraint, which a foreign key
--     requires; the existing unique index is on lower(slug) and cannot serve.
--   * applications.slug must be lowercase. foreign-key matching is
--     case-sensitive while slug lookups are not, and the check keeps the two
--     agreeing.
--   * on update cascade: renaming a slug carries its chats along.
--   * on delete restrict: an application with chats cannot be dropped.
--     applications are retired with the enabled flag instead, so a chat
--     never loses its registration.
--   * no index on application_slug: nothing lists chats by application yet.

begin;

-------------------------------------------------------------------------------
-- 1. applications.slug: unique and lowercase
-------------------------------------------------------------------------------
alter table applications
    add constraint applications_slug_key unique (slug),
    add constraint applications_slug_lowercase check (slug = lower(slug));

-------------------------------------------------------------------------------
-- 2. chats.application_slug
-------------------------------------------------------------------------------
alter table chats
    add column application_slug varchar(64)
        references applications (slug) on update cascade on delete restrict;

comment on column chats.application_slug is
    'application the chat is registered to. NULL until an application route registers it.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (12, '012_chat_application')
on conflict (version) do nothing;

commit;
