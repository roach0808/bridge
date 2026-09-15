-- CreateEnum
CREATE TYPE "PlatformRegistration" AS ENUM ('not_registered', 'registered', 'banned');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "actual_duration_minutes" INTEGER,
ADD COLUMN     "feedback" TEXT,
ADD COLUMN     "ninja_link" TEXT,
ADD COLUMN     "rating" INTEGER;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "career_history" TEXT,
ADD COLUMN     "date_of_birth" DATE,
ADD COLUMN     "education" TEXT,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "nationality" TEXT;

-- CreateTable
CREATE TABLE "profile_platform_statuses" (
    "profile_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "status" "PlatformRegistration" NOT NULL DEFAULT 'not_registered',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_platform_statuses_pkey" PRIMARY KEY ("profile_id","platform_id")
);

-- AddForeignKey
ALTER TABLE "profile_platform_statuses" ADD CONSTRAINT "profile_platform_statuses_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_platform_statuses" ADD CONSTRAINT "profile_platform_statuses_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Check constraints (hand-written)
ALTER TABLE "calls" ADD CONSTRAINT "calls_rating_range" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
ALTER TABLE "calls" ADD CONSTRAINT "calls_actual_duration_positive" CHECK ("actual_duration_minutes" IS NULL OR "actual_duration_minutes" > 0);
