const TOKENS_PER_CHAR = 1 / 4;
import type { DashboardLocale } from "../i18n/index.js";

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

export function formatTokenCount(tokens: number, locale: DashboardLocale = "en"): string {
  if (tokens >= 1_000_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(tokens / 1_000)}k`;
  return new Intl.NumberFormat(locale).format(tokens);
}
