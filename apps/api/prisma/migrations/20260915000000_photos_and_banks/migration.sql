-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "photo_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "photo_id" UUID;

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_banks" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "swift_bic" TEXT,
    "routing_number" TEXT,
    "country" CHAR(2),
    "currency" CHAR(3),
    "notes" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_banks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_banks_profile_id_idx" ON "profile_banks"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "profiles_photo_id_key" ON "profiles"("photo_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_photo_id_key" ON "users"("photo_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "photos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_banks" ADD CONSTRAINT "profile_banks_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_banks" ADD CONSTRAINT "profile_banks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Uploaded pictures stay small and are only common image types.
ALTER TABLE "photos"
  ADD CONSTRAINT photos_content_type CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT photos_byte_size CHECK (byte_size > 0 AND byte_size <= 409600 AND byte_size = octet_length(data));

ALTER TABLE "profile_banks"
  ADD CONSTRAINT profile_banks_required_present CHECK (
    bank_name ~ '[^[:space:]]' AND account_holder ~ '[^[:space:]]' AND account_number ~ '[^[:space:]]'
  ),
  ADD CONSTRAINT profile_banks_country_format CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT profile_banks_currency_format CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

-- At most one primary bank per profile.
CREATE UNIQUE INDEX profile_banks_one_primary ON "profile_banks"("profile_id") WHERE is_primary;
