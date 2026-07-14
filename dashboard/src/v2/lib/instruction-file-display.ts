/** Brand-tinted accent per instruction file, keyed by associated provider. */
import type { DashboardLocale } from "../i18n/index.js";
import { translateDashboardMessage } from "../i18n/index.js";
import { agentsMessages } from "../i18n/messages/agents.js";

const PROVIDER_ACCENT: Record<string, string> = {
  codex: "#10A37F",        // OpenAI green
  "claude-code": "#D97757", // Claude clay
  gemini: "#4796E3",       // Gemini blue
  "qwen-code": "#7C3AED",  // Qwen violet
  github: "#8B95A1",       // GitHub slate
};

const FALLBACK_ACCENT = "#00E0A0"; // signal jade

export const getInstructionAccentHex = (providerId?: string): string =>
  (providerId && PROVIDER_ACCENT[providerId]) || FALLBACK_ACCENT;

export const formatBytes = (bytes: number, locale: DashboardLocale = "en"): string => {
  if (!bytes || bytes <= 0) return translateDashboardMessage(agentsMessages, locale, "empty");
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  if (bytes < 1024 * 1024) {
    return `${new Intl.NumberFormat(locale, { maximumFractionDigits: bytes < 10 * 1024 ? 1 : 0 }).format(bytes / 1024)} KB`;
  }
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
};
