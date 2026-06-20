-- ============================================================================
-- Callback Reminder Engine — required database migration
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query)
-- before/along with deploying the new reminder engine code.
--
-- I (Claude) cannot execute DDL (ALTER TABLE) through Supabase's REST API —
-- only direct SQL access can do that, hence this file for you to run by hand.
-- ============================================================================

-- 1. Add the column the reminder engine uses to persist "when was this
--    callback's reminder last shown" so a page refresh can't reset the
--    snooze cadence or cause it to re-pop early.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS last_snooze_at timestamptz;

-- That's it for schema changes. last_snooze_at is `timestamptz`, same as
-- due_date — the app code writes it via timeUtils.toDbTimestamp() and reads
-- it via timeUtils.parseIST(), exactly like due_date.
