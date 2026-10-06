-- Experts chat with Managers and Associates again, but only to schedule calls:
-- each message is one of the set sentences, stored as { key, params } so every
-- reader sees its times in their own zone. The body keeps it as the sender read it.

ALTER TABLE "chat_messages" ADD COLUMN "scheduling" JSONB;
