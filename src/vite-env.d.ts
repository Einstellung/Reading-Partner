/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set to "1" only by the iOS simulator smoke workflow to build the engine
  // smoke check in place of the app (see src/smoke, src/main.tsx).
  readonly VITE_SMOKE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
