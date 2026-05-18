import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { X, CheckCircle, AlertTriangle, XCircle, Info, RotateCcw } from "lucide-preact";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapDurations } from "../../lib/motion/constants.js";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  id: string;
  type: ToastType;
  message: string;
  onDismiss: (id: string) => void;
  action?: { label: string; onClick: () => void };
  autoDismissMs?: number;
}

const TYPE_CONFIG = {
  success: { icon: CheckCircle, colors: "bg-white dark:bg-void-800 text-status-green border-status-green/20" },
  error: { icon: XCircle, colors: "bg-white dark:bg-void-800 text-status-red border-status-red/20" },
  warning: { icon: AlertTriangle, colors: "bg-white dark:bg-void-800 text-status-amber border-status-amber/20" },
  info: { icon: Info, colors: "bg-white dark:bg-void-800 text-signal-600 border-signal-500/20" },
};

export function Toast({ id, type, message, onDismiss, action, autoDismissMs = 5000 }: ToastProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const durations = useGsapDurations();
  const [isExiting, setIsExiting] = useState(false);
  const dismissTimerRef = useRef<number | null>(null);

  const startTimer = () => {
    if (autoDismissMs && !action && !isExiting) {
      dismissTimerRef.current = window.setTimeout(() => {
        handleDismiss();
      }, autoDismissMs);
    }
  };

  const clearTimer = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, []);

  useEffect(() => {
    if (!containerRef.current || isExiting) return;

    if (reducedMotion) {
      gsap.set(containerRef.current, { opacity: 1, y: 0, duration: 0 });
    } else {
      gsap.fromTo(
        containerRef.current,
        { opacity: 0, y: 20, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: durations.base,
          ease: "cubic-bezier(0.22, 1, 0.36, 1)"
        }
      );
    }
  }, [reducedMotion, durations, isExiting]);

  const handleDismiss = () => {
    if (isExiting || !containerRef.current) return;
    setIsExiting(true);
    clearTimer();

    if (reducedMotion) {
      gsap.to(containerRef.current, {
        opacity: 0,
        duration: 0,
        onComplete: () => onDismiss(id)
      });
    } else {
      gsap.to(containerRef.current, {
        opacity: 0,
        y: -10,
        scale: 0.95,
        duration: durations.fast,
        ease: "cubic-bezier(0.32, 0, 0.67, 0)",
        onComplete: () => onDismiss(id)
      });
    }
  };

  const handleAction = () => {
    if (action) action.onClick();
    handleDismiss();
  };

  const config = TYPE_CONFIG[type];
  const Icon = config.icon;
  const isAlert = type === "error" || type === "warning";

  return (
    <div
      ref={containerRef}
      role={isAlert ? "alert" : "status"}
      aria-live={isAlert ? "assertive" : "polite"}
      className={`pointer-events-auto flex items-center gap-3 rounded-xl border p-3 pr-2 shadow-[0_8px_30px_rgb(0,0,0,0.12)] ${config.colors}`}
      onMouseEnter={clearTimer}
      onMouseLeave={startTimer}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <p className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">
        {message}
      </p>

      <div className="flex shrink-0 items-center gap-1 pl-2">
        {action && (
          <button
            onClick={handleAction}
            className="flex items-center gap-1.5 rounded-md border border-black/5 dark:border-white/5 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 dark:bg-void-700 dark:text-slate-200 dark:hover:bg-void-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 touch-target"
          >
            {action.label === 'Retry' && <RotateCcw className="h-3.5 w-3.5" />}
            {action.label}
          </button>
        )}

        <button
          onClick={handleDismiss}
          className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-void-700 dark:hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 touch-target"
          aria-label="Dismiss message"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
