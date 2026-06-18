import { h, type FunctionComponent } from "preact";
import { useEffect, useRef, useLayoutEffect } from "preact/hooks";
import { AlertTriangle, CheckCircle, Info, XCircle, X } from "lucide-preact";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { GSAP_EASINGS } from "../../lib/motion/constants.js";

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
  onDismiss: (id: string) => void;
  autoDismissMs?: number;
  className?: string;
  isDismissing?: boolean;
}

const icons: Record<ToastType, FunctionComponent<any>> = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const colors: Record<ToastType, string> = {
  success: "bg-status-green/10 text-status-green border-status-green/20",
  error: "bg-status-red/10 text-status-red border-status-red/20",
  warning: "bg-status-amber/10 text-status-amber border-status-amber/20",
  info: "bg-sky-500/10 text-sky-500 border-sky-500/20",
};

export const Toast: FunctionComponent<ToastProps> = ({
  id,
  type,
  message,
  action,
  onDismiss,
  autoDismissMs = 5000,
  className = "",
  isDismissing = false,
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
            // Do not steal focus dynamically
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
    if (!containerRef.current) return;

    if (document.activeElement === dismissButtonRef.current || document.activeElement === actionButtonRef.current) {
      const fallback = document.querySelector('[role="main"]') || document.body;
      (fallback as HTMLElement).focus();
      if (document.activeElement === dismissButtonRef.current || document.activeElement === actionButtonRef.current) {
          (document.activeElement as HTMLElement)?.blur();
      }
    }

    gsap.to(containerRef.current, {
      opacity: 0,
      scale: 0.95,
      y: -10,
      duration: reducedMotion ? 0 : 0.3,
      ease: GSAP_EASINGS.smooth, // smooth exit
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
      ref={containerRef}
      className={`pointer-events-auto flex items-start gap-3 w-full max-w-sm p-4 rounded-xl shadow-lg border backdrop-blur-md bg-white/95 dark:bg-void-900/95 ${colorClass} ${className}`}
    >
      <Icon aria-hidden="true" className="w-5 h-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-relaxed dark:text-slate-200">
          {message}
        </p>
        {action && (
          <button
            ref={actionButtonRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              action.onClick();
              handleDismiss();
            }}
            className="mt-2 text-xs font-bold uppercase tracking-wider underline hover:opacity-80 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        ref={dismissButtonRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          handleDismiss();
        }}
        className="shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label="Dismiss toast"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
