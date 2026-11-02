-- When the Founder expects a finished call's money to arrive (the ETA column of
-- the Finance table). The Founder's alone (§6.8).
ALTER TABLE "calls" ADD COLUMN "payment_eta" DATE;
