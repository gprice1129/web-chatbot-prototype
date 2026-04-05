-- 002_create_users.sql
--
-- creates the users table for local credential-based authentication,
-- following owasp password storage and authentication cheat-sheet
-- guidelines.
--
-- key design choices:
--   * password_hash stores the hash in phc string format
--     (e.g. "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>").
--     this embeds the algorithm, version, work-factor, and salt in a
--     single field, making algorithm upgrades transparent.
--   * account lockout uses an exponential back-off model: the
--     application doubles locked_until on each successive failure.
--   * email-change and password-reset flows use time-limited tokens
--     stored directly on the user row.

begin;

-------------------------------------------------------------------------------
-- 1. users
-------------------------------------------------------------------------------
create table users (
    id                          uuid          primary key default gen_random_uuid(),
    username                    varchar(255)  not null,
    email                       varchar(255)  not null,
    email_verified              boolean       not null default false,

    -- password (phc string format — includes algorithm, params, salt, hash)
    password_hash               text          not null,
    password_changed_at         timestamptz   not null default now(),

    -- account status
    account_enabled             boolean       not null default true,
    account_locked              boolean       not null default false,
    locked_until                timestamptz,

    -- brute-force / lockout tracking
    failed_login_attempts       integer       not null default 0,
    failed_attempts_window_start timestamptz,

    -- password-reset flow
    password_reset_token        varchar(255),
    password_reset_expires_at   timestamptz,

    -- email-change flow
    pending_email               varchar(255),
    email_change_token          varchar(255),
    email_change_expires_at     timestamptz,

    -- multi-factor authentication
    mfa_enabled                 boolean       not null default false,
    mfa_method                  varchar(64),
    mfa_secret                  text,

    -- housekeeping
    created_at                  timestamptz   not null default now(),
    updated_at                  timestamptz   not null default now()
);

-- unique constraints
create unique index idx_users_username on users (lower(username));
create unique index idx_users_email    on users (lower(email));

-- look-ups used during authentication & account-recovery flows
create index idx_users_password_reset_token on users (password_reset_token) where password_reset_token is not null;
create index idx_users_email_change_token   on users (email_change_token)   where email_change_token   is not null;

comment on table  users is 'local-credential user accounts (owasp password storage & authentication guidelines).';

comment on column users.id                          is 'random uuid — avoids sequential / predictable identifiers.';
comment on column users.username                    is 'display / login name. case-insensitive uniqueness enforced by index.';
comment on column users.email                       is 'primary email. case-insensitive uniqueness enforced by index.';
comment on column users.email_verified              is 'set to true once the user confirms their email address.';
comment on column users.password_hash               is 'phc-format string (e.g. argon2id). encodes algorithm, work-factor, salt, and hash.';
comment on column users.password_changed_at         is 'tracks when the password was last set; used for rotation policies.';
comment on column users.account_enabled             is 'administrative disable flag — distinct from a temporary lockout.';
comment on column users.account_locked              is 'true when the account is temporarily locked due to failed login attempts.';
comment on column users.locked_until                is 'exponential back-off unlock time. null when not locked.';
comment on column users.failed_login_attempts       is 'consecutive failures since the last successful login.';
comment on column users.failed_attempts_window_start is 'start of the current observation window for counting failures.';
comment on column users.password_reset_token        is 'cryptographically random, time-limited token for password resets.';
comment on column users.password_reset_expires_at   is 'hard expiry for the password-reset token.';
comment on column users.pending_email               is 'proposed new email; committed only after verification.';
comment on column users.email_change_token          is 'time-limited token sent to the new email for verification.';
comment on column users.email_change_expires_at     is 'expiry for the email-change token.';
comment on column users.mfa_enabled                 is 'whether a second factor is required at login.';
comment on column users.mfa_method                  is 'mfa type (e.g. totp, webauthn, sms).';
comment on column users.mfa_secret                  is 'encrypted mfa credential (e.g. totp seed). must be encrypted at rest by the application.';
comment on column users.last_login_at               is 'timestamp of the most recent successful authentication.';
comment on column users.last_login_ip               is 'client ip of the most recent successful authentication.';

-------------------------------------------------------------------------------
-- 2. auto-update updated_at
-------------------------------------------------------------------------------
create or replace function set_users_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_users_updated_at
    before update on users
    for each row
    execute function set_users_updated_at();

comment on function set_users_updated_at is 'keeps users.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (2, '002_create_users');

commit;
