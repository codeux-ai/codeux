import { createDashboardFormatters } from "../i18n/formatters.js";
import type { DashboardLocale } from "../i18n/locales.js";

const SPRINT_COMPLETION_PRECISION = 10;

export const clampSprintCompletion = (completion: number): number => {
  if (Number.isNaN(completion) || completion <= 0) {
    return 0;
  }
  if (completion >= 100) {
    return 100;
  }
  return Math.round(completion * SPRINT_COMPLETION_PRECISION) / SPRINT_COMPLETION_PRECISION;
};

export const formatSprintCompletion = (completion: number, locale: DashboardLocale = "en"): string => (
  createDashboardFormatters(locale).formatNumber(clampSprintCompletion(completion) / 100, {
    style: "percent",
    maximumFractionDigits: 1,
  })
);
