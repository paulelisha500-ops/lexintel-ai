/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_IN_BROWSER_SERVER?: string;
}

/** Short commit id of this build ("dev" for local builds). */
declare const __BUILD_ID__: string;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
