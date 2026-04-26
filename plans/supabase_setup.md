# Supabase Database Setup Guide

To fix the error `Could not find the table 'public.users' in the schema cache`, you need to create the required tables in your Supabase project.

Follow these steps to set up your database:

### 1. Open Supabase SQL Editor
1. Go to your [Supabase Dashboard](https://supabase.com/dashboard).
2. Select your project.
3. Click on **SQL Editor** in the left sidebar (the `>_` icon).
4. Click **New query**.

### 2. Run the Initial Schema SQL
Copy and paste the following SQL code into the editor and click **Run**.

```sql
-- ============================================================================
-- Project Jarvis — Initial Database Schema
-- ============================================================================

-- 1. Enable UUID extension (usually enabled by default)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Users Table
CREATE TABLE IF NOT EXISTS users (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        UNIQUE NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL DEFAULT 'user'
                            CHECK (role IN ('admin', 'user', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 3. Create Sessions Table
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

-- 4. Create Conversations Table
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

-- 5. Create Context Snapshots Table
CREATE TABLE IF NOT EXISTS context_snapshots (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid        NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  summary     text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 6. Create User Access Policies Table
CREATE TABLE IF NOT EXISTS user_access_policies (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  role        text    NOT NULL,
  feature_key text    NOT NULL,
  is_allowed  boolean NOT NULL DEFAULT true,
  UNIQUE (role, feature_key)
);

-- 7. Add Performance Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active ON sessions (user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);
CREATE INDEX IF NOT EXISTS idx_conv_session_created ON conversations (session_id, created_at DESC);

-- 8. Enable Row Level Security (RLS)
ALTER TABLE users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions             ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_snapshots    ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_access_policies ENABLE ROW LEVEL SECURITY;

-- 9. Allow full access via service_role key (used by backend)
CREATE POLICY "Service role full access" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON conversations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON context_snapshots FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON user_access_policies FOR ALL USING (true) WITH CHECK (true);
```

### 3. Restart the App
Once the query executes successfully, restart your development server:

```bash
npm run dev
```

The error should now be gone, and the app will verify the connection at startup.
