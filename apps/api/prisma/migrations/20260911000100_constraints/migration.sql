-- Constraints Prisma cannot express (§3.3).

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ends_at = scheduled_at + duration, kept by trigger.
CREATE OR REPLACE FUNCTION calls_set_ends_at() RETURNS trigger AS $$
BEGIN
  NEW.ends_at := NEW.scheduled_at + make_interval(mins => NEW.duration_minutes);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calls_set_ends_at
  BEFORE INSERT OR UPDATE OF scheduled_at, duration_minutes, ends_at ON "calls"
  FOR EACH ROW EXECUTE FUNCTION calls_set_ends_at();

ALTER TABLE "calls"
  ADD CONSTRAINT calls_duration_allowed CHECK (duration_minutes IN (15, 30, 45, 60)),
  ADD CONSTRAINT calls_project_details_present CHECK (project_details ~ '[^[:space:]]'),
  ADD CONSTRAINT calls_platform_associate_present CHECK (platform_associate_name ~ '[^[:space:]]'),
  ADD CONSTRAINT calls_expert_required_when_scheduled CHECK (
    expert_id IS NOT NULL OR status = 'on_scheduling'
  ),
  ADD CONSTRAINT calls_invoice_amount_nonnegative CHECK (invoice_amount IS NULL OR invoice_amount >= 0),
  ADD CONSTRAINT calls_invoice_currency_format CHECK (invoice_currency IS NULL OR invoice_currency ~ '^[A-Z]{3}$');

ALTER TABLE "calls"
  ADD CONSTRAINT calls_expert_no_overlap EXCLUDE USING gist (
    expert_id WITH =,
    tstzrange(scheduled_at, ends_at, '[)') WITH &&
  ) WHERE (
    expert_id IS NOT NULL AND status IN (
      'scheduled', 'on_rescheduling', 'ongoing', 'finished',
      'invoice_submit', 'invoice_approve', 'process_to_bank'
    )
  );

ALTER TABLE "platforms"
  ADD CONSTRAINT platforms_country_format CHECK (country ~ '^[A-Z]{2}$');

ALTER TABLE "profiles"
  ADD CONSTRAINT profiles_rejection_reason_required CHECK (
    status <> 'rejected' OR (rejection_reason IS NOT NULL AND rejection_reason ~ '[^[:space:]]')
  );

ALTER TABLE "users"
  ADD CONSTRAINT users_manager_only_for_associates CHECK (role = 'associate' OR manager_id IS NULL);

ALTER TABLE "schedule_blocks"
  ADD CONSTRAINT schedule_blocks_start_minute CHECK (start_minute BETWEEN 0 AND 1439),
  ADD CONSTRAINT schedule_blocks_duration CHECK (duration_minutes BETWEEN 5 AND 1440),
  ADD CONSTRAINT schedule_blocks_interval CHECK ("interval" BETWEEN 1 AND 99),
  ADD CONSTRAINT schedule_blocks_weekdays_range CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]),
  ADD CONSTRAINT schedule_blocks_weekly_needs_weekdays CHECK (
    frequency <> 'weekly' OR cardinality(weekdays) > 0
  ),
  ADD CONSTRAINT schedule_blocks_until_when_repeating CHECK (
    (frequency = 'none' AND until_date IS NULL)
    OR (frequency <> 'none' AND until_date IS NOT NULL
        AND until_date >= start_date AND until_date <= start_date + 1096)
  ),
  ADD CONSTRAINT schedule_blocks_month_day CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
  ADD CONSTRAINT schedule_blocks_set_position CHECK (set_position IS NULL OR set_position IN (1, 2, 3, 4, -1)),
  ADD CONSTRAINT schedule_blocks_weekday CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
  ADD CONSTRAINT schedule_blocks_month CHECK (month IS NULL OR month BETWEEN 1 AND 12);
