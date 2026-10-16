-- Password managers: saved logins for a Profile (its platforms, its email…)
-- or for a team (accessory platforms the team uses). Seen and kept by the
-- Founders and the team concerned only (§6.17). Passwords are encrypted
-- (AES-256-GCM) like bank passwords.

CREATE TABLE "credentials" (
    "id" UUID NOT NULL,
    "profile_id" UUID,
    "team_id" UUID,
    "nickname" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "login" TEXT,
    "password_enc" TEXT,
    "created_by" UUID NOT NULL,
    "updated_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id"),
    -- A login belongs to a Profile or to a team, never both.
    CONSTRAINT credentials_one_owner CHECK (num_nonnulls(profile_id, team_id) = 1),
    CONSTRAINT credentials_nickname_present CHECK (btrim(nickname) <> ''),
    CONSTRAINT credentials_platform_present CHECK (btrim(platform) <> '')
);

CREATE INDEX "credentials_profile_id_idx" ON "credentials"("profile_id");
CREATE INDEX "credentials_team_id_idx" ON "credentials"("team_id");

ALTER TABLE "credentials" ADD CONSTRAINT "credentials_profile_id_fkey"
  FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_team_id_fkey"
  FOREIGN KEY ("team_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
