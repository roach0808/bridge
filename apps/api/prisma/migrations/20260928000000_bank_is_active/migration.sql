-- A bank account can be closed: kept for history, but the Profile then needs another one.
ALTER TABLE "profile_banks" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;
