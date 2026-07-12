import type { DashboardAccentColor } from "../../types.js";

export interface AccentColorPreset {
  id: DashboardAccentColor;
  label: string;
  description: string;
  lightSwatch: string;
  darkSwatch: string;
}

export const ACCENT_COLOR_PRESETS: readonly AccentColorPreset[] = [
  {
    id: "CODEUX",
    label: "Code UX",
    description: "Ocean blue in light mode, signature jade in dark mode.",
    lightSwatch: "#005eb8",
    darkSwatch: "#00e0a0",
  },
  {
    id: "OCEAN",
    label: "Ocean",
    description: "Clear, confident blue across both themes.",
    lightSwatch: "#2563eb",
    darkSwatch: "#60a5fa",
  },
  {
    id: "VIOLET",
    label: "Violet",
    description: "A polished purple for a more expressive workspace.",
    lightSwatch: "#6d28d9",
    darkSwatch: "#a78bfa",
  },
  {
    id: "CYAN",
    label: "Cyan",
    description: "A crisp blue-green accent distinct from success states.",
    lightSwatch: "#0e7490",
    darkSwatch: "#67e8f9",
  },
  {
    id: "MAGENTA",
    label: "Magenta",
    description: "A vivid creative accent without borrowing error red.",
    lightSwatch: "#a21caf",
    darkSwatch: "#f0abfc",
  },
  {
    id: "GRAPHITE",
    label: "Graphite",
    description: "A restrained neutral accent for a quieter workspace.",
    lightSwatch: "#475569",
    darkSwatch: "#cbd5e1",
  },
] as const;

export const DEFAULT_ACCENT_COLOR: DashboardAccentColor = "CODEUX";

export const isDashboardAccentColor = (value: unknown): value is DashboardAccentColor => (
  typeof value === "string" && ACCENT_COLOR_PRESETS.some((preset) => preset.id === value)
);

export const getAccentColorPreset = (value: unknown): AccentColorPreset => (
  ACCENT_COLOR_PRESETS.find((preset) => preset.id === value) ?? ACCENT_COLOR_PRESETS[0]
);
