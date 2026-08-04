-- 012_create_embeddings.sql
--
-- Creates the embeddings table: dense vectors backing semantic lookup over
-- application content.
--
-- Model:
--   * A row is one embedded chunk of one owning record, addressed by the
--     (owner_kind, owner_id, chunk_index) triple. Content too large for the
--     embedding model's context is split into several chunks, each its own row.
--   * Vectors are DERIVED artifacts -- computed out of band from content that
--     lives elsewhere, regenerable at any time, and never authoritative. Losing
--     this table costs a re-embedding pass, not data.
--
-- Key design choices:
--   * The owner reference is polymorphic (owner_kind + owner_id). A new kind of
-- embedded content needs no migration. The cost is paid in two places:
--       - Whoever writes vectors for a kind owns removing them
--       - The service layer is responsible for filtering soft deletes
--   * user_id carries a FK with cascade even though the owner does not.
--     Deleting a user cannot strand their vectors.
--   * model is stored per row because vectors from different models share no
--     coordinate space. Changing models requires re-embedding.
--   * The vector column is fixed at 1024 dimensions.
--
-- Prerequisite: the `vector` extension.

begin;

-------------------------------------------------------------------------------
-- 1. embeddings
-------------------------------------------------------------------------------
create table embeddings (
    id            uuid          primary key default gen_random_uuid(),
    user_id       uuid          not null references users (id) on delete cascade,

    -- polymorphic owner: which table, which row, which chunk of it
    owner_kind    text          not null,
    owner_id      uuid          not null,
    chunk_index   integer       not null default 0,

    -- the exact text that was embedded, kept so a hit can be shown or re-ranked
    -- without a second lookup, and so re-embedding needs no re-chunking
    content       text          not null,
    embedding     vector(1024)  not null,
    model         text          not null,

    created_at    timestamptz   not null default now(),
    updated_at    timestamptz   not null default now(),

    constraint embeddings_chunk_index_non_negative check (chunk_index >= 0),
    unique (owner_kind, owner_id, chunk_index)
);

comment on table embeddings is
    'Derived dense vectors for semantic lookup. Regenerable; never authoritative.';

comment on column embeddings.id          is 'random uuid identifying the embedded chunk.';
comment on column embeddings.user_id     is 'owning user; the tenancy boundary every search filters on. cascades on user delete.';
comment on column embeddings.owner_kind  is 'which kind of record this chunk came from (e.g. ''chat_memory'', ''file''). no FK -- see migration header.';
comment on column embeddings.owner_id    is 'id of the owning record within owner_kind. not enforced; the writing service owns cleanup.';
comment on column embeddings.chunk_index is '0-based position of this chunk within the owning record. 0 when the record is embedded whole.';
comment on column embeddings.content     is 'the exact text embedded into this vector.';
comment on column embeddings.embedding   is '1024-dim unit-normalized vector. width matches BAAI/bge-m3 and voyage-4.';
comment on column embeddings.model       is 'model that produced the vector. vectors from different models are not comparable, so searches filter on it.';

-------------------------------------------------------------------------------
-- 2. indexes
-------------------------------------------------------------------------------
-- Approximate nearest-neighbour index. HNSW rather than IVFFlat: it needs no
-- training pass over existing rows (this table starts empty) and holds recall
-- better at small row counts. vector_cosine_ops matches the `<=>` operator the
-- search query uses; vectors are unit-normalized, so cosine and inner product
-- rank identically.
--
-- Note this index covers the vector alone. The user_id and model predicates are
-- applied as filters over the approximate candidate set, so a query can return
-- fewer than LIMIT rows when a user owns few vectors. That is acceptable while
-- one model is deployed; if several ever coexist, revisit with per-model
-- partial indexes.
create index idx_embeddings_hnsw
    on embeddings using hnsw (embedding vector_cosine_ops);

-- Backs the tenancy/model filter and makes delete-by-owner-kind sweeps cheap.
create index idx_embeddings_user_kind
    on embeddings (user_id, owner_kind, model);

-- Backs delete_by_owner and the staleness check when a record is re-embedded.
create index idx_embeddings_owner
    on embeddings (owner_kind, owner_id);

-------------------------------------------------------------------------------
-- 3. auto-update updated_at
-------------------------------------------------------------------------------
create or replace function set_embeddings_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_embeddings_updated_at
    before update on embeddings
    for each row
    execute function set_embeddings_updated_at();

comment on function set_embeddings_updated_at is 'keeps embeddings.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 4. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (12, '012_create_embeddings')
on conflict (version) do nothing;

commit;
