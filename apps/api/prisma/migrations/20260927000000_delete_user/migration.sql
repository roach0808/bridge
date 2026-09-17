-- The Founder can delete a user: the account is erased, their work stays under a removed name.
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
