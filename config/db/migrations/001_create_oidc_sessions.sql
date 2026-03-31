-- 001_create_oidc_sessions.sql
--
-- Sets up tables for OIDC authentication flow and session management.
--
-- Flow overview:
--   1. User initiates login -> server creates an oidc_auth_states row
--      (state, nonce, PKCE verifier) and redirects to the IdP.
--   2. IdP redirects back with an auth code + state -> server validates
--      state against oidc_auth_states, exchanges code for tokens.
--   3. Server creates a sessions row, sets a session cookie with the
--      session id, and deletes the consumed oidc_auth_states row.
--   4. Subsequent requests present the session cookie; the server looks
--      up the session to get identity and tokens.

BEGIN;

-------------------------------------------------------------------------------
-- 1. OIDC authorization states (ephemeral, consumed during callback)
-------------------------------------------------------------------------------
CREATE TABLE oidc_auth_states (
    state           VARCHAR(128)  PRIMARY KEY,
    nonce           VARCHAR(128)  NOT NULL,
    code_verifier   VARCHAR(128),
    return_path     TEXT          NOT NULL DEFAULT '/',
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ   NOT NULL
);

CREATE INDEX idx_oidc_auth_states_expires_at ON oidc_auth_states (expires_at);

COMMENT ON TABLE  oidc_auth_states                IS 'Short-lived state for in-progress OIDC authorization flows.';
COMMENT ON COLUMN oidc_auth_states.state          IS 'Cryptographically random state parameter; prevents CSRF.';
COMMENT ON COLUMN oidc_auth_states.nonce          IS 'Nonce bound to the id_token; prevents replay attacks.';
COMMENT ON COLUMN oidc_auth_states.code_verifier  IS 'PKCE code_verifier (S256); NULL if PKCE is not used.';
COMMENT ON COLUMN oidc_auth_states.return_path    IS 'Application path to redirect to after successful authentication.';
COMMENT ON COLUMN oidc_auth_states.expires_at     IS 'Hard expiry; rows past this time should be purged.';

-------------------------------------------------------------------------------
-- 2. Sessions
-------------------------------------------------------------------------------
CREATE TABLE sessions (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    subject           VARCHAR(255)  NOT NULL,
    user_info         JSONB         NOT NULL DEFAULT '{}'::jsonb,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at        TIMESTAMPTZ   NOT NULL,
    last_activity_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    ip_address        INET,
    user_agent        TEXT
);

CREATE INDEX idx_sessions_subject         ON sessions (subject);
CREATE INDEX idx_sessions_expires_at      ON sessions (expires_at);
CREATE INDEX idx_sessions_last_activity   ON sessions (last_activity_at);

COMMENT ON TABLE  sessions                       IS 'Authenticated user sessions. The session id is set in an HTTP-only cookie.';
COMMENT ON COLUMN sessions.id                    IS 'Session identifier; stored in the client cookie. UUID v4 by default.';
COMMENT ON COLUMN sessions.subject               IS 'OIDC "sub" claim — the stable user identifier from the identity provider.';
COMMENT ON COLUMN sessions.user_info             IS 'Cached claims from the OIDC userinfo endpoint or id_token.';
COMMENT ON COLUMN sessions.expires_at            IS 'Absolute session expiry; the session cannot be extended past this time.';
COMMENT ON COLUMN sessions.last_activity_at      IS 'Updated on each authenticated request; used for idle-timeout eviction.';
COMMENT ON COLUMN sessions.ip_address            IS 'Client IP at session creation; useful for audit logging.';
COMMENT ON COLUMN sessions.user_agent            IS 'Client User-Agent at session creation.';

-------------------------------------------------------------------------------
-- 3. Cleanup: remove expired rows
-------------------------------------------------------------------------------
-- Run periodically (e.g. via pg_cron or an application-level scheduler).

CREATE OR REPLACE FUNCTION purge_expired_oidc_states()
RETURNS INTEGER
LANGUAGE sql
AS $$
    DELETE FROM oidc_auth_states
    WHERE  expires_at < now()
    RETURNING 1;
$$;

CREATE OR REPLACE FUNCTION purge_expired_sessions()
RETURNS INTEGER
LANGUAGE sql
AS $$
    DELETE FROM sessions
    WHERE  expires_at < now()
    RETURNING 1;
$$;

COMMENT ON FUNCTION purge_expired_oidc_states IS 'Deletes expired OIDC auth states. Returns the number of rows removed.';
COMMENT ON FUNCTION purge_expired_sessions    IS 'Deletes expired sessions. Returns the number of rows removed.';

-------------------------------------------------------------------------------
-- 4. Record this migration
-------------------------------------------------------------------------------
INSERT INTO schema_migrations (version, name)
-- The migration runner computes a SHA-256 checksum of this file and
-- updates the row after the migration is applied successfully.
VALUES (1, '001_create_oidc_sessions');

COMMIT;
