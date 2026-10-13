-- Notes on a task: the work as it goes, written by the people the task
-- concerns. No length cap; only the request size bounds a note.

CREATE TABLE "todo_notes" (
    "id" UUID NOT NULL,
    "todo_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "todo_notes_pkey" PRIMARY KEY ("id"),
    -- A blank note says nothing.
    CONSTRAINT "todo_notes_body_present" CHECK (btrim("body") <> '')
);

CREATE INDEX "todo_notes_todo_id_created_at_idx" ON "todo_notes"("todo_id", "created_at");
CREATE INDEX "todo_notes_author_id_idx" ON "todo_notes"("author_id");

ALTER TABLE "todo_notes" ADD CONSTRAINT "todo_notes_todo_id_fkey"
  FOREIGN KEY ("todo_id") REFERENCES "todos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "todo_notes" ADD CONSTRAINT "todo_notes_author_id_fkey"
  FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
