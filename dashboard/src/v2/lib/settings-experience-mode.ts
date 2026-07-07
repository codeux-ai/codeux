import type { DashboardExperienceMode } from "../../types.js";
import type { Category, CategoryId } from "../hooks/use-settings-page-state.js";
import {
  DEFAULT_DASHBOARD_EXPERIENCE_MODE,
  normalizeDashboardExperienceMode,
} from "./experience-mode.js";

const EASY_CATEGORY_IDS = new Set<CategoryId>([
  "general",
  "appearance",
  "integrations",
  "danger",
]);

const STANDARD_HIDDEN_CATEGORY_IDS = new Set<CategoryId>([
  "mcp",
]);

export const getSettingsExperienceMode = (
  value: DashboardExperienceMode | null | undefined,
): DashboardExperienceMode => normalizeDashboardExperienceMode(value, DEFAULT_DASHBOARD_EXPERIENCE_MODE);

export const filterSettingsCategoriesByExperienceMode = (
  categories: Category[],
  mode: DashboardExperienceMode | null | undefined,
): Category[] => {
  const normalizedMode = getSettingsExperienceMode(mode);
  if (normalizedMode === "EXPERT") {
    return categories;
  }
  if (normalizedMode === "EASY") {
    return categories.filter((category) => EASY_CATEGORY_IDS.has(category.id));
  }
  return categories.filter((category) => !STANDARD_HIDDEN_CATEGORY_IDS.has(category.id));
};

export const shouldShowExpertSettings = (
  mode: DashboardExperienceMode | null | undefined,
): boolean => getSettingsExperienceMode(mode) === "EXPERT";

export const isEasySettingsExperience = (
  mode: DashboardExperienceMode | null | undefined,
): boolean => getSettingsExperienceMode(mode) === "EASY";
