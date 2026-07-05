import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  darkMode: "class",
  content: ["./dashboard/index.html", "./dashboard/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Warm Void — replaces cold obsidian, warm undertones
        void: {
          950: "#080605",
          900: "#0E0C0A",
          800: "#181411",
          700: "#231F1B",
          600: "#2D2822",
          500: "#3D3730",
        },
        // Signal — theme-specific primary accent for active, focus, and running states
        signal: {
          300: "var(--signal-300)",
          400: "var(--signal-400)",
          500: "var(--signal-500)",
          600: "var(--signal-600)", // Theme-specific for contrast
          700: "var(--signal-700)",
        },
        // Warm Amber — secondary signal, replaces generic indigo as secondary accent
        ember: {
          400: "#FFD080",
          500: "#FFB800",
          600: "var(--ember-600)", // Theme-specific for contrast
        },
        // Semantic status colors
        status: {
          green: "var(--status-green)",
          red: "var(--status-red)",
          amber: "var(--status-amber)",
          violet: "#8A00B5", // Legacy
        },
        // Backwards compat alias for any remaining obsidian refs
        obsidian: {
          900: "#0E0C0A",
          800: "#181411",
          700: "#231F1B",
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "Inter", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
        outfit: ["Outfit", "sans-serif"],
        display: ["Outfit", '"Plus Jakarta Sans"', "sans-serif"],
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "signal-ping": "ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
