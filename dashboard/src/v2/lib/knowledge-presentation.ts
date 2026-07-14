import type { KnowledgeDocumentStatus } from "./knowledge-api.js";
import type { DashboardLocale } from "../i18n/locales.js";

export type KnowledgeStatusMessageKey =
  | "statusQueued"
  | "statusEmbedding"
  | "statusError";

export const getKnowledgeStatusMessageKey = (
  status: Exclude<KnowledgeDocumentStatus, "ready">,
): KnowledgeStatusMessageKey => {
  if (status === "error") return "statusError";
  return status === "pending" ? "statusQueued" : "statusEmbedding";
};

export const formatKnowledgeFileSize = (bytes: number, locale: DashboardLocale): string => {
  const normalizedBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const useMegabytes = normalizedBytes >= 1e6;
  const value = useMegabytes ? normalizedBytes / 1e6 : normalizedBytes / 1024;
  return `${new Intl.NumberFormat(locale, {
    minimumFractionDigits: useMegabytes ? 1 : 0,
    maximumFractionDigits: useMegabytes ? 1 : 0,
  }).format(value)} ${useMegabytes ? "MB" : "KB"}`;
};

export const formatKnowledgeDate = (value: string, locale: DashboardLocale): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
};

export const formatKnowledgeProgress = (value: number, locale: DashboardLocale): string => (
  new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(value)
);
