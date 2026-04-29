import { useState, useCallback, useRef, useEffect } from "preact/hooks";

export type ActionFeedbackStatus = "idle" | "pending" | "success" | "warning" | "error";

export interface ActionFeedbackOptions {
  autoDismiss?: boolean;
  retryAction?: () => void;
  retryLabel?: string;
}

export interface ActionFeedbackState extends ActionFeedbackOptions {
  status: ActionFeedbackStatus;
  message: string | null;
}

export function useActionFeedback(autoDismissMs: number = 5000) {
  const [feedback, setFeedback] = useState<ActionFeedbackState>({ status: "idle", message: null });
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return clearTimer;
  }, [clearTimer]);

  const clearFeedback = useCallback((message?: string) => {
    clearTimer();
    setFeedback({ status: "idle", message: message || null });
  }, [clearTimer]);

  const setWithTimeout = useCallback((status: ActionFeedbackStatus, message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    setFeedback({ status, message, ...options });

    if (options?.autoDismiss !== false) {
      timerRef.current = window.setTimeout(() => {
        setFeedback({ status: "idle", message: null });
      }, autoDismissMs);
    }
  }, [clearTimer, autoDismissMs]);

  const setPending = useCallback((message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    setFeedback({ status: "pending", message, ...options });
  }, [clearTimer]);

  const setSuccess = useCallback((message: string, options?: ActionFeedbackOptions) => {
    setWithTimeout("success", message, options);
  }, [setWithTimeout]);

  const setWarning = useCallback((message: string, options?: ActionFeedbackOptions) => {
    setWithTimeout("warning", message, options);
  }, [setWithTimeout]);

  const setError = useCallback((message: string, options?: ActionFeedbackOptions) => {
    clearTimer();
    setFeedback({ status: "error", message, ...options });
  }, [clearTimer]);

  return {
    feedback,
    setPending,
    setSuccess,
    setWarning,
    setError,
    clearFeedback,
  };
}
