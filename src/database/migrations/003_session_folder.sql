-- ============================================================================
-- Project NeuroStack — Per-session project folder
-- Run this in the Supabase SQL Editor after 002_fix_rls_policies.sql
--
-- Each chat session can be bound to one local project folder. Prompts sent in
-- that session run the folder agent there, so different sessions can work on
-- different projects at the same time.
-- ============================================================================

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS folder_path text;
