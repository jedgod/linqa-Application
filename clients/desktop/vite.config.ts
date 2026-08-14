import { defineConfig } from "vite";

// Linqa desktop client — this is the frontend Vite serves to the Tauri
// webview. Real Tauri (@tauri-apps/api) + linqa-core WASM/FFI bindings will
// be added once the core is buildable.
export default defineConfig({
  root: "src",
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
