import type { DashboardLocale } from "../i18n/locales.js";
import { translateChatMessage } from "../i18n/messages/chat.js";

const parseChatTime = (iso: string | null | undefined): Date | null => {
  if (!iso) {
    return null;
  }

  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const toChatTimestampMs = (iso: string | null | undefined, fallback = 0): number => {
  const date = parseChatTime(iso);
  return date ? date.getTime() : fallback;
};

export const formatChatTime = (
  iso: string | null | undefined,
  locale: DashboardLocale = "en",
): string => {
  const date = parseChatTime(iso);
  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
};

export const formatRelativeChatTime = (
  iso: string | null | undefined,
  locale: DashboardLocale = "en",
  nowMs = Date.now(),
): string => {
  if (!iso) {
    return translateChatMessage(locale, "noMessagesYet");
  }

  const timestamp = toChatTimestampMs(iso, Number.NaN);
  if (Number.isNaN(timestamp)) {
    return locale === "de" ? "Gerade eben" : "Just now";
  }

  const diffMs = Math.max(0, nowMs - timestamp);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) {
    return locale === "de" ? `vor ${new Intl.NumberFormat(locale).format(mins)} Min.` : `${mins}m ago`;
  }

  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return locale === "de" ? `vor ${new Intl.NumberFormat(locale).format(hours)} Std.` : `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  return locale === "de" ? `vor ${new Intl.NumberFormat(locale).format(days)} T.` : `${days}d ago`;
};
