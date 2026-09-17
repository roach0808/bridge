-- Chat: pictures, emoji reactions, and deleting a message (its content is erased).
-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "deleted_at" TIMESTAMPTZ(3),
ADD COLUMN     "image_id" UUID;

-- CreateTable
CREATE TABLE "chat_images" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_reactions" (
    "message_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reactions_pkey" PRIMARY KEY ("message_id","user_id","emoji")
);

-- CreateIndex
CREATE INDEX "chat_images_conversation_id_idx" ON "chat_images"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_image_id_key" ON "chat_messages"("image_id");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "chat_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_images" ADD CONSTRAINT "chat_images_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Check constraints (hand-written)
-- Replaces "the body is never blank": a picture may go without a caption, and a deleted message is empty.
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_body_present";
-- A deleted message keeps no text or picture; any other message has text, a picture, or both.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_is_empty"
  CHECK ("deleted_at" IS NULL OR ("image_id" IS NULL AND "body" = ''));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_has_content"
  CHECK ("deleted_at" IS NOT NULL OR "image_id" IS NOT NULL OR "body" ~ '[^[:space:]]');
ALTER TABLE "chat_reactions" ADD CONSTRAINT "chat_reactions_emoji_short"
  CHECK (char_length("emoji") BETWEEN 1 AND 16);
