-- 010_chat_memories.sql
--
-- Creates the chat_memories table: derived, cached memories about a chat,
-- composable into cross-chat project memory.
--
-- Model:
--   * A chat memory is a derived artifact computed about a chat -- generated
--     out of band by a cheap model, regenerated on staleness, and NEVER part
--     of any chat transcript.
begin;

-------------------------------------------------------------------------------
-- 1. chat_memories
-------------------------------------------------------------------------------
create table chat_memories (
    id              uuid          primary key default gen_random_uuid(),
    chat_id         uuid          not null references chats (id) on delete cascade,
    user_id         uuid          not null,

    kind            text          not null default 'summary',
    content         text          not null,

    -- watermark: created_at of the newest message this memory covers. the
    -- memory is stale when source_through < the chat's latest message.
    source_through  timestamptz   not null,

    created_at      timestamptz   not null default now(),
    updated_at      timestamptz   not null default now(),

    unique (chat_id, kind)
);

comment on table chat_memories is
    'Derived, cached memories about a chat. composeable into sibling chats';

comment on column chat_memories.id             is 'random uuid identifying the memory row.';
comment on column chat_memories.chat_id        is 'chat this memory is about; cascades on chat delete.';
comment on column chat_memories.user_id        is 'owning user; denormalized for direct, defense-in-depth scoping.';
comment on column chat_memories.kind           is 'memory kind. currently always ''summary''; left open for typed memories later.';
comment on column chat_memories.content        is 'the memory text (e.g. a short factual digest of the chat).';
comment on column chat_memories.source_through is 'watermark: created_at of the newest message this memory covers; stale when < the chat''s latest message.';

-------------------------------------------------------------------------------
-- 2. auto-update updated_at
-------------------------------------------------------------------------------
create or replace function set_chat_memories_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_chat_memories_updated_at
    before update on chat_memories
    for each row
    execute function set_chat_memories_updated_at();

comment on function set_chat_memories_updated_at is 'keeps chat_memories.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (10, '010_chat_memories')
on conflict (version) do nothing;

commit;
