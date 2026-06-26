-- 008_extend_projects.sql
--
-- extends the projects model (007) with first-class project configuration and
-- adds a project_files junction so files can be attached to a project directly,
-- not only to a chat.
--
-- changes:
--   * projects.description    -- optional human-readable blurb. mirrors
--                                applications.description.
--   * projects.instructions   -- free-form text prepended to the system prompt
--                                of every chat in the project.
--   * projects.memory_enabled -- when true, a bot may draw on all chats in the
--                                project for additional context. defaults false
--                                so cross-chat context is strictly opt-in.
--   * project_files           -- many-to-many between projects and files,
--                                mirroring chat_files (006). lets a user upload a
--                                file to a project instead of (or as well as) a
--                                single chat.
--
-- key design choices:
--   * description / instructions / memory_enabled are real columns rather than
--     metadata jsonb keys: they are first-class, application-meaningful fields
--     (one feeds the system prompt, one gates behaviour), matching the style of
--     applications.description. metadata stays for free-form ui state.
--   * project_files mirrors chat_files exactly: a file may be attached to many
--     projects and a project holds many files; deleting either side drops only
--     the link rows (cascade on both fks), never the file blob or the project.

begin;

-------------------------------------------------------------------------------
-- 1. new project configuration columns
-------------------------------------------------------------------------------
alter table projects
    add column description    text,
    add column instructions   text,
    add column memory_enabled boolean not null default false;

comment on column projects.description    is 'optional human-readable description of the project.';
comment on column projects.instructions   is 'free-form text prepended to the system prompt of every chat in the project.';
comment on column projects.memory_enabled is 'when true, a bot may use all chats in the project as additional context. opt-in; defaults false.';

-------------------------------------------------------------------------------
-- 2. project_files (project-level attachments)
-------------------------------------------------------------------------------
create table project_files (
    project_id  uuid          not null references projects (id) on delete cascade,
    file_id     uuid          not null references files (id) on delete cascade,

    created_at  timestamptz   not null default now(),

    primary key (project_id, file_id)
);

-- reverse look-up: which projects reference a given file
create index idx_project_files_file_id on project_files (file_id);

comment on table  project_files is 'many-to-many: files attached at project level (in scope for every chat in the project).';

comment on column project_files.project_id is 'project the file is attached to. cascades on project delete.';
comment on column project_files.file_id    is 'attached file. cascades on file delete so the link does not outlive the blob.';
comment on column project_files.created_at is 'when the file was attached to the project.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (8, '008_extend_projects')
on conflict (version) do nothing;

commit;
