import type { DashboardLocale } from "./locales.js";

export type DashboardDateValue = Date | number;

export interface DashboardFormatters {
  formatNumber: (value: number | bigint, options?: Intl.NumberFormatOptions) => string;
  formatDate: (value: DashboardDateValue, options?: Intl.DateTimeFormatOptions) => string;
  formatTime: (value: DashboardDateValue, options?: Intl.DateTimeFormatOptions) => string;
  formatRelativeTime: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
  formatList: (values: readonly string[], options?: Intl.ListFormatOptions) => string;
}

export const createDashboardFormatters = (locale: DashboardLocale): DashboardFormatters => ({
  formatNumber: (value, options) => new Intl.NumberFormat(locale, options).format(value),
  formatDate: (value, options) => new Intl.DateTimeFormat(locale, options).format(value),
  formatTime: (value, options = { hour: "numeric", minute: "2-digit" }) => (
    new Intl.DateTimeFormat(locale, options).format(value)
  ),
  formatRelativeTime: (value, unit, options) => (
    new Intl.RelativeTimeFormat(locale, options).format(value, unit)
  ),
  formatList: (values, options) => new Intl.ListFormat(locale, options).format(values),
});
