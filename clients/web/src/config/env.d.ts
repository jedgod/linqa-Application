interface ImportMetaEnv {
  readonly VITE_LINQA_RUNTIME_MODE?: "DEMO" | "HYBRID" | "LIVE";
  readonly VITE_LINQA_API_URL?: string;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
