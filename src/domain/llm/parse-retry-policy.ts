export function computeNextParseAttempt(
  currentAttempt: number,
  maxAttempts: number
): { shouldRetry: boolean; errorMessage?: string } {
  if (currentAttempt >= maxAttempts) {
    return { shouldRetry: false, errorMessage: `Parse retry limit reached (${maxAttempts}).` };
  }
  return { shouldRetry: true };
}
