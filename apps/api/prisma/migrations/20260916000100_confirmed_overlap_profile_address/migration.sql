-- A confirmed call occupies the Expert's time like any other booked call.
ALTER TABLE "calls" DROP CONSTRAINT calls_expert_no_overlap;
ALTER TABLE "calls"
  ADD CONSTRAINT calls_expert_no_overlap EXCLUDE USING gist (
    expert_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  ) WHERE (
    expert_id IS NOT NULL AND status IN (
      'scheduled', 'confirmed', 'on_rescheduling', 'ongoing', 'finished',
      'invoice_submit', 'invoice_approve', 'process_to_bank'
    )
  );

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN "current_address" TEXT;
