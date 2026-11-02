-- A call paid to bank has its ETA set to that day (team time) from now on; calls
-- already paid get the day they were paid, where they have no ETA yet.
UPDATE "calls"
SET "payment_eta" = ("banked_at" AT TIME ZONE 'America/New_York')::date
WHERE "status" = 'process_to_bank' AND "banked_at" IS NOT NULL AND "payment_eta" IS NULL;
