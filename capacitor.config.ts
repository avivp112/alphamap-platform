import type { CapacitorConfig } from '@capacitor/cli';

// AlphaMap mobile companion app — wraps the same Vite build the web app
// ships (webDir: 'dist') behind a thin native shell for iOS/Android.
// `npm run cap:build` (see package.json) builds the web bundle and syncs it
// into the native ios/ and android/ projects; nothing in here changes what
// `npm run build` / `npm run dev` produce for the web deployment.

// Self-hosted OTA "live update" endpoint (see supabase/functions/
// app-update-check + scripts/release_app_update.ts) — read from the same
// VITE_SUPABASE_URL the web build already requires, rather than a
// hardcoded value, since this file is evaluated by the Capacitor CLI (not
// bundled by Vite, so import.meta.env isn't available here). It needs to be
// set in whatever environment runs `npx cap sync` (locally or in CI).
const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '');
const updateUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/app-update-check` : undefined;

const config: CapacitorConfig = {
  appId: 'com.alphamap.app',
  appName: 'AlphaMap',
  webDir: 'dist',
  plugins: {
    CapacitorUpdater: {
      updateUrl,
      // Entirely self-hosted — never call Capgo's own cloud service.
      statsUrl: '',
      // If VITE_SUPABASE_URL wasn't set for this `cap sync`, disable
      // update checks outright rather than silently falling back to
      // @capgo/capacitor-updater's default cloud updateUrl.
      autoUpdate: updateUrl ? 'atBackground' : 'off',
    },
  },
};

export default config;
