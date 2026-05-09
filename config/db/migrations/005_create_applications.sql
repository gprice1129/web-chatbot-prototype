-- 005_create_applications.sql
--
-- creates the applications table. each application is a specialized
-- chatbot (e.g. "grant reviewer", "grant writer") exposed to the
-- frontend.
--
-- key design choices:
--   * scope is system-defined for now: no user_id / ownership column.
--     applications are seeded by operators, not created by end users.
--   * the row is intentionally minimal -- no system_prompt, model, or
--     other behavior config yet. those will be added once the surface
--     stabilizes.
--   * slug is a stable, human-readable identifier (e.g.
--     'grant-reviewer-standard') used by the frontend and any code that
--     needs to refer to an application by name.
--   * enabled is a soft on/off switch so an application can be hidden
--     from listings without dropping the row.

begin;

-------------------------------------------------------------------------------
-- 1. applications
-------------------------------------------------------------------------------
create table applications (
    id           uuid          primary key default gen_random_uuid(),
    slug         varchar(64)   not null,
    name         text          not null,
    description  text,
    enabled      boolean       not null default true,

    created_at   timestamptz   not null default now(),
    updated_at   timestamptz   not null default now()
);

-- stable human-readable identifier; case-insensitive uniqueness
create unique index idx_applications_slug on applications (lower(slug));

-- list enabled applications quickly for menu/picker queries
create index idx_applications_enabled on applications (enabled) where enabled;

comment on table  applications is 'system-defined specialized chatbots exposed to the frontend.';

comment on column applications.id          is 'random uuid identifying the application.';
comment on column applications.slug        is 'stable human-readable identifier (e.g. "grant-reviewer-standard"). case-insensitive unique.';
comment on column applications.name        is 'display name shown in the ui.';
comment on column applications.description is 'short description shown in the ui. optional.';
comment on column applications.enabled     is 'soft on/off switch. disabled apps stay in the table but are hidden from listings.';

-------------------------------------------------------------------------------
-- 2. auto-update updated_at
-------------------------------------------------------------------------------
create or replace function set_applications_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger trg_applications_updated_at
    before update on applications
    for each row
    execute function set_applications_updated_at();

comment on function set_applications_updated_at is 'keeps applications.updated_at current on every update.';

-------------------------------------------------------------------------------
-- 3. record this migration
-------------------------------------------------------------------------------
insert into schema_migrations (version, name)
values (5, '005_create_applications');

commit;
