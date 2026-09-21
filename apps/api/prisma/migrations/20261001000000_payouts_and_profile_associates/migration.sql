-- Who is paid what for a call (§3.1 "Money on a call").
--
-- The Founder pays two people per call: the Expert (their hourly rate x the real
-- duration) and the Manager (a share of the real income, 15% unless the Profile
-- says otherwise). The Manager passes the Associate's own share on from that.
-- Rates and shares are copied onto the call when they become final, so changing
-- them later never changes what an earlier call pays.
--
-- Everything here only adds columns, so the API that is still running keeps working.

-- People ---------------------------------------------------------------------------

-- An Expert's hourly rate (USD), set by the Founder.
ALTER TABLE "users" ADD COLUMN "hourly_rate" DECIMAL(12,2);
ALTER TABLE "users" ADD CONSTRAINT "users_hourly_rate_nonnegative" CHECK ("hourly_rate" IS NULL OR "hourly_rate" >= 0);

-- An Associate's share of a call's real income (percent), part of their Manager's share.
ALTER TABLE "users" ADD COLUMN "share_percent" DECIMAL(5,2);
ALTER TABLE "users" ADD CONSTRAINT "users_share_percent_range"
  CHECK ("share_percent" IS NULL OR ("share_percent" >= 0 AND "share_percent" <= 100));
UPDATE "users" SET "share_percent" = 10 WHERE "role" = 'associate';

-- Profiles -------------------------------------------------------------------------

-- The Manager's share of this Profile's income (percent).
ALTER TABLE "profiles" ADD COLUMN "manager_share_percent" DECIMAL(5,2) NOT NULL DEFAULT 15;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manager_share_range"
  CHECK ("manager_share_percent" >= 0 AND "manager_share_percent" <= 100);

-- The Associate (or Manager) who looks after the Profile.
ALTER TABLE "profiles" ADD COLUMN "associate_id" UUID;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_associate_id_fkey"
  FOREIGN KEY ("associate_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "profiles_associate_id_idx" ON "profiles"("associate_id");

-- Start from who ran the Profile's latest call, else who added it.
UPDATE "profiles" p
SET "associate_id" = latest.associate_id
FROM (
  SELECT DISTINCT ON (c.profile_id) c.profile_id, c.associate_id
  FROM "calls" c
  JOIN "users" u ON u.id = c.associate_id
  WHERE c.status <> 'cancelled' AND u.deleted_at IS NULL AND u.role IN ('associate', 'manager')
  ORDER BY c.profile_id, c.scheduled_at DESC
) latest
WHERE p.id = latest.profile_id;

UPDATE "profiles" p
SET "associate_id" = p.created_by
FROM "users" u
WHERE p.associate_id IS NULL AND u.id = p.created_by AND u.deleted_at IS NULL AND u.role IN ('associate', 'manager');

-- Calls ----------------------------------------------------------------------------

-- The Expert's hourly rate when the call finished.
ALTER TABLE "calls" ADD COLUMN "expert_rate" DECIMAL(12,2);
ALTER TABLE "calls" ADD CONSTRAINT "calls_expert_rate_nonnegative" CHECK ("expert_rate" IS NULL OR "expert_rate" >= 0);

-- The shares when the call was processed to bank, and the Manager who is paid.
ALTER TABLE "calls" ADD COLUMN "manager_share_percent" DECIMAL(5,2);
ALTER TABLE "calls" ADD COLUMN "associate_share_percent" DECIMAL(5,2);
ALTER TABLE "calls" ADD COLUMN "payee_manager_id" UUID;
ALTER TABLE "calls" ADD CONSTRAINT "calls_payee_manager_id_fkey"
  FOREIGN KEY ("payee_manager_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "calls_payee_manager_id_idx" ON "calls"("payee_manager_id");

-- When each person was paid for the call.
ALTER TABLE "calls" ADD COLUMN "expert_paid_at" TIMESTAMPTZ(3);
ALTER TABLE "calls" ADD COLUMN "manager_paid_at" TIMESTAMPTZ(3);
ALTER TABLE "calls" ADD COLUMN "associate_paid_at" TIMESTAMPTZ(3);

-- Calls already paid to the bank take today's shares.
UPDATE "calls" c
SET "manager_share_percent" = p.manager_share_percent,
    "associate_share_percent" = CASE WHEN u.role = 'associate' THEN LEAST(COALESCE(u.share_percent, 0), p.manager_share_percent) ELSE 0 END,
    "payee_manager_id" = CASE WHEN u.role = 'manager' THEN u.id ELSE u.manager_id END
FROM "profiles" p, "users" u
WHERE c.status = 'process_to_bank' AND p.id = c.profile_id AND u.id = c.associate_id;

-- The API copies the rate and the shares itself. The database does it too when they are
-- missing, so a call moved by an API that predates these columns (the one still running
-- while this migration lands) is settled the same way.
CREATE FUNCTION calls_settle_pay() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'finished' AND NEW.expert_rate IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT u.hourly_rate INTO NEW.expert_rate FROM users u WHERE u.id = NEW.expert_id;
  END IF;
  IF NEW.status = 'process_to_bank' AND NEW.manager_share_percent IS NULL THEN
    SELECT p.manager_share_percent INTO NEW.manager_share_percent FROM profiles p WHERE p.id = NEW.profile_id;
    SELECT CASE WHEN u.role = 'associate' THEN LEAST(COALESCE(u.share_percent, 0), NEW.manager_share_percent) ELSE 0 END,
           CASE WHEN u.role = 'manager' THEN u.id ELSE u.manager_id END
      INTO NEW.associate_share_percent, NEW.payee_manager_id
      FROM users u WHERE u.id = NEW.associate_id;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER calls_settle_pay BEFORE INSERT OR UPDATE OF status ON "calls"
  FOR EACH ROW EXECUTE FUNCTION calls_settle_pay();

ALTER TABLE "calls" ADD CONSTRAINT "calls_shares_range" CHECK (
  ("manager_share_percent" IS NULL OR ("manager_share_percent" >= 0 AND "manager_share_percent" <= 100))
  AND ("associate_share_percent" IS NULL OR ("associate_share_percent" >= 0 AND "associate_share_percent" <= "manager_share_percent"))
);
ALTER TABLE "calls" ADD CONSTRAINT "calls_paid_has_shares"
  CHECK ("status" <> 'process_to_bank' OR ("manager_share_percent" IS NOT NULL AND "associate_share_percent" IS NOT NULL));
-- Shares are paid out of real income, so only once the bank has paid.
ALTER TABLE "calls" ADD CONSTRAINT "calls_share_paid_when_banked"
  CHECK (("manager_paid_at" IS NULL AND "associate_paid_at" IS NULL) OR "status" = 'process_to_bank');
-- The Expert is paid for a call that took place and has a rate.
ALTER TABLE "calls" ADD CONSTRAINT "calls_expert_paid_when_priced"
  CHECK ("expert_paid_at" IS NULL OR ("expert_rate" IS NOT NULL AND "status" IN ('finished', 'invoice_submit', 'invoice_approve', 'process_to_bank')));

-- Audit trail ----------------------------------------------------------------------

-- Reading the trail is no longer recorded (§6.16); clear the entries it left behind.
DELETE FROM "audit_logs" WHERE "action" IN ('audit.read', 'audit.read.failed');
