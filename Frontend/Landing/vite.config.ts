/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { host: "0.0.0.0", port: 5180, allowedHosts: true },
  preview: { host: "0.0.0.0", port: 5180, allowedHosts: true },
  test: { globals: true, environment: "jsdom", setupFiles: ["./src/test/setup.ts"], css: false },
});
