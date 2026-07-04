export function formatInvocationRetryAt(
  isoString: string | null | undefined,
  timeZone?: string,
): string | null {
  if (!isoString) {
    return null;
  }
  const date = new Date(isoString);
  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const resolvedTimeZone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
    ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
  }).format(date);
}
