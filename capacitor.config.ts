import type { CapacitorConfig } from '@capacitor/cli';

// AlphaMap mobile companion app — wraps the same Vite build the web app
// ships (webDir: 'dist') behind a thin native shell for iOS/Android.
// `npm run cap:build` (see package.json) builds the web bundle and syncs it
// into the native ios/ and android/ projects; nothing in here changes what
// `npm run build` / `npm run dev` produce for the web deployment.
const config: CapacitorConfig = {
  appId: 'com.alphamap.app',
  appName: 'AlphaMap',
  webDir: 'dist',
};

export default config;
