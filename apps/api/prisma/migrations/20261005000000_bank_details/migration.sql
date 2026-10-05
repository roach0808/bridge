-- Banks get the details the Founder works with: a nickname, a type, the address,
-- the online banking login (password encrypted by the API) and where it is signed in.
-- Routing number and type are required from now on; account holder, country,
-- currency, notes and "primary" are gone.

ALTER TABLE "profile_banks"
  DROP CONSTRAINT profile_banks_required_present,
  DROP CONSTRAINT profile_banks_country_format,
  DROP CONSTRAINT profile_banks_currency_format;
DROP INDEX IF EXISTS profile_banks_one_primary;

ALTER TABLE "profile_banks"
  ADD COLUMN "nickname" TEXT,
  ADD COLUMN "bank_type" TEXT,
  ADD COLUMN "bank_address" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "password_enc" TEXT,
  ADD COLUMN "sign_in_location" TEXT;

ALTER TABLE "profile_banks" RENAME COLUMN "swift_bic" TO "swift_code";

-- Accounts added before these were required: the Founder fills them in on the next edit.
UPDATE "profile_banks" SET "bank_type" = 'Unknown' WHERE "bank_type" IS NULL;
UPDATE "profile_banks" SET "routing_number" = 'Unknown' WHERE "routing_number" IS NULL OR "routing_number" !~ '[^[:space:]]';

ALTER TABLE "profile_banks"
  ALTER COLUMN "bank_type" SET NOT NULL,
  ALTER COLUMN "routing_number" SET NOT NULL,
  DROP COLUMN "account_holder",
  DROP COLUMN "country",
  DROP COLUMN "currency",
  DROP COLUMN "notes",
  DROP COLUMN "is_primary";

ALTER TABLE "profile_banks"
  ADD CONSTRAINT profile_banks_required_present CHECK (
    bank_type ~ '[^[:space:]]' AND bank_name ~ '[^[:space:]]'
    AND routing_number ~ '[^[:space:]]' AND account_number ~ '[^[:space:]]'
  );

-- The bank an invoice was submitted to. A bank with invoices cannot be deleted, only deactivated.
ALTER TABLE "calls" ADD COLUMN "bank_id" UUID;
ALTER TABLE "calls" ADD CONSTRAINT "calls_bank_id_fkey" FOREIGN KEY ("bank_id") REFERENCES "profile_banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "calls_bank_id_idx" ON "calls"("bank_id");
