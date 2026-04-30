export function getUserFriendlyErrorMessage(
  error: unknown,
  fallbackMessage: string = "An unexpected error occurred"
): string {
  if (typeof error === "string") {
    if (error.includes("{") || error.includes("[")) {
      return fallbackMessage;
    }
    return error;
  }

  if (error instanceof Error) {
    if (error.message.includes("{") || error.message.includes("[")) {
      return fallbackMessage;
    }
    return error.message;
  }

  return fallbackMessage;
}
