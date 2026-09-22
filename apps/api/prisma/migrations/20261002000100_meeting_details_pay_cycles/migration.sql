-- Meeting details, the research step in the booking rules, monthly payment cycles,
-- Associates' shares as a portion of their Manager's, and platform statuses without a rate.
-- Only adds and relaxes, so the API still running while this lands keeps working.

-- Calls ----------------------------------------------------------------------------

-- How to join the platform's meeting (link, passcode…), added by whoever runs the call.
ALTER TABLE "calls" ADD COLUMN "meeting_details" TEXT;

-- A call whose research data is ready still holds the Expert's time.
ALTER TABLE "calls" DROP CONSTRAINT calls_expert_no_overlap;
ALTER TABLE "calls"
  ADD CONSTRAINT calls_expert_no_overlap EXCLUDE USING gist (
    expert_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  ) WHERE (
    expert_id IS NOT NULL AND status IN (
      'scheduled', 'confirmed', 'research_ready', 'on_rescheduling', 'ongoing', 'finished',
      'invoice_submit', 'invoice_approve', 'process_to_bank'
    )
  );

-- When the money reached the bank: income counts in the payment cycle it arrived in.
ALTER TABLE "calls" ADD COLUMN "banked_at" TIMESTAMPTZ(3);
UPDATE "calls" c
SET "banked_at" = COALESCE(
  (SELECT max(h.created_at) FROM "call_status_history" h WHERE h.call_id = c.id AND h.to_status = 'process_to_bank'),
  c.updated_at
)
WHERE c.status = 'process_to_bank';
CREATE INDEX "calls_banked_at_idx" ON "calls"("banked_at");

-- Associates' shares --------------------------------------------------------------------

-- An Associate's percent is now a portion of their Manager's share, not of the whole income.
-- Calls already paid keep the same amounts: their percent is restated against the Manager's.
ALTER TABLE "calls" DROP CONSTRAINT "calls_shares_range";
UPDATE "calls"
SET "associate_share_percent" = CASE
  WHEN "manager_share_percent" > 0 THEN LEAST(100, ROUND("associate_share_percent" * 100 / "manager_share_percent", 2))
  ELSE 0
END
WHERE "associate_share_percent" IS NOT NULL;
ALTER TABLE "calls" ADD CONSTRAINT "calls_shares_range" CHECK (
  ("manager_share_percent" IS NULL OR ("manager_share_percent" >= 0 AND "manager_share_percent" <= 100))
  AND ("associate_share_percent" IS NULL OR ("associate_share_percent" >= 0 AND "associate_share_percent" <= 100))
);

-- Associates still on the old default (10% of the income) take the new one: half their
-- Manager's share. Anyone set differently keeps the same money on a standard 15% share.
UPDATE "users"
SET "share_percent" = CASE
  WHEN "share_percent" = 10 THEN 50
  ELSE LEAST(100, ROUND("share_percent" * 100 / 15, 2))
END
WHERE "role" = 'associate' AND "share_percent" IS NOT NULL;

-- The database settles a call the API left unsettled (see 20261001000000), now with the
-- Associate's percent of the Manager's share, and stamps when the money reached the bank.
CREATE OR REPLACE FUNCTION calls_settle_pay() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'finished' AND NEW.expert_rate IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT u.hourly_rate INTO NEW.expert_rate FROM users u WHERE u.id = NEW.expert_id;
  END IF;
  IF NEW.status = 'process_to_bank' AND NEW.manager_share_percent IS NULL THEN
    SELECT p.manager_share_percent INTO NEW.manager_share_percent FROM profiles p WHERE p.id = NEW.profile_id;
    SELECT CASE WHEN u.role = 'associate' THEN COALESCE(u.share_percent, 0) ELSE 0 END,
           CASE WHEN u.role = 'manager' THEN u.id ELSE u.manager_id END
      INTO NEW.associate_share_percent, NEW.payee_manager_id
      FROM users u WHERE u.id = NEW.associate_id;
  END IF;
  IF NEW.status = 'process_to_bank' AND NEW.banked_at IS NULL THEN
    NEW.banked_at := now();
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Payment cycles ------------------------------------------------------------------------

-- A month the Founder closed by paying everyone: what came in and went out, kept as it was.
CREATE TABLE "pay_cycles" (
  "id" UUID NOT NULL,
  "label" TEXT NOT NULL,
  "started_at" TIMESTAMPTZ(3),
  "closed_at" TIMESTAMPTZ(3) NOT NULL,
  "closed_by" UUID NOT NULL,
  "income" DECIMAL(14,2) NOT NULL,
  "paid_experts" DECIMAL(14,2) NOT NULL,
  "paid_managers" DECIMAL(14,2) NOT NULL,
  "paid_associates" DECIMAL(14,2) NOT NULL,
  "lines" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pay_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pay_cycles_label_present" CHECK ("label" ~ '[^[:space:]]'),
  CONSTRAINT "pay_cycles_window" CHECK ("started_at" IS NULL OR "started_at" < "closed_at")
);
ALTER TABLE "pay_cycles" ADD CONSTRAINT "pay_cycles_closed_by_fkey"
  FOREIGN KEY ("closed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "pay_cycles_closed_at_key" ON "pay_cycles"("closed_at");

-- Profiles ---------------------------------------------------------------------------------

-- Associates and Managers now set platform statuses too, without seeing rates; the rate
-- stays the Founder's, and invoicing still needs one (409 rate_required).
ALTER TABLE "profile_platform_statuses" DROP CONSTRAINT IF EXISTS "profile_platform_statuses_rate_when_registered";
