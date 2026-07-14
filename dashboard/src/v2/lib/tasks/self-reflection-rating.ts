import type {
  TaskSelfReflectionRating,
  TaskSelfReflectionSectionRating,
} from "../../../../../src/contracts/task-self-reflection-types.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateTask } from "../../i18n/messages/tasks.js";

export type SelfReflectionStarState = "filled" | "half" | "empty";

export interface SelfReflectionSectionRatingViewModel {
  label: string;
  normalizedLabel: string;
  rating: number;
  ratingLabel: string;
  ariaLabel: string;
  starStates: SelfReflectionStarState[];
  note: string | null;
}

export interface SelfReflectionRatingViewModel {
  overallRating: number;
  overallRatingLabel: string;
  overallAriaLabel: string;
  overallStarStates: SelfReflectionStarState[];
  sections: SelfReflectionSectionRatingViewModel[];
}

const MAX_RATING = 5;
const STAR_COUNT = 5;

export function normalizeSelfReflectionRating(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(MAX_RATING, Math.max(0, value));
}

export function getSelfReflectionStarStates(value: unknown): SelfReflectionStarState[] {
  const rating = normalizeSelfReflectionRating(value);
  if (rating === null) {
    return Array.from({ length: STAR_COUNT }, () => "empty");
  }

  const nearestHalfRating = Math.round(rating * 2) / 2;

  return Array.from({ length: STAR_COUNT }, (_, index) => {
    const starValue = index + 1;
    if (nearestHalfRating >= starValue) {
      return "filled";
    }
    if (nearestHalfRating >= starValue - 0.5) {
      return "half";
    }
    return "empty";
  });
}

export function formatSelfReflectionRatingValue(value: number, locale: DashboardLocale = "en"): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

export function formatSelfReflectionRatingLabel(value: unknown, locale: DashboardLocale = "en"): string | null {
  const rating = normalizeSelfReflectionRating(value);
  if (rating === null) {
    return null;
  }

  return `${formatSelfReflectionRatingValue(rating, locale)}/5`;
}

export function formatSelfReflectionRatingAriaLabel(value: unknown, locale: DashboardLocale = "en"): string | null {
  const rating = normalizeSelfReflectionRating(value);
  if (rating === null) {
    return null;
  }

  return translateTask(locale, "selfReflectionAria", { rating: formatSelfReflectionRatingValue(rating, locale) });
}

export function sortSelfReflectionSectionRatings(
  sections: readonly TaskSelfReflectionSectionRating[] | null | undefined,
): TaskSelfReflectionSectionRating[] {
  return [...(sections ?? [])].sort((left, right) => {
    const leftKey = getSectionSortKey(left);
    const rightKey = getSectionSortKey(right);
    if (leftKey !== rightKey) {
      return leftKey.localeCompare(rightKey);
    }
    return left.label.localeCompare(right.label, undefined, { sensitivity: "base" });
  });
}

export function buildSelfReflectionRatingViewModel(
  rating: TaskSelfReflectionRating | null | undefined,
  locale: DashboardLocale = "en",
): SelfReflectionRatingViewModel | null {
  if (!rating) {
    return null;
  }

  const overallRating = normalizeSelfReflectionRating(rating.overallRating);
  if (overallRating === null) {
    return null;
  }

  const overallRatingLabel = formatSelfReflectionRatingLabel(overallRating, locale);
  const overallAriaLabel = formatSelfReflectionRatingAriaLabel(overallRating, locale);
  if (!overallRatingLabel || !overallAriaLabel) {
    return null;
  }

  return {
    overallRating,
    overallRatingLabel,
    overallAriaLabel,
    overallStarStates: getSelfReflectionStarStates(overallRating),
    sections: sortSelfReflectionSectionRatings(rating.sections)
      .map((section) => toSectionViewModel(section, locale))
      .filter((section): section is SelfReflectionSectionRatingViewModel => section !== null),
  };
}

function toSectionViewModel(section: TaskSelfReflectionSectionRating, locale: DashboardLocale): SelfReflectionSectionRatingViewModel | null {
  const sectionRating = normalizeSelfReflectionRating(section.rating);
  if (sectionRating === null) {
    return null;
  }

  const ratingLabel = formatSelfReflectionRatingLabel(sectionRating, locale);
  if (!ratingLabel) {
    return null;
  }

  const label = section.label.trim() || section.normalizedLabel.trim() || translateTask(locale, "unlabeledSection");
  const note = section.note?.trim() || null;

  return {
    label,
    normalizedLabel: section.normalizedLabel,
    rating: sectionRating,
    ratingLabel,
    ariaLabel: translateTask(locale, "sectionReflectionAria", { section: label, rating: formatSelfReflectionRatingValue(sectionRating, locale) }),
    starStates: getSelfReflectionStarStates(sectionRating),
    note,
  };
}

function getSectionSortKey(section: TaskSelfReflectionSectionRating): string {
  return (section.normalizedLabel.trim() || section.label.trim()).toLocaleLowerCase();
}
