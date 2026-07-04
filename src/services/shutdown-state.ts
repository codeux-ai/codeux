let runtimeShutdownInProgress = false;

export function beginRuntimeShutdown(): void {
  runtimeShutdownInProgress = true;
}

export function isRuntimeShutdownInProgress(): boolean {
  return runtimeShutdownInProgress;
}

export function resetRuntimeShutdownForTests(): void {
  runtimeShutdownInProgress = false;
}
