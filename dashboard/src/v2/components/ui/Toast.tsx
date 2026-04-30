import { h, createContext, ComponentChildren } from "preact";
import { useState, useCallback, useContext } from "preact/hooks";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";

export interface ToastOptions {
  status: ActionFeedbackStatus;
  message: string;
  duration?: number;
}

export interface ToastContextValue {
  toast: (options: ToastOptions) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
}

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<(ToastOptions & { id: string })[]>([]);

  const toast = useCallback((options: ToastOptions) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { ...options, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 min-w-[300px] max-w-sm">
        {toasts.map((t) => (
          <ActionFeedbackRegion
            key={t.id}
            status={t.status}
            message={t.message}
            onDismiss={() => removeToast(t.id)}
            autoDismissMs={t.duration ?? 5000}
            className="shadow-lg"
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
