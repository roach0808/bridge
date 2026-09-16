-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "browser" TEXT,
ADD COLUMN     "country" CHAR(2),
ADD COLUMN     "device_type" TEXT,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "last_used_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "os" TEXT;

