-- 013_create_documents.sql
--
-- creates the tables that hold documents: text in named sections that a user
-- and an assistant may each be allowed to write, kept as a head pointer over
-- immutable versions. the shape of a document, and the rules for writing one,
-- are defined in packages/common/src/document.ts; this migration only gives
-- that shape a home.
--
-- model:
--   * a document is owned by a user, like a file. it may follow a template
--     (template_id names one of the template files the app reads at startup)
--     or follow none.
--   * a document's content is never updated in place. every accepted write
--     produces the next revision, and each revision's content is a file (004)
--     holding its sections as json. document_versions links a document to
--     the file of each revision it has had.
--   * documents.revision is the head pointer: the current content is the
--     version whose revision equals it. a document at revision 0 has no
--     versions and no content yet.
--   * chat_documents attaches documents to chats, many-to-many, as chat_files
--     does for files. a document outlives the chats it is attached to.
--
-- key design choices:
--   * one revision counter on the document, not one per section: a write
--     names the revision it was made against, and the service moves the
--     pointer only `where revision = $n`, so two writers cannot silently
--     overwrite each other. an erasure is a write too.
--   * versions are files so they share the files table's ownership, storage
--     backends and per-user content dedup: two revisions with identical
--     content share one file row. a version therefore cannot own its file,
--     and the link restricts deleting a file that a version still names.
--   * document_versions records who made the write and which section it
--     changed, so a history can be listed without opening every file.
--   * writable_by is an array of authors checked against the two the shape
--     knows, rather than two boolean columns, so a third author later is a
--     check-constraint change rather than a column.
--   * no soft delete yet. nothing in the service layer filters deleted_at on
--     the tables that have it (011).
--
-- TODO:[documents] versions grow without bound. a global configuration for
-- the most versions kept per document is still to be defined (config
-- profile -> env var, as the rate limits are), and with it the pruning of
-- older version rows and of files no version or chat still names.

begin;

-------------------------------------------------------------------------------
-- 1. documents
-------------------------------------------------------------------------------
create table documents (
    id            uuid          primary key default gen_random_uuid(),
    user_id       uuid          not null references users (id) on delete cascade,

    template_id   varchar(64),
    writable_by   text[]        not null default '{}'
        check (writable_by <@ array['user', 'assistant']::text[]),
    revision      integer       not null default 0 check (revision >= 0),

    created_at    timestamptz   not null default now(),
    updated_at    timestamptz   not null default now()
);

-- list a user's documents, newest first
create index idx_documents_user_created_at
    on documents (user_id, created_at desc);

comment on table  documents is 'documents written in chats: a head pointer over immutable versions. shape and write rules live in packages/common/src/document.ts.';

comment on column documents.id          is 'random uuid identifying the document.';
comment on column documents.user_id     is 'owning user; cascades on delete so removing a user purges their documents.';
comment on column documents.template_id is 'id of the template file the document follows; null for a document with no template, which has one section, its body.';
comment on column documents.writable_by is 'the authors that may write the document: any of user, assistant. empty means nobody writes it again.';
comment on column documents.revision    is 'head pointer: counts the writes made, and names the current version. 0 before the first write.';

-------------------------------------------------------------------------------
-- 2. document_versions
-------------------------------------------------------------------------------
create table document_versions (
    document_id   uuid          not null references documents (id) on delete cascade,
    revision      integer       not null check (revision > 0),

    file_id       uuid          not null references files (id) on delete restrict,
    written_by    varchar(32)   not null
        check (written_by in ('user', 'assistant')),
    section_id    varchar(64)   not null,

    created_at    timestamptz   not null default now(),

    primary key (document_id, revision)
);

-- which versions name a file, before a file may go
create index idx_document_versions_file_id on document_versions (file_id);

comment on table  document_versions is 'one row per revision of a document: the file holding its content, and the write that produced it.';

comment on column document_versions.document_id is 'the document; cascades on delete so removing a document drops its history. its files are not removed here.';
comment on column document_versions.revision    is 'the revision this row is the content of; the document''s head when equal to documents.revision.';
comment on column document_versions.file_id     is 'the file (004) holding the document''s sections as json at this revision. restricts deleting a file a version still names.';
comment on column document_versions.written_by  is 'the author whose write produced this revision: user or assistant.';
comment on column document_versions.section_id  is 'the section that write changed.';

-------------------------------------------------------------------------------
-- 3. chat_documents
-------------------------------------------------------------------------------
create table chat_documents (
    chat_id       uuid          not null references chats (id) on delete cascade,
    document_id   uuid          not null references documents (id) on delete cascade,

    created_at    timestamptz   not null default now(),

    primary key (chat_id, document_id)
);

-- reverse look-up: which chats a document is attached to
create index idx_chat_documents_document_id on chat_documents (document_id);

comment on table  chat_documents is 'many-to-many: documents attached to chats. deleting either side removes the link only.';

-------------------------------------------------------------------------------
-- 4. auto-update updated_at on documents
-------------------------------------------------------------------------------
create or replace function set_documents_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_documents_updated_at
    before update on documents
    for each row
    execute function set_documents_updated_at();

comment on function set_documents_updated_at is 'keeps documents.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 5. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (13, '013_create_documents')
on conflict (version) do nothing;

commit;
