import { useState, useCallback } from "preact/hooks";

export type ActionFeedbackStatus = "idle" | "pending" | "success" | "warning" | "error";

export interface ActionFeedbackState {
  status: ActionFeedbackStatus;
  message: string | null;
}

export function useActionFeedback() {
  const [feedback, setFeedback] = useState<ActionFeedbackState>({ status: "idle", message: null });

  const setPending = useCallback((message: string) => {
    setFeedback({ status: "pending", message });
  }, []);

  const setSuccess = useCallback((message: string) => {
    setFeedback({ status: "success", message });
  }, []);

  const setWarning = useCallback((message: string) => {
    setFeedback({ status: "warning", message });
  }, []);

  const setError = useCallback((message: string) => {
    setFeedback({ status: "error", message });
  }, []);

  const clearFeedback = useCallback((message?: string) => {
    setFeedback({ status: "idle", message: message || null });
  }, []);

  return {
    feedback,
    setPending,
    setSuccess,
    setWarning,
    setError,
    clearFeedback,
  };
}
