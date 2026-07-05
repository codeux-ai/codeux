import { useState, useCallback, useRef, useEffect } from "preact/hooks";

export type ActionFeedbackStatus = "idle" | "pending" | "success" | "warning" | "error";

export interface ActionFeedbackOptions {
  autoDismiss?: boolean;
  retryAction?: () => void | Promise<void>;
  retryLabel?: string;
  progress?: number;
  retryPending?: boolean;
}

export interface ActionFeedbackState extends ActionFeedbackOptions {
  status: ActionFeedbackStatus;
  message: string | null;
}

export function useActionFeedback(autoDismissMs: number = 5000) {
  const [feedback, setFeedback] = useState<ActionFeedbackState>({ status: "idle", message: null });
  const timerRef = useRef<number | null>(null);
  const retryPendingRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const clearFeedback = useCallback((message?: string) => {
    clearTimer();
    retryPendingRef.current = false;
    setFeedback({ status: "idle", message: message || null });
  }, [clearTimer]);

  const wrapOptions = useCallback((options?: ActionFeedbackOptions): ActionFeedbackOptions | undefined => {
    if (!options?.retryAction) {
      return options;
    }

    const sourceRetryAction = options.retryAction;
    return {
      ...options,
      retryPending: false,
      retryAction: async () => {
        if (retryPendingRef.current) {
          return;
        }

        retryPendingRef.current = true;
        setFeedback((prev) => (
          prev.retryAction === undefined
            ? prev
            : { ...prev, retryPending: true }
        ));
        try {
          await sourceRetryAction();
        } finally {
          retryPendingRef.current = false;
          setFeedback((prev) => (
            prev.retryAction === undefined
              ? prev
              : { ...prev, retryPending: false }
          ));
        }
      },
    };
  }, []);

  const setWithTimeout = useCallback((status: ActionFeedbackStatus, message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    retryPendingRef.current = false;
    setFeedback({ status, message, ...wrapOptions(options) });

    if (options?.autoDismiss !== false) {
      timerRef.current = globalThis.setTimeout(() => {
        retryPendingRef.current = false;
        setFeedback({ status: "idle", message: null });
      }, autoDismissMs);
    }
  }, [clearTimer, autoDismissMs, wrapOptions]);

  const setPending = useCallback((message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    retryPendingRef.current = false;
    setFeedback({ status: "pending", message, ...wrapOptions(options) });
  }, [clearTimer, wrapOptions]);

  const setSuccess = useCallback((message: string, options?: ActionFeedbackOptions) => {
    setWithTimeout("success", message, options);
  }, [setWithTimeout]);

  const setWarning = useCallback((message: string, options?: ActionFeedbackOptions) => {
    setWithTimeout("warning", message, options);
  }, [setWithTimeout]);

  const setError = useCallback((message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    retryPendingRef.current = false;
    setFeedback({ status: "error", message, ...wrapOptions(options) });
  }, [clearTimer, wrapOptions]);

  const clearError = useCallback(() => {
    retryPendingRef.current = false;
    setFeedback((prev) => (prev.status === "error" ? { status: "idle", message: null } : prev));
  }, []);

  return {
    feedback,
    setPending,
    setSuccess,
    setWarning,
    setError,
    clearFeedback,
    clearError,
  };
}
