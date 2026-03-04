export interface WaitOptions<T> {
  /**
   * The action to perform in each polling interval.
   */
  action: () => Promise<T>;
  /**
   * Predicate to check if the result of the action satisfies the wait condition.
   */
  predicate: (result: T) => boolean | Promise<boolean>;
  /**
   * Interval between polling attempts in milliseconds.
   * @default 1000
   */
  intervalMs?: number;
  /**
   * Maximum time to wait in milliseconds.
   * @default 30000
   */
  timeoutMs?: number;
  /**
   * Optional AbortSignal to cancel the polling.
   */
  signal?: AbortSignal;
  /**
   * Optional callback when a timeout occurs.
   */
  onTimeout?: () => void;
  /**
   * Optional description of the wait for error messages.
   */
  description?: string;
}

/**
 * Standardized polling utility that waits until a condition is met or a timeout occurs.
 */
export async function waitUntil<T>(options: WaitOptions<T>): Promise<T> {
  const {
    action,
    predicate,
    intervalMs = 1000,
    timeoutMs = 30000,
    signal,
    onTimeout,
    description = 'condition',
  } = options;

  const startTime = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new Error(`Wait for ${description} aborted`);
    }

    if (Date.now() - startTime > timeoutMs) {
      onTimeout?.();
      throw new Error(`Timeout waiting for ${description} after ${timeoutMs}ms`);
    }

    const result = await action();
    if (await predicate(result)) {
      return result;
    }

    if (signal?.aborted) {
      throw new Error(`Wait for ${description} aborted`);
    }

    // Check if next interval would exceed timeout
    const timeToWait = Math.min(intervalMs, timeoutMs - (Date.now() - startTime));
    if (timeToWait > 0) {
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(resolve, timeToWait);
        signal?.addEventListener('abort', () => {
          clearTimeout(timeoutId);
          reject(new Error(`Wait for ${description} aborted`));
        }, { once: true });
      });
    }
  }
}
