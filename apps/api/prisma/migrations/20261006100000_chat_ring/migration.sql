-- Ringing someone in a chat (RING_SECONDS in @god/shared): the ring itself lives
-- only while it sounds; the chat keeps a `ring` message saying it happened.

ALTER TYPE "ChatMessageKind" ADD VALUE 'ring';
