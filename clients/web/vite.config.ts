import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Linqa web client — dev/build config. Real linqa-core WASM bindings will be
// added as a Vite plugin/asset once the crypto core is buildable.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    fs: { allow: [".."] },
  },
  test: {
    environment: "jsdom",
  },
});
