-- A Profile is handled by a Manager and their whole team, no longer by one
-- Associate. Each Profile goes to the team of whoever looked after it: the
-- Associate's Manager, or the Manager themselves.
--
-- `associate_id` stays (unused) until the running API no longer reads it.

ALTER TABLE "profiles" ADD COLUMN "manager_id" UUID;

UPDATE "profiles" AS p
SET "manager_id" = CASE WHEN u."role" = 'manager' THEN u."id" ELSE u."manager_id" END
FROM "users" AS u
WHERE u."id" = p."associate_id";

ALTER TABLE "profiles" ADD CONSTRAINT "profiles_manager_id_fkey"
  FOREIGN KEY ("manager_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "profiles_manager_id_idx" ON "profiles"("manager_id");
