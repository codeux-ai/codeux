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
        manualChunks: {
          "vendor-preact":  ["preact", "preact/hooks", "preact/compat"],
          "vendor-router":  ["@tanstack/react-router"],
          "vendor-gsap":    ["gsap"],
          "vendor-lucide":  ["lucide-preact"],
        },
      },
    },
  },
});
