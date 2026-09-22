-- The Founder marks a confirmed call's research data ready before the Expert starts it.
-- Its own migration: a new enum value can only be used once this one has committed.
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'research_ready' AFTER 'confirmed';
