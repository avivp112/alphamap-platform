-- Migration: app_releases
-- Backs the self-hosted Capacitor "live update" (OTA) mechanism for the
-- AlphaMap mobile app: scripts/release_app_update.ts inserts one row per
-- released web-bundle version, and the app-update-check Edge Function reads
-- the latest row for the requesting channel to answer the @capgo/
-- capacitor-updater plugin's update-check calls (see capacitor.config.ts's
-- CapacitorUpdater.updateUrl).
--
-- platform is nullable: a release with platform = NULL applies to every
-- platform; a non-null value ('android'/'ios') lets a future release target
-- just one, once the app and web designs actually diverge per-platform.
-- channel supports a simple beta/production split (or more later) without a
-- schema change — defaults to 'production' so existing installs (which send
-- no defaultChannel override) always resolve to it.

CREATE TABLE app_releases (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  version     text        NOT NULL,
  platform    text        CHECK (platform IN ('android', 'ios')),
  channel     text        NOT NULL DEFAULT 'production',
  bundle_url  text        NOT NULL,
  checksum    text        NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),

  -- One row per (version, platform, channel) — release the same version
  -- twice for the same slice and this catches it instead of silently
  -- duplicating.
  CONSTRAINT uq_app_releases_version_platform_channel UNIQUE (version, platform, channel)
);

-- app-update-check's hot path: "latest release for this channel (and this
-- platform, or a universal one)".
CREATE INDEX idx_app_releases_channel_created
  ON app_releases(channel, created_at DESC);

-- RLS: anyone can read (this is the same metadata every installed app
-- already receives from the update-check endpoint); only service_role
-- (release_app_update.ts, run with the service-role key) can write.
ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_releases_public_read"
  ON app_releases FOR SELECT
  USING (true);

CREATE POLICY "app_releases_service_write"
  ON app_releases FOR ALL
  USING (auth.role() = 'service_role');

-- ── Storage: where the actual bundle .zip files live ────────────────────────
-- Public bucket: a device downloading its update doesn't authenticate, it
-- just GETs the bundle_url returned by app-update-check, so the objects
-- need to be reachable via Storage's public URL route.
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-bundles', 'app-bundles', true)
ON CONFLICT (id) DO NOTHING;

-- Belt-and-suspenders alongside the bucket's own "public" flag (which
-- already makes GETs work via the /object/public/ route regardless of
-- these) and alongside service_role's blanket RLS bypass (which already
-- makes writes work regardless of these) — explicit either way, matching
-- this repo's existing public-read/service-write pattern.
CREATE POLICY "app_bundles_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'app-bundles');

CREATE POLICY "app_bundles_service_write"
  ON storage.objects FOR ALL
  USING (bucket_id = 'app-bundles' AND auth.role() = 'service_role');
