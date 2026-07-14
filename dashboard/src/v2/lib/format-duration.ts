import type { DashboardLocale } from "../i18n/locales.js";

const formatDurationPart = (value: number, unit: "hour" | "minute" | "second", locale: DashboardLocale): string => {
    if (locale === "en") {
        return `${value}${unit === "hour" ? "h" : unit === "minute" ? "m" : "s"}`;
    }
    return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "short" }).format(value);
};

export function formatDuration(totalSeconds: number, locale: DashboardLocale = "en"): string {
    if (totalSeconds <= 0) return "0s";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${formatDurationPart(h, "hour", locale)} ${formatDurationPart(m, "minute", locale)} ${formatDurationPart(s, "second", locale)}`;
    if (m > 0) return `${formatDurationPart(m, "minute", locale)} ${formatDurationPart(s, "second", locale)}`;
    return formatDurationPart(s, "second", locale);
}

export function formatDurationTight(totalSeconds: number, locale: DashboardLocale = "en"): string {
    if (totalSeconds <= 0) return "0s";
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0) return `${formatDurationPart(h, "hour", locale)} ${formatDurationPart(m, "minute", locale)}`;
    if (m > 0) return formatDurationPart(m, "minute", locale);
    return formatDurationPart(s, "second", locale);
}
