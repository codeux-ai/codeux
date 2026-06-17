import { h, createContext, type FunctionComponent, type ComponentChildren } from "preact";
import { useState, useCallback, useMemo, useContext, useEffect } from "preact/hooks";
import { Toast, type ToastProps } from "./Toast.js";

type ToastMessage = Omit<ToastProps, "onDismiss" | "isDismissing">;

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, "id">) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return ctx;
};

export const ToastProvider: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    setToasts((prev) => {
      const newToasts = [...prev, { ...toast, id: Math.random().toString(36).slice(2) }];
      if (newToasts.length > 3) {
        // Trigger exit animation for older toasts instead of abruptly unmounting
        const overflow = newToasts.slice(0, newToasts.length - 3);
        setDismissingIds(dPrev => {
          const dNext = new Set(dPrev);
          overflow.forEach(t => dNext.add(t.id));
          return dNext;
        });
        return newToasts;
      }
      return newToasts;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    setDismissingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const requestDismiss = useCallback((id: string) => {
    setDismissingIds((prev) => new Set(prev).add(id));
  }, []);

  const value = useMemo(() => ({ toasts, addToast, removeToast: requestDismiss }), [toasts, addToast, requestDismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="false" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.filter(t => t.type !== 'error').map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={removeToast}
            isDismissing={dismissingIds.has(toast.id)}
          />
        ))}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="false" className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.filter(t => t.type === 'error').map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={removeToast}
            isDismissing={dismissingIds.has(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
};
