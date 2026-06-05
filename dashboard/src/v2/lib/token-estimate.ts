const TOKENS_PER_CHAR = 1 / 4;
const TOKEN_COUNT_FORMATTER = new Intl.NumberFormat("en-US");

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return TOKEN_COUNT_FORMATTER.format(tokens);
}
