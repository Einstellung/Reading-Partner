/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set to "1" only by the iOS simulator smoke workflow to build the engine
  // smoke check in place of the app (see src/smoke, src/main.tsx).
  readonly VITE_SMOKE?: string;
  // "play" only for a Google Play build; the GitHub APK leaves it unset and
  // counts as "direct" (src/platform/license/config.ts, docs/platform/713).
  readonly VITE_ANDROID_DISTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
