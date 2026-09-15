-- AlterTable
ALTER TABLE "profile_platform_statuses" ADD COLUMN     "rate" DECIMAL(12,2) NOT NULL DEFAULT 1000;


-- Check constraint (hand-written)
ALTER TABLE "profile_platform_statuses" ADD CONSTRAINT "profile_platform_statuses_rate_nonnegative" CHECK ("rate" >= 0);
