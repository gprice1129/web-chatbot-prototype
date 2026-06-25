-- 006_create_chats.sql
--
-- creates tables for llm-based chats and the messages within them, plus
-- junction tables that attach uploaded files to chats and to individual
-- messages.
--
-- model:
--   * a chat is a single conversation owned by a user. listing chats is
--     always per user_id.
--   * a chat has many chat_messages, ordered by created_at. messages are
--     append-only -- no updated_at.
--   * files (from migration 004) can be attached at two levels:
--       - chat-level via chat_files: e.g. a knowledge-base document that
--         is in scope for the entire conversation.
--       - message-level via chat_message_files: e.g. an attachment the
--         user dropped into a single turn, or a file produced by the
--         assistant in a particular response.
--     both junctions are many-to-many: the same file may appear on
--     multiple chats / messages, and a chat or message may reference
--     multiple files.
--
-- key design choices:
--   * role is a varchar with a check constraint, matching the style used
--     elsewhere in the schema (sessions.auth_method, files.status).
--   * metadata jsonb columns mirror files.metadata for free-form per-row
--     data (model id, token counts, tool-call payloads, ui state, ...).
--   * cascading deletes flow user -> chats -> chat_messages -> junctions,
--     and files -> junctions, so removing either side cleans up the link
--     rows without leaving dangling references.

begin;

-------------------------------------------------------------------------------
-- 1. chats
-------------------------------------------------------------------------------
create table chats (
    id              uuid          primary key default gen_random_uuid(),
    user_id         uuid          not null references users (id) on delete cascade,

    title           text          not null,

    metadata        jsonb         not null default '{}'::jsonb,

    created_at      timestamptz   not null default now(),
    updated_at      timestamptz   not null default now()
);

-- list / paginate a user's chats, newest first
create index idx_chats_user_created_at
    on chats (user_id, created_at desc);

-- key/value queries inside the jsonb payload
create index idx_chats_metadata on chats using gin (metadata jsonb_path_ops);

comment on table  chats is 'high-level llm chat conversations, scoped per user_id.';

comment on column chats.id             is 'random uuid identifying the chat.';
comment on column chats.user_id        is 'owning user; cascades on delete so removing a user purges their chats.';
comment on column chats.title          is 'human-readable title (e.g. derived from the first user message).';
comment on column chats.metadata       is 'free-form per-chat metadata. shape is enforced by the application.';

-------------------------------------------------------------------------------
-- 2. chat_messages
-------------------------------------------------------------------------------
create table chat_messages (
    id          uuid          primary key default gen_random_uuid(),
    chat_id     uuid          not null references chats (id) on delete cascade,

    role        varchar(32)   not null
        check (role in ('user', 'assistant', 'system', 'tool')),
    content     text          not null,

    metadata    jsonb         not null default '{}'::jsonb,

    created_at  timestamptz   not null default now()
);

-- replay a chat in order
create index idx_chat_messages_chat_created_at
    on chat_messages (chat_id, created_at);

-- key/value queries inside the jsonb payload (e.g. find tool calls)
create index idx_chat_messages_metadata
    on chat_messages using gin (metadata jsonb_path_ops);

comment on table  chat_messages is 'individual messages within a chat. append-only, ordered by created_at.';

comment on column chat_messages.id         is 'random uuid identifying the message.';
comment on column chat_messages.chat_id    is 'parent chat; cascades on delete so removing a chat purges its messages.';
comment on column chat_messages.role       is 'speaker: user, assistant, system, or tool.';
comment on column chat_messages.content    is 'message text. structured payloads (tool calls, attachments, ...) live in metadata.';
comment on column chat_messages.metadata   is 'free-form per-message metadata (model id, token counts, tool-call payloads, ...).';

-------------------------------------------------------------------------------
-- 3. chat_files (chat-level attachments)
-------------------------------------------------------------------------------
create table chat_files (
    chat_id     uuid          not null references chats (id) on delete cascade,
    file_id     uuid          not null references files (id) on delete cascade,

    created_at  timestamptz   not null default now(),

    primary key (chat_id, file_id)
);

-- reverse look-up: which chats reference a given file
create index idx_chat_files_file_id on chat_files (file_id);

comment on table  chat_files is 'many-to-many: files attached at chat level (e.g. knowledge-base documents in scope for the whole conversation).';

comment on column chat_files.chat_id    is 'chat the file is attached to. cascades on chat delete.';
comment on column chat_files.file_id    is 'attached file. cascades on file delete so the link does not outlive the blob.';
comment on column chat_files.created_at is 'when the file was attached to the chat.';

-------------------------------------------------------------------------------
-- 4. chat_message_files (message-level attachments)
-------------------------------------------------------------------------------
create table chat_message_files (
    message_id  uuid          not null references chat_messages (id) on delete cascade,
    file_id     uuid          not null references files (id) on delete cascade,

    created_at  timestamptz   not null default now(),

    primary key (message_id, file_id)
);

-- reverse look-up: which messages reference a given file
create index idx_chat_message_files_file_id on chat_message_files (file_id);

comment on table  chat_message_files is 'many-to-many: files attached to a specific message (e.g. user attachment for a single turn or assistant-produced output).';

comment on column chat_message_files.message_id is 'message the file is attached to. cascades on message delete.';
comment on column chat_message_files.file_id    is 'attached file. cascades on file delete so the link does not outlive the blob.';
comment on column chat_message_files.created_at is 'when the file was attached to the message.';

-------------------------------------------------------------------------------
-- 5. auto-update updated_at on chats
-------------------------------------------------------------------------------
create or replace function set_chats_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_chats_updated_at
    before update on chats
    for each row
    execute function set_chats_updated_at();

comment on function set_chats_updated_at is 'keeps chats.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 6. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (6, '006_create_chats')
on conflict (version) do nothing;

commit;
