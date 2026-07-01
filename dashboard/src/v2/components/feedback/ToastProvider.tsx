import { h, createContext, type FunctionComponent, type ComponentChildren } from "preact";
import { useState, useCallback, useMemo, useContext, useEffect, useRef, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { Toast, type ToastProps } from "./Toast.js";
import { GSAP_DURATIONS, GSAP_EASINGS } from "../../lib/motion/constants.js";

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
  const toastRefs = useRef<Map<string, HTMLElement>>(new Map());
  const prevPositions = useRef<Map<string, number>>(new Map());
  const reducedMotion = useReducedMotion();

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  const addToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    setToasts((prev) => {
      const newToasts = [...prev, { ...toast, id: Math.random().toString(36).slice(2) }];

      setDismissingIds(dPrev => {
        const activeNonErrorToasts = newToasts.filter(t => t.type !== 'error' && !dPrev.has(t.id));
        if (activeNonErrorToasts.length > 3) {
          const overflow = activeNonErrorToasts.slice(0, activeNonErrorToasts.length - 3);
          const dNext = new Set(dPrev);
          overflow.forEach(t => dNext.add(t.id));
          return dNext;
        }
        return dPrev;
      });

      return newToasts;
    });
  }, []);

  const removeToast = useCallback((id: string) => {
    toastRefs.current.forEach((el, key) => {
      prevPositions.current.set(key, el.getBoundingClientRect().top);
    });

    setToasts((prev) => prev.filter((t) => t.id !== id));
    setDismissingIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    toastRefs.current.forEach((el, id) => {
      if (prevPositions.current.has(id)) {
        const prevTop = prevPositions.current.get(id)!;
        const currentTop = el.getBoundingClientRect().top;
        const delta = prevTop - currentTop;

        if (delta !== 0 && !reducedMotion) {
          gsap.fromTo(el, { y: delta }, { y: 0, duration: GSAP_DURATIONS.base, ease: GSAP_EASINGS.smooth });
        }
      }
    });
    prevPositions.current.clear();
  }, [toasts, reducedMotion]);

  const requestDismiss = useCallback((id: string) => {
    setDismissingIds((prev) => new Set(prev).add(id));
  }, []);

  const value = useMemo(() => ({ toasts, addToast, removeToast: requestDismiss }), [toasts, addToast, requestDismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.filter(t => t.type !== 'error').map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={removeToast}
            isDismissing={dismissingIds.has(toast.id)}
            toastRef={(el) => {
              if (el) toastRefs.current.set(toast.id, el);
              else toastRefs.current.delete(toast.id);
            }}
          />
        ))}
      </div>
      <div className="fixed bottom-4 left-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.filter(t => t.type === 'error').map((toast) => (
          <Toast
            key={toast.id}
            {...toast}
            onDismiss={removeToast}
            isDismissing={dismissingIds.has(toast.id)}
            toastRef={(el) => {
              if (el) toastRefs.current.set(toast.id, el);
              else toastRefs.current.delete(toast.id);
            }}
          />
        ))}
      </div>
      <div role="status" aria-live="polite" className="sr-only">
        {toasts.filter(t => t.type !== 'error').map((toast) => (
          <div key={toast.id}>{toast.message}</div>
        ))}
      </div>
      <div role="alert" aria-live="assertive" className="sr-only">
        {toasts.filter(t => t.type === 'error').map((toast) => (
          <div key={toast.id}>{toast.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
