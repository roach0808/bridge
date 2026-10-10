-- Group chats: a conversation is one-to-one (two users, as before) or a group
-- with a title, a picture and members, each with a role and their own read
-- marker. Messages can @mention people, and a `system` message records what
-- happened in a group (created, added, left, renamed).

ALTER TYPE "ChatMessageKind" ADD VALUE 'system';

CREATE TYPE "ConversationKind" AS ENUM ('direct', 'group');
CREATE TYPE "GroupRole" AS ENUM ('owner', 'admin', 'member');

ALTER TABLE "conversations"
  ADD COLUMN "kind" "ConversationKind" NOT NULL DEFAULT 'direct',
  ADD COLUMN "title" TEXT,
  ADD COLUMN "photo_id" UUID,
  ADD COLUMN "created_by" UUID,
  ALTER COLUMN "user_a_id" DROP NOT NULL,
  ALTER COLUMN "user_b_id" DROP NOT NULL;

CREATE UNIQUE INDEX "conversations_photo_id_key" ON "conversations"("photo_id");
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_photo_id_fkey"
  FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A one-to-one chat has its two people and no title; a group has a title and neither.
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_shape" CHECK (
  ("kind" = 'direct' AND "user_a_id" IS NOT NULL AND "user_b_id" IS NOT NULL AND "title" IS NULL)
  OR ("kind" = 'group' AND "user_a_id" IS NULL AND "user_b_id" IS NULL AND "title" IS NOT NULL)
);

CREATE TABLE "conversation_members" (
  "conversation_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "GroupRole" NOT NULL DEFAULT 'member',
  "last_read_at" TIMESTAMPTZ(3),
  "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversation_id", "user_id")
);
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD COLUMN "mention_ids" UUID[] NOT NULL DEFAULT ARRAY[]::UUID[];
