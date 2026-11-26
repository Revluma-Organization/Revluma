import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

// Builds the hero embed for the current homepage and the /waitlist
// application into Frontend/landing-hero/. Entries keep stable names (hero.js
// for Frontend/index.html, waitlist.js for Frontend/waitlist.html); every other
// asset is content-hashed.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  base: "/landing-hero/",
  publicDir: false,
  build: {
    outDir: "../landing-hero",
    emptyOutDir: true,
    rollupOptions: {
      input: { hero: "src/embed.tsx", waitlist: "src/waitlist/main.tsx" },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
