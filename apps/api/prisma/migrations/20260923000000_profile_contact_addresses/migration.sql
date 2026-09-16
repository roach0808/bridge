-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "email" TEXT,
ADD COLUMN     "onboarded_at" DATE,
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "profile_addresses" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_addresses_profile_id_sort_order_idx" ON "profile_addresses"("profile_id", "sort_order");

-- AddForeignKey
ALTER TABLE "profile_addresses" ADD CONSTRAINT "profile_addresses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill (hand-written)
-- Profiles that are already approved were onboarded when they were approved.
UPDATE "profiles" SET "onboarded_at" = ("reviewed_at" AT TIME ZONE 'America/New_York')::date
WHERE "status" = 'approved' AND "onboarded_at" IS NULL AND "reviewed_at" IS NOT NULL;

-- The single current address becomes the first labelled address.
INSERT INTO "profile_addresses" ("id", "profile_id", "label", "address", "sort_order", "updated_at")
SELECT gen_random_uuid(), "id", 'Current address', "current_address", 0, CURRENT_TIMESTAMP
FROM "profiles" WHERE "current_address" IS NOT NULL AND btrim("current_address") <> '';
