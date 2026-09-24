-- Devices in the audit trail, and the task board's four quadrants.

-- Devices ---------------------------------------------------------------------------
--
-- A browser cannot tell us its MAC address, so each one keeps a random id of its own
-- (sent as X-Device-Id) and we name it for the trail: country, kind and a number,
-- e.g. "US-desktop-01". Only the owner (OWNER_EMAIL) is shown these names.
CREATE TABLE "devices" (
  "id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "device_type" TEXT NOT NULL,
  "country" CHAR(2),
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "devices_token_key" ON "devices"("token");
CREATE UNIQUE INDEX "devices_label_key" ON "devices"("label");

ALTER TABLE "audit_logs" ADD COLUMN "device_id" UUID;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_device_id_fkey"
  FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "audit_logs_device_id_idx" ON "audit_logs"("device_id");

-- The task board --------------------------------------------------------------------
--
-- Four quadrants: needs action or can wait, strategic or not. A new task starts where
-- the work starts: needs action and strategic.
CREATE TYPE "TodoUrgency" AS ENUM ('need_action', 'can_wait');
CREATE TYPE "TodoImportance" AS ENUM ('strategic', 'non_strategic');

ALTER TABLE "todos" ADD COLUMN "urgency" "TodoUrgency" NOT NULL DEFAULT 'need_action';
ALTER TABLE "todos" ADD COLUMN "importance" "TodoImportance" NOT NULL DEFAULT 'strategic';
CREATE INDEX "todos_assignee_id_urgency_importance_position_idx"
  ON "todos"("assignee_id", "urgency", "importance", "position");
