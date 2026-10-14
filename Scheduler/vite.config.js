import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  // Run `npm run mock` alongside `npm run dev`: /calls goes to the mock backend.
  server: { proxy: { "/calls": "http://127.0.0.1:8787" } },
  test: { environment: "jsdom", include: ["tests/**/*.test.js"] },
});
