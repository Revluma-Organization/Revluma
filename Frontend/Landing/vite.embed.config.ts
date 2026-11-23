import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Builds the hero embed for the current homepage into Frontend/landing-hero/.
// The entry keeps a stable name (hero.js) so Frontend/index.html can load it;
// every other asset is content-hashed.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  base: "/landing-hero/",
  publicDir: false,
  build: {
    outDir: "../landing-hero",
    emptyOutDir: true,
    rollupOptions: {
      input: "src/embed.tsx",
      output: {
        entryFileNames: "hero.js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
