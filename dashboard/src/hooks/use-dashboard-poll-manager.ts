import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export const DEFAULT_POLL_INTERVAL_MS = 30000;
const MAX_BACKOFF_MS = 60000; // 1 minute
const BACKOFF_FACTOR = 1.5;

interface PollOptions {
  intervalMs?: number;
  onPoll: Array<() => Promise<void>>;
  onError?: (error: Error) => void;
  onSuccess?: () => void;
  enabled?: boolean;
}

export interface PollManager {
  refreshNow: () => Promise<void>;
  isPolling: boolean;
  consecutiveFailures: number;
  nextPollInMs: number | null;
}

export const useDashboardPollManager = (options: PollOptions): PollManager => {
  const {
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    onPoll,
    onError,
    onSuccess,
    enabled = true,
  } = options;

  const [isPolling, setIsPolling] = useState(false);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [nextPollInMs, setNextPollInMs] = useState<number | null>(null);
  
  const timerRef = useRef<number | null>(null);
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getBackoffInterval = useCallback((failures: number) => {
    if (failures === 0) return intervalMs;
    const backoff = intervalMs * Math.pow(BACKOFF_FACTOR, failures);
    return Math.min(backoff, MAX_BACKOFF_MS);
  }, [intervalMs]);

  const executePoll = useCallback(async () => {
    if (!enabled) return;
    
    setIsPolling(true);
    clearTimer();

    try {
      const results = await Promise.allSettled(onPollRef.current.map((fn) => fn()));

      const rejections = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (rejections.length > 0) {
        throw rejections[0].reason;
      }

      setConsecutiveFailures(0);
      onSuccess?.();
      
      const nextInterval = intervalMs;
      setNextPollInMs(nextInterval);
      timerRef.current = window.setTimeout(executePoll, nextInterval);
    } catch (err) {
      const newFailures = consecutiveFailures + 1;
      setConsecutiveFailures(newFailures);
      onError?.(err instanceof Error ? err : new Error(String(err)));
      
      const nextInterval = getBackoffInterval(newFailures);
      setNextPollInMs(nextInterval);
      timerRef.current = window.setTimeout(executePoll, nextInterval);
    } finally {
      setIsPolling(false);
    }
  }, [enabled, intervalMs, consecutiveFailures, clearTimer, onSuccess, onError, getBackoffInterval]);

  const refreshNow = useCallback(async () => {
    await executePoll();
  }, [executePoll]);

  useEffect(() => {
    if (enabled) {
      executePoll();
    } else {
      clearTimer();
      setNextPollInMs(null);
    }
    return () => clearTimer();
  }, [enabled]); // Only re-run when enabled state changes

  return {
    refreshNow,
    isPolling,
    consecutiveFailures,
    nextPollInMs,
  };
};
