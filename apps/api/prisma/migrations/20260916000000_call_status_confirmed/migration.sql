-- The Expert confirms a scheduled call before it can start.
-- Kept on its own: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "CallStatus" ADD VALUE 'confirmed' AFTER 'scheduled';
