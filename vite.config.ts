import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: "dashboard",
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/preact") || id.includes("node_modules/react")) {
            return "vendor-preact";
          }
          if (id.includes("@tanstack/react-router")) {
            return "vendor-router";
          }
          if (id.includes("node_modules/gsap")) {
            return "vendor-gsap";
          }
          if (id.includes("lucide-preact")) {
            return "vendor-lucide";
          }
        },
      },
    },
  },
});
