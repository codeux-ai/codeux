/** Brand-tinted accent per instruction file, keyed by associated provider. */
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

export const formatBytes = (bytes: number): string => {
  if (!bytes || bytes <= 0) return "Empty";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
