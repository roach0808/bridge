-- The Founder can delete a Profile. One with calls keeps them, under a removed name, with its personal details erased.
ALTER TABLE "profiles" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
