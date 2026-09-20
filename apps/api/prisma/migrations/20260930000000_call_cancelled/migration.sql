-- A call called off before it started. It frees the Expert's time (it is left out
-- of calls_expert_no_overlap) and earns nothing.
ALTER TYPE "CallStatus" ADD VALUE IF NOT EXISTS 'cancelled';
