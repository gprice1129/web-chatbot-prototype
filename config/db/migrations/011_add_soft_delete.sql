-- 011_add_soft_delete.sql
--
-- adds a soft-delete marker (deleted_at) to projects, chats, and files in
-- support of trashcan-style functionality: a row is "deleted" from the user's
-- point of view when deleted_at is set, but the row (and its blob / children)
-- survives so it can be restored, and is only physically removed by an
-- explicit purge.
--
-- model:
--   * deleted_at is a nullable timestamptz. NULL means "live"; a non-NULL
--     value is the moment the row was moved to the trash. mirrors the
--     revoked_at pattern already used on sessions (003).
--   * application queries that list live rows must add `deleted_at is null`;
--     the trashcan view selects `deleted_at is not null`. this migration only
--     adds the column and the supporting indexes -- the service layer is
--     responsible for the filtering.
--
-- key design choices:
--   * deleted_at is a real column, not a metadata jsonb key: it gates
--     visibility and is queried directly, matching the first-class treatment
--     of sessions.revoked_at.
--   * per-table partial indexes on (user_id, deleted_at desc) where
--     deleted_at is not null back the trashcan listing. they are partial so
--     they stay tiny -- trashed rows are the rare minority -- and index-order
--     matches "most recently deleted first".
--   * the existing live-listing indexes (idx_*_user_created_at) are left as
--     is: with trashed rows a small minority, an index scan plus a cheap
--     `deleted_at is null` filter stays efficient.
--   * soft-deleting a row is an UPDATE, so the existing trg_*_updated_at
--     triggers bump updated_at automatically -- intended.

begin;

-------------------------------------------------------------------------------
-- 1. projects.deleted_at
-------------------------------------------------------------------------------
alter table projects
    add column deleted_at timestamptz;

comment on column projects.deleted_at is
    'soft-delete marker: NULL = live, non-NULL = moved to trash at this time. row survives for restore/purge.';

-- trashcan view: a user''s trashed projects, most recently deleted first
create index idx_projects_user_deleted_at
    on projects (user_id, deleted_at desc)
    where deleted_at is not null;

-------------------------------------------------------------------------------
-- 2. chats.deleted_at
-------------------------------------------------------------------------------
alter table chats
    add column deleted_at timestamptz;

comment on column chats.deleted_at is
    'soft-delete marker: NULL = live, non-NULL = moved to trash at this time. row survives for restore/purge.';

-- trashcan view: a user''s trashed chats, most recently deleted first
create index idx_chats_user_deleted_at
    on chats (user_id, deleted_at desc)
    where deleted_at is not null;

-------------------------------------------------------------------------------
-- 3. files.deleted_at
-------------------------------------------------------------------------------
alter table files
    add column deleted_at timestamptz;

comment on column files.deleted_at is
    'soft-delete marker: NULL = live, non-NULL = moved to trash at this time. blob survives for restore/purge.';

-- trashcan view: a user''s trashed files, most recently deleted first
create index idx_files_user_deleted_at
    on files (user_id, deleted_at desc)
    where deleted_at is not null;

-------------------------------------------------------------------------------
-- 4. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (11, '011_add_soft_delete')
on conflict (version) do nothing;

commit;
