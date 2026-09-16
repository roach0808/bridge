-- Tasks no longer have to come from a chat message: a standalone task has a title.
ALTER TABLE "todos" ALTER COLUMN "message_id" DROP NOT NULL,
  ALTER COLUMN "conversation_id" DROP NOT NULL,
  ADD COLUMN "title" TEXT,
  ADD COLUMN "details" TEXT,
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(3);

-- Check constraints (hand-written)
ALTER TABLE "todos" DROP CONSTRAINT "todos_done_at_when_done";
ALTER TABLE "todos" ADD CONSTRAINT "todos_done_at_when_done"
  CHECK (("status" IN ('done', 'completed')) = ("done_at" IS NOT NULL));
ALTER TABLE "todos" ADD CONSTRAINT "todos_confirmed_when_completed"
  CHECK (("status" = 'completed') = ("confirmed_at" IS NOT NULL));
-- A task is about something: a chat message, or a title.
ALTER TABLE "todos" ADD CONSTRAINT "todos_has_subject"
  CHECK ("message_id" IS NOT NULL OR ("title" IS NOT NULL AND btrim("title") <> ''));
ALTER TABLE "todos" ADD CONSTRAINT "todos_message_in_conversation"
  CHECK (("message_id" IS NULL) = ("conversation_id" IS NULL));
