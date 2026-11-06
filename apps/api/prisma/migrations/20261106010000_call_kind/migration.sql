-- A call is a client consultation (invoiced and paid) or an Expert's call with an
-- expert network's associate (nobody is paid). Every call so far is a consultation.
CREATE TYPE "CallKind" AS ENUM ('consultation', 'network');
ALTER TABLE "calls" ADD COLUMN "kind" "CallKind" NOT NULL DEFAULT 'consultation';

-- The database's own safety net copies the Expert's rate onto a finished call the API
-- left without one. Nobody is paid for a network call, so it leaves those alone.
CREATE OR REPLACE FUNCTION calls_settle_pay() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'finished' AND NEW.expert_rate IS NULL AND NEW.kind = 'consultation'
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
