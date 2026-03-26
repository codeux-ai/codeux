import { useCallback, useEffect, useRef } from "preact/hooks";

export const DEFAULT_POLL_INTERVAL_MS = 30000;
const MAX_BACKOFF_MS = 60000;
const BACKOFF_FACTOR = 1.5;

interface PollOptions {
  intervalMs?: number;
  onPoll: Array<() => Promise<void>>;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
  enabled?: boolean;
  shouldSkip?: () => boolean;
}

export interface PollManager {
  refreshNow: () => Promise<void>;
}

export const useDashboardPollManager = (options: PollOptions): PollManager => {
  const {
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    onPoll,
    onError,
    onSuccess,
    enabled = true,
    shouldSkip,
  } = options;

  const timerRef = useRef<number | null>(null);
  const consecutiveFailuresRef = useRef(0);
  const onPollRef = useRef(onPoll);
  const onErrorRef = useRef(onError);
  const onSuccessRef = useRef(onSuccess);
  const enabledRef = useRef(enabled);
  const intervalMsRef = useRef(intervalMs);
  const shouldSkipRef = useRef(shouldSkip);
  const isMountedRef = useRef(true);
  onPollRef.current = onPoll;
  onErrorRef.current = onError;
  onSuccessRef.current = onSuccess;
  enabledRef.current = enabled;
  intervalMsRef.current = intervalMs;
  shouldSkipRef.current = shouldSkip;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getBackoffInterval = useCallback((failures: number) => {
    if (failures === 0) return intervalMsRef.current;
    const backoff = intervalMsRef.current * Math.pow(BACKOFF_FACTOR, failures);
    return Math.min(backoff, MAX_BACKOFF_MS);
  }, []);

  const executePoll = useCallback(async () => {
    if (!enabledRef.current || !isMountedRef.current) return;

    clearTimer();

    if (shouldSkipRef.current?.()) {
      timerRef.current = window.setTimeout(executePoll, intervalMsRef.current);
      return;
    }

    try {
      const results = await Promise.allSettled(onPollRef.current.map((fn) => fn()));
      if (!isMountedRef.current) return;

      const rejections = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (rejections.length > 0) {
        throw rejections[0].reason;
      }

      consecutiveFailuresRef.current = 0;
      onSuccessRef.current?.();

      timerRef.current = window.setTimeout(executePoll, intervalMsRef.current);
    } catch (err) {
      if (!isMountedRef.current) return;
      consecutiveFailuresRef.current += 1;
      onErrorRef.current?.(err instanceof Error ? err : new Error(String(err)));

      const nextInterval = getBackoffInterval(consecutiveFailuresRef.current);
      timerRef.current = window.setTimeout(executePoll, nextInterval);
    }
  }, [clearTimer, getBackoffInterval]);

  useEffect(() => {
    isMountedRef.current = true;
    if (enabled) {
      executePoll();
    } else {
      clearTimer();
    }
    return () => {
      isMountedRef.current = false;
      clearTimer();
    };
  }, [enabled, executePoll, clearTimer]);

  return {
    refreshNow: executePoll,
  };
};
