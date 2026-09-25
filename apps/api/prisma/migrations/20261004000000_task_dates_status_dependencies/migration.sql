-- Tasks gain execution and accountability timing, richer progress, and what they wait for.
-- Additive: an older API keeps working against this schema, because `open` and
-- `done` keep their meaning and every new column is nullable or defaulted.

-- "Not Started" and "Ready for Review" are the enum's existing `open` and `done`;
-- these two are the states that had nowhere to live.
ALTER TYPE "TodoStatus" ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'open';
ALTER TYPE "TodoStatus" ADD VALUE IF NOT EXISTS 'blocked' AFTER 'in_progress';
