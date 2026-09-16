-- A task is completed once its giver confirms it done.
-- On its own: a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "TodoStatus" ADD VALUE 'completed';
