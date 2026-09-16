-- CreateEnum
CREATE TYPE "DbDumpTrigger" AS ENUM ('scheduled', 'manual');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "gpt_link" TEXT,
ADD COLUMN     "rate_override" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "profile_platform_statuses" ALTER COLUMN "rate" DROP NOT NULL,
ALTER COLUMN "rate" DROP DEFAULT;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "db_dumps" (
    "id" UUID NOT NULL,
    "trigger" "DbDumpTrigger" NOT NULL DEFAULT 'scheduled',
    "succeeded" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "byte_size" INTEGER NOT NULL,
    "table_counts" JSONB NOT NULL,
    "data" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "db_dumps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "db_dumps_created_at_idx" ON "db_dumps"("created_at");


-- Check constraints (hand-written)
ALTER TABLE "profile_platform_statuses" ADD CONSTRAINT "profile_platform_statuses_rate_when_registered" CHECK ("status" <> 'registered' OR "rate" IS NOT NULL);
ALTER TABLE "calls" ADD CONSTRAINT "calls_rate_override_nonnegative" CHECK ("rate_override" IS NULL OR "rate_override" >= 0);
