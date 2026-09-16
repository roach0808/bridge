-- A call now has two payment figures:
--   expected price = rate x actual duration (calculated, not stored)
--   real income    = what reached the bank, entered at "processed to bank"
-- The single invoice amount they replace is carried over for calls already paid in USD.

ALTER TABLE "calls" ADD COLUMN "real_income" DECIMAL(12,2);

UPDATE "calls"
SET "real_income" = "invoice_amount"
WHERE "status" = 'process_to_bank'
  AND "invoice_amount" IS NOT NULL
  AND ("invoice_currency" IS NULL OR "invoice_currency" = 'USD');

-- Dropping the columns also drops calls_invoice_amount_nonnegative and calls_invoice_currency_format.
ALTER TABLE "calls" DROP COLUMN "invoice_amount", DROP COLUMN "invoice_currency";

ALTER TABLE "calls" ADD CONSTRAINT "calls_real_income_nonnegative" CHECK ("real_income" IS NULL OR "real_income" >= 0);

-- A call paid from now on must say how much arrived. NOT VALID: older paid calls
-- without an amount are left as they are.
ALTER TABLE "calls" ADD CONSTRAINT "calls_paid_has_real_income"
  CHECK ("status" <> 'process_to_bank' OR "real_income" IS NOT NULL) NOT VALID;
