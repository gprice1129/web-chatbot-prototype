-- 004_create_files.sql
--
-- creates the files table for tracking uploaded blobs and their metadata.
--
-- upload flow (see packages/aim_hi_webserver/src/route/upload-file.ts):
--   1. client posts a multipart upload -> server generates a uuid `file_id`
--      and streams the body to the configured storage backend at a key
--      derived from `uuid_to_path(file_id)`.
--   2. server detects the mime type from content (file-type) and rejects
--      unsupported types before persisting the row.
--   3. a row is inserted with status 'uploaded'. if the mime type is
--      parsable, a parse job is enqueued via pg-boss and the status is
--      updated to 'queued'.
--   4. the parser worker (packages/aim_hi_parser) writes its output and
--      transitions the row to 'parsed' or 'parse_failed'.
--
-- key design choices:
--   * `id` is the same uuid used to derive the storage key, so the blob
--     can be located from the row alone. `storage_backend` + `storage_key`
--     are also stored explicitly so the row is self-describing across
--     backends and survives changes to the key-derivation scheme.
--   * `storage_backend` identifies which provider holds the blob
--     ('local', 's3', 'gcs', 'azure'). bucket/container/region/credentials
--     live in app config keyed by backend rather than on the row.
--   * `user_id` is required and cascades on user delete -- a file with
--     no owner has no access-control story.
--   * `metadata` is a single jsonb column for free-form per-file data
--     (multipart fields, parse output, user tags). matches the pattern
--     used by `oidc_sessions.user_info`. can be split into a separate
--     table later if distinct categories emerge.
--   * status is a varchar with a check constraint rather than a postgres
--     enum, matching the style of `sessions.auth_method`. enums are hard
--     to extend without a migration.

begin;

-------------------------------------------------------------------------------
-- 1. files
-------------------------------------------------------------------------------
create table files (
    id                uuid          primary key,
    user_id           uuid          not null references users (id) on delete cascade,

    -- content descriptors
    original_filename text,
    mime_type         varchar(255)  not null,
    size_bytes        bigint        not null check (size_bytes >= 0),
    checksum_sha256   varchar(64),

    -- storage
    storage_backend   varchar(32)   not null
        check (storage_backend in ('local', 's3', 'gcs', 'azure')),
    storage_key       text          not null,

    -- lifecycle
    status            varchar(32)   not null
        check (status in ('uploaded', 'queued', 'parsed', 'parse_failed')),
    parse_error       text,

    -- free-form per-file metadata (multipart fields, parse output, tags, ...)
    metadata          jsonb         not null default '{}'::jsonb,

    -- housekeeping
    created_at        timestamptz   not null default now(),
    updated_at        timestamptz   not null default now()
);

-- list / paginate a user's files, newest first
create index idx_files_user_id_created_at on files (user_id, created_at desc);

-- worker queries: find files in a particular state (e.g. retry stuck 'queued')
create index idx_files_status on files (status);

-- dedup / integrity look-ups by content hash
create index idx_files_checksum on files (checksum_sha256) where checksum_sha256 is not null;

-- locate a blob by its physical address (e.g. orphan-blob sweepers)
create unique index idx_files_storage_location on files (storage_backend, storage_key);

-- key/value queries inside the jsonb payload
create index idx_files_metadata on files using gin (metadata jsonb_path_ops);

comment on table  files is 'metadata for files uploaded via /upload. the blob lives at (storage_backend, storage_key).';

comment on column files.id                is 'uuid that also derives the storage key via uuid_to_path(id).';
comment on column files.user_id           is 'owning user; cascades on delete so removing a user purges their files.';
comment on column files.original_filename is 'filename supplied by the multipart client. untrusted -- never use as a path.';
comment on column files.mime_type         is 'mime type detected from file content (file-type), not the client-declared type.';
comment on column files.size_bytes        is 'actual size on disk after the upload completed.';
comment on column files.checksum_sha256   is 'hex-encoded sha-256 of the stored bytes; used for integrity checks and dedup.';
comment on column files.storage_backend   is 'which storage provider holds the blob: local, s3, gcs, azure.';
comment on column files.storage_key       is 'object key / path within the backend, relative to the backend-specific base. bucket/container/region come from app config.';
comment on column files.status            is 'lifecycle: uploaded -> queued -> parsed | parse_failed.';
comment on column files.parse_error       is 'human-readable error message; populated only when status = parse_failed.';
comment on column files.metadata          is 'free-form per-file metadata. shape is enforced by the application.';

-------------------------------------------------------------------------------
-- 2. auto-update updated_at
-------------------------------------------------------------------------------
create or replace function set_files_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_files_updated_at
    before update on files
    for each row
    execute function set_files_updated_at();

comment on function set_files_updated_at is 'keeps files.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (4, '004_create_files');

commit;
