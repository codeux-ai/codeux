import type { DashboardExperienceMode } from "../../types.js";

export interface DashboardExperienceModeOption {
  value: DashboardExperienceMode;
  label: string;
  description: string;
}

export const DEFAULT_DASHBOARD_EXPERIENCE_MODE: DashboardExperienceMode = "EXPERT";

export const dashboardExperienceModeOptions: DashboardExperienceModeOption[] = [
  {
    value: "EASY",
    label: "Easy",
    description: "Simplified dashboard language and fewer advanced controls.",
  },
  {
    value: "STANDARD",
    label: "Standard",
    description: "Balanced dashboard controls for regular project operation.",
  },
  {
    value: "EXPERT",
    label: "Expert",
    description: "Full operational detail and advanced controls.",
  },
];

const DASHBOARD_EXPERIENCE_MODE_SET = new Set<DashboardExperienceMode>(
  dashboardExperienceModeOptions.map((option) => option.value),
);

export const normalizeDashboardExperienceMode = (
  value: unknown,
  fallback: DashboardExperienceMode = DEFAULT_DASHBOARD_EXPERIENCE_MODE,
): DashboardExperienceMode => (
  typeof value === "string" && DASHBOARD_EXPERIENCE_MODE_SET.has(value as DashboardExperienceMode)
    ? value as DashboardExperienceMode
    : fallback
);

export const getDashboardExperienceModeLabel = (mode: DashboardExperienceMode): string => (
  dashboardExperienceModeOptions.find((option) => option.value === mode)?.label ?? "Expert"
);

export const getDashboardExperienceModeDescription = (mode: DashboardExperienceMode): string => (
  dashboardExperienceModeOptions.find((option) => option.value === mode)?.description ?? dashboardExperienceModeOptions[2].description
);

export const isEasyExperienceMode = (mode: DashboardExperienceMode | null | undefined): boolean => mode === "EASY";
export const isStandardExperienceMode = (mode: DashboardExperienceMode | null | undefined): boolean => mode === "STANDARD";
export const isExpertExperienceMode = (mode: DashboardExperienceMode | null | undefined): boolean => mode === "EXPERT";
