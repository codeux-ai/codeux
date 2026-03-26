export function isAssignableWorkerStatus(status: string | null | undefined): boolean {
  return status !== null && status !== "stale" && status !== "offline";
}
