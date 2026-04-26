-- ============================================================================
-- Project Jarvis — Initial Database Schema
-- Run this in Supabase SQL Editor to create all tables
-- ============================================================================

-- ── Users ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        UNIQUE NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'user'
                            CHECK (role IN ('admin', 'user', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── Sessions ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          text,
  is_active      boolean     NOT NULL DEFAULT true,
  status         text        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'expired', 'archived', 'pending_delete')),
  intent         text        DEFAULT '',
  current_state  text        DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions (user_id);

CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions (user_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sessions_status
  ON sessions (status);

-- ── Conversations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversations (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role          text        NOT NULL
                            CHECK (role IN ('user', 'assistant', 'system', 'error')),
  content       text        NOT NULL,
  response_type text,
  metadata      jsonb       DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conv_session_created
  ON conversations (session_id, created_at DESC);

-- ── Context Snapshots ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS context_snapshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ── User Access Policies ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_access_policies (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text    NOT NULL,
  feature_key text    NOT NULL,
  is_allowed  boolean NOT NULL DEFAULT true,
  UNIQUE (role, feature_key)
);

-- ── Row Level Security ─────────────────────────────────────────────────────────
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_access_policies ENABLE ROW LEVEL SECURITY;

-- Allow full access via service_role key (used by backend)
CREATE POLICY "Service role full access" ON users
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sessions
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON conversations
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON context_snapshots
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON user_access_policies
  FOR ALL USING (true) WITH CHECK (true);
