-- 007_create_projects.sql
--
-- creates the projects table and the project_chats junction table.
--
-- model:
--   * a project is a user-owned collection of chats -- a way to group
--     related conversations together. listing projects is always per
--     user_id.
--   * project membership is many-to-many via project_chats: a chat may
--     belong to multiple projects, and a project holds many chats. this
--     mirrors the chat_files / chat_message_files junctions in 006.
--
-- key design choices:
--   * deleting a project removes only its project_chats link rows (cascade
--     on both fks), so the member chats themselves survive and simply leave
--     the project. deleting a chat likewise drops its links without
--     touching any project.
--   * metadata jsonb mirrors chats.metadata for free-form per-row data
--     (color, icon, ui state, ...).
--   * project names are intentionally not unique -- a user may have two
--     projects with the same name, matching the un-constrained style of
--     chats.title.

begin;

-------------------------------------------------------------------------------
-- 1. projects
-------------------------------------------------------------------------------
create table projects (
    id          uuid          primary key default gen_random_uuid(),
    user_id     uuid          not null references users (id) on delete cascade,

    name        text          not null,

    metadata    jsonb         not null default '{}'::jsonb,

    created_at  timestamptz   not null default now(),
    updated_at  timestamptz   not null default now()
);

-- list / paginate a user's projects, newest first
create index idx_projects_user_created_at
    on projects (user_id, created_at desc);

-- key/value queries inside the jsonb payload
create index idx_projects_metadata on projects using gin (metadata jsonb_path_ops);

comment on table  projects is 'user-owned collections of chats, scoped per user_id.';

comment on column projects.id         is 'random uuid identifying the project.';
comment on column projects.user_id    is 'owning user; cascades on delete so removing a user purges their projects.';
comment on column projects.name       is 'human-readable project name. not unique -- duplicates are allowed.';
comment on column projects.metadata   is 'free-form per-project metadata. shape is enforced by the application.';

-------------------------------------------------------------------------------
-- 2. project_chats (project membership)
-------------------------------------------------------------------------------
create table project_chats (
    project_id  uuid          not null references projects (id) on delete cascade,
    chat_id     uuid          not null references chats (id) on delete cascade,

    created_at  timestamptz   not null default now(),

    primary key (project_id, chat_id)
);

-- reverse look-up: which projects contain a given chat
create index idx_project_chats_chat_id on project_chats (chat_id);

comment on table  project_chats is 'many-to-many: chats that belong to a project. a chat may be in multiple projects.';

comment on column project_chats.project_id is 'project the chat belongs to. cascades on project delete.';
comment on column project_chats.chat_id    is 'member chat. cascades on chat delete so the link does not outlive the chat.';
comment on column project_chats.created_at is 'when the chat was added to the project.';

-------------------------------------------------------------------------------
-- 3. auto-update updated_at on projects
-------------------------------------------------------------------------------
create or replace function set_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_projects_updated_at
    before update on projects
    for each row
    execute function set_projects_updated_at();

comment on function set_projects_updated_at is 'keeps projects.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 4. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (7, '007_create_projects');

commit;
