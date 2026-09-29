/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_IN_BROWSER_SERVER?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
