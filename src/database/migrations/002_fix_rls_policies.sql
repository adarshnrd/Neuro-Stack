-- ============================================================================
-- Project NeuroStack — Fix Row Level Security Policies
-- Run this in the Supabase SQL Editor after 001_initial_schema.sql
--
-- The policies from 001 used USING (true) with no TO clause, which applies to
-- EVERY role — including `anon`. That granted anyone holding the public
-- (publishable/anon) key full read/write access to all tables, including
-- users.password_hash.
--
-- The backend connects with the secret (service_role) key, which bypasses RLS
-- entirely, so it needs no policy. With the permissive policies removed and no
-- replacement for anon/authenticated, RLS-enabled tables deny those roles by
-- default — which is exactly what we want.
-- ============================================================================

DROP POLICY IF EXISTS "Service role full access" ON users;
DROP POLICY IF EXISTS "Service role full access" ON sessions;
DROP POLICY IF EXISTS "Service role full access" ON conversations;
DROP POLICY IF EXISTS "Service role full access" ON context_snapshots;
DROP POLICY IF EXISTS "Service role full access" ON user_access_policies;
