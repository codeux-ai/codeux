import { h, createContext, ComponentChildren } from "preact";
import { useContext, useState, useCallback, useRef } from "preact/hooks";
import { Toast, ToastProps } from "./Toast.js";

export type AddToastInput = Omit<ToastProps, "id" | "onDismiss">;

interface ToastContextValue {
  addToast: (toast: AddToastInput) => void;
  removeToast: (id: string) => void;
  dismissOldestToast: () => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 3;

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<ToastProps[]>([]);
  const toastsRef = useRef<ToastProps[]>([]);

  // Update the ref whenever toasts change so we can access current state synchronously
  toastsRef.current = toasts;

  const removeToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const dismissOldestToast = useCallback(() => {
    const currentToasts = toastsRef.current;
    if (currentToasts.length >= MAX_TOASTS) {
      // Find the oldest toast (last in the array because we prepend new ones)
      const oldestToast = currentToasts[currentToasts.length - 1];
      if (oldestToast && oldestToast.id) {
         // Fire its dismiss function which triggers the exit animation
         // and eventually calls removeToast
         oldestToast.onDismiss(oldestToast.id);
      }
    }
  }, []);

  const addToast = useCallback((toastInput: AddToastInput) => {
    dismissOldestToast();

    const id = Math.random().toString(36).substring(2, 9);
    setToasts((current) => {
      // Create new toast
      const newToast = { ...toastInput, id, onDismiss: removeToast };
      // Even though we fired dismiss on the oldest, it might still be animating out.
      // We do not slice the array here so it can animate out gracefully.
      return [newToast, ...current];
    });
  }, [removeToast, dismissOldestToast]);

  return (
    <ToastContext.Provider value={{ addToast, removeToast, dismissOldestToast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 pointer-events-none"
      >
        {toasts.map((toast) => (
          <Toast key={toast.id} {...toast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
