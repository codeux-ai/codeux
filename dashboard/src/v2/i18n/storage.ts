import {
  DEFAULT_DASHBOARD_LOCALE,
  resolveDashboardLocale,
  type DashboardLocale,
} from "./locales.js";

export const DASHBOARD_LOCALE_STORAGE_KEY = "codeux.dashboard.locale.v1";

export type DashboardLocaleStorage = Pick<Storage, "getItem" | "setItem">;

const getBrowserStorage = (): DashboardLocaleStorage | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const readDashboardLocale = (
  storage?: DashboardLocaleStorage | null,
): DashboardLocale => {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return DEFAULT_DASHBOARD_LOCALE;
  }
  try {
    return resolveDashboardLocale(target.getItem(DASHBOARD_LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_DASHBOARD_LOCALE;
  }
};

export const writeDashboardLocale = (
  locale: DashboardLocale,
  storage?: DashboardLocaleStorage | null,
): boolean => {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) {
    return false;
  }
  try {
    target.setItem(DASHBOARD_LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
};
