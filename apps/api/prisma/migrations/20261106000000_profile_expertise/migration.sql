-- The Profile's niche field, shown to everyone who can see the Profile.
ALTER TABLE "profiles" ADD COLUMN "expertise" TEXT NOT NULL DEFAULT '';
