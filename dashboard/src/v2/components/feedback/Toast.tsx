import { h, type FunctionComponent } from "preact";
import { useEffect, useRef, useLayoutEffect } from "preact/hooks";
import { AlertTriangle, CheckCircle, Info, XCircle, X } from "lucide-preact";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { GSAP_EASINGS, GSAP_DURATIONS } from "../../lib/motion/constants.js";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  action?: ToastAction;
  retryAction?: () => void;
  retryLabel?: string;
  onDismiss: (id: string) => void;
  autoDismissMs?: number;
  className?: string;
  isDismissing?: boolean;
  toastRef?: (el: HTMLDivElement | null) => void;
}

const icons: Record<ToastType, FunctionComponent<any>> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors: Record<ToastType, string> = {
  success: "text-status-green border-status-green/20",
  error: "text-status-red border-status-red/25",
  warning: "text-status-amber border-status-amber/25",
  info: "text-signal-700 dark:text-signal-300 border-signal-500/20",
};

const iconSurfaces: Record<ToastType, string> = {
  success: "bg-status-green/10 border-status-green/20",
  error: "bg-status-red/10 border-status-red/25",
  warning: "bg-status-amber/10 border-status-amber/25",
  info: "bg-signal-500/10 border-signal-500/20",
};

export const Toast: FunctionComponent<ToastProps> = ({
  id,
  type,
  message,
  action,
  retryAction,
  retryLabel,
  onDismiss,
  autoDismissMs = 5000,
  className = "",
  isDismissing = false,
  toastRef,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const actionButtonRef = useRef<HTMLButtonElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const Icon = icons[type];
  const colorClass = colors[type];

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { y: 20, opacity: 0, scale: 0.95 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: reducedMotion ? 0 : 0.4,
          ease: GSAP_EASINGS.smooth, // smooth easing curve
          onComplete: () => {
          }
        }
      );
    });

    return () => ctx.revert();
  }, [reducedMotion, type]);

  useEffect(() => {
    if (autoDismissMs === 0 || type === "error") return; // errors may require manual dismissal or action

    const timer = setTimeout(() => {
      handleDismiss();
    }, autoDismissMs);

    return () => clearTimeout(timer);
  }, [autoDismissMs, type]);

  const handleDismiss = () => {
    if (document.activeElement === dismissButtonRef.current || document.activeElement === actionButtonRef.current) {
      const fallback = document.body;
      if (fallback !== document.body && fallback.tabIndex < 0) fallback.tabIndex = -1;
      fallback.focus();
      if (document.activeElement === dismissButtonRef.current || document.activeElement === actionButtonRef.current) {
          (document.activeElement as HTMLElement).blur();
      }
    }
    if (!containerRef.current) return;

    gsap.to(containerRef.current, {
      x: '110%',
      opacity: 0,
      duration: GSAP_DURATIONS.base,
      ease: 'power2.in',
      onComplete: () => onDismiss(id),
    });
  };

  useEffect(() => {
    if (isDismissing) {
      handleDismiss();
    }
  }, [isDismissing]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (toastRef) toastRef(el);
      }}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 overflow-hidden rounded-2xl border bg-white/95 p-3 shadow-[0_16px_36px_rgba(15,23,42,0.14)] backdrop-blur-md dark:bg-void-800/95 dark:shadow-[0_16px_36px_rgba(0,0,0,0.4)] sm:p-4 ${colorClass} ${className}`}
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${iconSurfaces[type]}`}>
        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      </div>
      <span className="sr-only">{type}</span>
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-200">
          {message}
        </p>
        {(retryAction || action) && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {retryAction && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  retryAction();
                  handleDismiss();
                }}
                className="inline-flex min-h-8 max-w-full items-center rounded-lg border border-current/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <span className="truncate">{retryLabel || "Retry"}</span>
              </button>
            )}
            {action && (
              <button
                ref={actionButtonRef}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  action.onClick();
                  handleDismiss();
                }}
                className="inline-flex min-h-8 max-w-full items-center rounded-lg border border-current/20 px-2.5 py-1 text-xs font-bold uppercase tracking-wider transition-colors hover:bg-current/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <span className="truncate">{action.label}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <button
        ref={dismissButtonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          handleDismiss();
        }}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg opacity-70 transition-colors hover:bg-black/[0.05] hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current dark:hover:bg-white/[0.06]"
        aria-label="Dismiss toast"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
