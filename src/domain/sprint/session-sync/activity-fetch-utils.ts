export interface ActivityFetchErrorMetadata {
  error: unknown;
  errorName: string;
  errorMessage: string;
}

export interface ActivityFetchTimeoutOptions {
  timeoutMs: number;
  createTimeoutError: () => Error;
}

export interface BoundedOrderedMapOptions<T, R> {
  items: readonly T[];
  concurrency: number;
  mapper: (item: T, index: number) => Promise<R>;
}

export const normalizeActivityFetchError = (error: unknown): ActivityFetchErrorMetadata => {
  if (error instanceof Error) {
    return {
      error,
      errorName: error.name,
      errorMessage: error.message,
    };
  }
  return {
    error,
    errorName: typeof error,
    errorMessage: String(error),
  };
};

/**
 * Runs an activity fetch under a total deadline and aborts the underlying
 * transport when that deadline expires. Callers must use this factory form
 * instead of passing an already-created promise; Promise.race on its own only
 * abandons the result and leaves pagination/retry work running in the
 * background.
 */
export const withAbortableActivityFetchTimeout = async <T>(
  fetch: (signal: AbortSignal) => Promise<T>,
  options: ActivityFetchTimeoutOptions,
): Promise<T> => {
  const controller = new AbortController();
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    return fetch(controller.signal);
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetch(controller.signal),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          const error = options.createTimeoutError();
          controller.abort(error);
          reject(error);
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

export const mapBoundedOrdered = async <T, R>({
  items,
  concurrency,
  mapper,
}: BoundedOrderedMapOptions<T, R>): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;
  const workerCount = Math.max(0, Math.min(Math.floor(concurrency), items.length));

  const worker = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await mapper(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return results;
};
