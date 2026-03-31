-- 000_create_migrations_table.sql
--
-- Bootstraps the migration tracking system. This script is idempotent
-- and safe to run multiple times.

BEGIN;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     INTEGER      PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    checksum    VARCHAR(64)  DEFAULT NULL,
    applied_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  schema_migrations             IS 'Tracks which SQL migrations have been applied to this database.';
COMMENT ON COLUMN schema_migrations.version     IS 'Numeric prefix of the migration file (e.g. 001).';
COMMENT ON COLUMN schema_migrations.name        IS 'Human-readable migration file name.';
COMMENT ON COLUMN schema_migrations.checksum    IS 'SHA-256 hex digest of the migration file at apply time; detects post-hoc edits.';
COMMENT ON COLUMN schema_migrations.applied_at  IS 'Timestamp when the migration was applied.';

-- Seed its own record so the table is never "empty" and tooling can
-- distinguish "no migrations run" from "migrations table missing".
INSERT INTO schema_migrations (version, name)
VALUES (0, '000_create_migrations_table')
ON CONFLICT (version) DO NOTHING;

COMMIT;
