-- The columns behind the new task fields. Split from the enum migration because
-- Postgres will not use a new enum value in the transaction that added it.

ALTER TABLE "todos"
  ADD COLUMN "start_by_at" TIMESTAMPTZ(3),
  ADD COLUMN "start_by_has_time" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "complete_by_at" TIMESTAMPTZ(3),
  ADD COLUMN "complete_by_has_time" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "time_zone" TEXT,
  ADD COLUMN "expected_deliverable" TEXT,
  ADD COLUMN "definition_of_done" TEXT,
  ADD COLUMN "blocked_reason" TEXT;

-- A task is blocked exactly when it says what is blocking it.
ALTER TABLE "todos" ADD CONSTRAINT "todos_blocked_has_reason"
  CHECK (("status" = 'blocked') = ("blocked_reason" IS NOT NULL));

-- A deadline is never before the day work may begin.
ALTER TABLE "todos" ADD CONSTRAINT "todos_dates_in_order"
  CHECK ("start_by_at" IS NULL OR "complete_by_at" IS NULL OR "complete_by_at" >= "start_by_at");

-- The two views read these two columns; a task without a date sorts last.
CREATE INDEX "todos_start_by_at_idx" ON "todos" ("start_by_at");
CREATE INDEX "todos_complete_by_at_idx" ON "todos" ("complete_by_at");

-- What a task waits for. A task never waits for itself, and a pair is listed once.
CREATE TABLE "todo_dependencies" (
  "todo_id" UUID NOT NULL,
  "depends_on_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "todo_dependencies_pkey" PRIMARY KEY ("todo_id", "depends_on_id"),
  CONSTRAINT "todo_dependencies_not_itself" CHECK ("todo_id" <> "depends_on_id"),
  CONSTRAINT "todo_dependencies_todo_id_fkey" FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "todo_dependencies_depends_on_id_fkey" FOREIGN KEY ("depends_on_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "todo_dependencies_depends_on_id_idx" ON "todo_dependencies" ("depends_on_id");
