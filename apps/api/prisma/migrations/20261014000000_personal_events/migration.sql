-- A Founder's own events: their schedule beside the calls, seen only by them.
-- They repeat like an Expert's time off (schedule_blocks) and follow the same
-- rules, but never block an Expert or a call.

CREATE TABLE "personal_events" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "time_zone" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT false,
    "start_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "frequency" "Frequency" NOT NULL DEFAULT 'none',
    "interval" INTEGER NOT NULL DEFAULT 1,
    "weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "month_day" INTEGER,
    "set_position" INTEGER,
    "weekday" INTEGER,
    "month" INTEGER,
    "until_date" DATE,
    "exception_dates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "personal_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT personal_events_title_present CHECK (btrim(title) <> ''),
    CONSTRAINT personal_events_start_minute CHECK (start_minute BETWEEN 0 AND 1439),
    CONSTRAINT personal_events_duration CHECK (duration_minutes BETWEEN 5 AND 1440),
    CONSTRAINT personal_events_interval CHECK ("interval" BETWEEN 1 AND 99),
    CONSTRAINT personal_events_weekdays_range CHECK (weekdays <@ ARRAY[1,2,3,4,5,6,7]),
    CONSTRAINT personal_events_weekly_needs_weekdays CHECK (
      frequency <> 'weekly' OR cardinality(weekdays) > 0
    ),
    CONSTRAINT personal_events_until_when_repeating CHECK (
      (frequency = 'none' AND until_date IS NULL)
      OR (frequency <> 'none' AND until_date IS NOT NULL
          AND until_date >= start_date AND until_date <= start_date + 1096)
    ),
    CONSTRAINT personal_events_month_day CHECK (month_day IS NULL OR month_day BETWEEN 1 AND 31),
    CONSTRAINT personal_events_set_position CHECK (set_position IS NULL OR set_position IN (1, 2, 3, 4, -1)),
    CONSTRAINT personal_events_weekday CHECK (weekday IS NULL OR weekday BETWEEN 1 AND 7),
    CONSTRAINT personal_events_month CHECK (month IS NULL OR month BETWEEN 1 AND 12)
);

CREATE INDEX "personal_events_owner_id_start_date_idx" ON "personal_events"("owner_id", "start_date");

ALTER TABLE "personal_events" ADD CONSTRAINT "personal_events_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
