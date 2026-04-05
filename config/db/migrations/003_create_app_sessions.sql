-- 003_create_app_sessions.sql
--
-- creates the application session table for managing authenticated user
-- sessions across both local-credential and oidc authentication methods.
--
-- key design choices:
--   * session_token is a cryptographically random, opaque bearer token
--     set in an http-only, secure cookie. it is distinct from the session
--     id to allow token rotation without changing the row's primary key.
--   * supports both idle timeout (last_activity_at) and absolute expiry
--     (expires_at). the application enforces both.
--   * revoked_at enables explicit logout and administrative revocation
--     without deleting the row, preserving an audit trail.
--   * auth_method records how the session was established so downstream
--     logic can enforce step-up authentication when needed.

begin;

-------------------------------------------------------------------------------
-- 1. application sessions
-------------------------------------------------------------------------------
create table app_sessions (
    id                uuid          primary key default gen_random_uuid(),
    user_id           uuid          not null references users (id) on delete cascade,
    session_token     varchar(255)  not null,

    -- authentication context
    auth_method       varchar(64)   not null,  -- e.g. 'local', 'oidc'

    -- lifecycle
    created_at        timestamptz   not null default now(),
    expires_at        timestamptz   not null,
    last_activity_at  timestamptz   not null default now(),

    -- revocation
    revoked_at        timestamptz,

    -- client metadata (audit / anomaly detection)
    ip_address        inet,
    user_agent        text
);

-- token look-up on every authenticated request — must be fast
create unique index idx_app_sessions_token       on app_sessions (session_token);

-- find all active sessions for a user (e.g. "log out everywhere")
create index idx_app_sessions_user_id            on app_sessions (user_id);

-- clean-up jobs and idle-timeout queries
create index idx_app_sessions_expires_at         on app_sessions (expires_at);
create index idx_app_sessions_last_activity      on app_sessions (last_activity_at);

comment on table  app_sessions is 'application-level sessions for authenticated users (local or oidc).';

comment on column app_sessions.id               is 'internal row identifier. not exposed to the client.';
comment on column app_sessions.user_id          is 'owning user; cascades on delete so removing a user purges their sessions.';
comment on column app_sessions.session_token    is 'opaque bearer token stored in an http-only secure cookie. rotatable independently of the row id.';
comment on column app_sessions.auth_method      is 'how the session was created (e.g. local, oidc). used for step-up auth decisions.';
comment on column app_sessions.expires_at       is 'absolute session expiry; cannot be extended.';
comment on column app_sessions.last_activity_at is 'updated on each request; used for idle-timeout eviction.';
comment on column app_sessions.revoked_at       is 'non-null means explicitly revoked (logout / admin action). preserves audit trail.';
comment on column app_sessions.ip_address       is 'client ip at session creation.';
comment on column app_sessions.user_agent       is 'client user-agent at session creation.';

-------------------------------------------------------------------------------
-- 2. cleanup: remove expired and revoked sessions
-------------------------------------------------------------------------------
create or replace function purge_expired_app_sessions()
returns integer
language sql
as $$
    delete from app_sessions
    where  expires_at < now()
       or  revoked_at < now() - interval '30 days'
    returning 1;
$$;

comment on function purge_expired_app_sessions is 'deletes expired sessions and revoked sessions older than 30 days. returns the number of rows removed.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (3, '003_create_app_sessions');

commit;
