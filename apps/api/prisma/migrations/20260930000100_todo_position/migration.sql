-- Tasks are ordered by hand inside each panel.
ALTER TABLE "todos" ADD COLUMN IF NOT EXISTS "position" INTEGER NOT NULL DEFAULT 0;

-- Start from the order the board used until now: open first, newest first.
UPDATE "todos" t
SET "position" = o.pos
FROM (
  SELECT id, (row_number() OVER (PARTITION BY assignee_id ORDER BY status ASC, created_at DESC)) * 100 AS pos
  FROM "todos"
) o
WHERE o.id = t.id;

CREATE INDEX IF NOT EXISTS "todos_assignee_id_position_idx" ON "todos" ("assignee_id", "position");
