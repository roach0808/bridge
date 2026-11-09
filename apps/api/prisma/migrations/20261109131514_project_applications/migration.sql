-- How many projects a Profile applied for on a platform on one day, entered by
-- the team each day. No row means nobody updated it ("not updated"), never zero.
-- CreateTable
CREATE TABLE "project_applications" (
    "profile_id" UUID NOT NULL,
    "platform_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "applied" INTEGER NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_applications_applied_check" CHECK ("applied" >= 0),

    CONSTRAINT "project_applications_pkey" PRIMARY KEY ("profile_id","platform_id","date")
);

-- CreateIndex
CREATE INDEX "project_applications_date_idx" ON "project_applications"("date");

-- AddForeignKey
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_platform_id_fkey" FOREIGN KEY ("platform_id") REFERENCES "platforms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_applications" ADD CONSTRAINT "project_applications_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
