import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  darkMode: "class",
  content: ["./dashboard/index.html", "./dashboard/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          950: "#080605",
          900: "#0E0C0A",
          800: "#181411",
          700: "#231F1B",
          600: "#2D2822",
          500: "#3D3730",
        },
        signal: {
          300: "#80FFD6",
          400: "#33FFB8",
          500: "#00E0A0",
          600: "var(--signal-600)",
          700: "#008F65",
        },
        ember: {
          400: "#FFD080",
          500: "#FFB800",
          600: "var(--ember-600)",
        },
        status: {
          green: "var(--status-green)",
          red: "var(--status-red)",
          amber: "var(--status-amber)",
          violet: "#8A00B5",
        },
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
      keyframes: {
        "form-shake": {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-4px)" },
          "40%": { transform: "translateX(4px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
        "form-slide-down": {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "skeleton-shimmer": {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "signal-ping": "ping 2.5s cubic-bezier(0, 0, 0.2, 1) infinite",
        "form-shake": "form-shake 0.3s cubic-bezier(.36,.07,.19,.97) both",
        "form-slide-down": "form-slide-down 0.2s ease-out both",
        "skeleton-shimmer": "skeleton-shimmer 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
