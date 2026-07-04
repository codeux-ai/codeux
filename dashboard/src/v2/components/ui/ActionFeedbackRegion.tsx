import { h, type FunctionComponent } from "preact";
import { useRef, useLayoutEffect, useEffect, useState } from "preact/hooks";
import { X, CheckCircle, AlertTriangle, XCircle, Loader2, RotateCcw } from "lucide-preact";
import gsap from "gsap";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { useGsapDurations, GSAP_EASINGS } from "../../lib/motion/constants.js";

interface ActionFeedbackRegionProps {
  status: ActionFeedbackStatus;
  message: string | null;
  onDismiss?: () => void;
  className?: string;
  autoDismissMs?: number;
  autoDismiss?: boolean;
  retryAction?: () => void;
  retryLabel?: string;
  progress?: number;
  clearError?: () => void;
}

const statusConfig: Record<Exclude<ActionFeedbackStatus, "idle">, { icon: FunctionComponent<any>, colors: string, iconSurface: string, progressColors: string }> = {
  pending: { icon: Loader2, colors: "text-signal-700 border-signal-500/20 dark:text-signal-400", iconSurface: "bg-signal-500/10 border-signal-500/20", progressColors: "bg-signal-500" },
  success: { icon: CheckCircle, colors: "text-status-green border-status-green/20", iconSurface: "bg-status-green/10 border-status-green/20", progressColors: "bg-status-green" },
  warning: { icon: AlertTriangle, colors: "text-status-amber border-status-amber/25", iconSurface: "bg-status-amber/10 border-status-amber/25", progressColors: "bg-status-amber" },
  error: { icon: XCircle, colors: "text-status-red border-status-red/25", iconSurface: "bg-status-red/10 border-status-red/25", progressColors: "bg-status-red" },
};

export function ActionFeedbackRegion({ status, message, onDismiss, className = "", autoDismissMs = 5000, autoDismiss, retryAction, retryLabel, progress, clearError }: ActionFeedbackRegionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dismissBtnRef = useRef<HTMLButtonElement>(null);
  const retryRef = useRef<HTMLButtonElement>(null);
  const reducedMotion = useReducedMotion();
  const durations = useGsapDurations();

  const [isOpen, setIsOpen] = useState(false);
  const [isRendered, setIsRendered] = useState(false);
  const [displayedStatus, setDisplayedStatus] = useState<ActionFeedbackStatus>(status);
  const [displayedMessage, setDisplayedMessage] = useState(message);

  const messageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (status !== "idle" && message) {
      setDisplayedStatus(status);
      setIsRendered(true);
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  }, [status, message]);

  useLayoutEffect(() => {
    if (message && status !== "idle" && message !== displayedMessage && isRendered) {
      if (reducedMotion || !messageRef.current) {
        setDisplayedMessage(message);
      } else {
        const ctx = gsap.context(() => {
          gsap.to(messageRef.current, {
            opacity: 0,
            y: -4,
            duration: durations.fast,
            onComplete: () => {
              setDisplayedMessage(message);
              gsap.fromTo(messageRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: durations.fast, ease: GSAP_EASINGS.smooth });
            }
          });
        });
        return () => ctx.revert();
      }
    } else if (message && status !== "idle" && message !== displayedMessage) {
      setDisplayedMessage(message);
    }
  }, [message, displayedMessage, reducedMotion, durations, status, isRendered]);

  useLayoutEffect(() => {
    if (!isRendered || !containerRef.current) return;

    const ctx = gsap.context(() => {
      if (isOpen) {
        gsap.fromTo(
          containerRef.current,
          { y: reducedMotion ? 0 : MODAL_MOTION.feedback.yStart, opacity: 0, scale: reducedMotion ? 1 : MODAL_MOTION.feedback.scaleStart },
          { y: MODAL_MOTION.feedback.yEnd, opacity: 1, scale: MODAL_MOTION.feedback.scaleEnd, duration: reducedMotion ? 0 : MODAL_MOTION.feedback.duration, ease: MODAL_MOTION.feedback.ease }
        );
      } else {
        gsap.to(containerRef.current, {
          y: reducedMotion ? 0 : MODAL_MOTION.feedback.yStart,
          opacity: 0,
          scale: reducedMotion ? 1 : MODAL_MOTION.feedback.scaleStart,
          duration: reducedMotion ? 0 : durations.fast,
          ease: GSAP_EASINGS.smooth,
          onComplete: () => setIsRendered(false)
        });
      }
    });

    return () => ctx.revert();
  }, [isOpen, isRendered, reducedMotion, durations]);

  useLayoutEffect(() => {
    if (displayedStatus === "pending" && barRef.current && progress !== undefined) {
      if (reducedMotion) {
        barRef.current.style.width = `${progress}%`;
      } else {
        gsap.to(barRef.current, {
          width: `${progress}%`,
          duration: 0.35,
          ease: "power3.out",
          overwrite: true
        });
      }
    }
  }, [progress, displayedStatus, reducedMotion]);

  useLayoutEffect(() => {
    if (displayedStatus === "error" && retryRef.current) {
      if (!reducedMotion) {
        gsap.fromTo(retryRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.16, delay: 0.1, ease: 'power2.out' });
      }
    }
  }, [displayedStatus, reducedMotion]);

  useEffect(() => {
    if (!isOpen || displayedStatus === "idle" || !displayedMessage || displayedStatus === "error" || displayedStatus === "pending" || !progressRef.current) return;
    if (autoDismiss === false || retryAction) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      tl.fromTo(
        progressRef.current,
        { width: "100%" },
        { width: "0%", duration: autoDismissMs / 1000, ease: "linear" }
      );
      tl.to(
        containerRef.current,
        {
          y: reducedMotion ? 0 : 8,
          opacity: 0,
          scale: reducedMotion ? 1 : 0.97,
          duration: reducedMotion ? 0 : 0.25,
          ease: "power3.in",
          onComplete: () => onDismiss?.(),
        }
      );
    });

    return () => ctx.revert();
  }, [isOpen, displayedStatus, displayedMessage, autoDismissMs, autoDismiss, retryAction, reducedMotion, durations]);

  if (!isRendered || !displayedMessage) return null;

  const config = statusConfig[displayedStatus === "idle" ? "pending" : displayedStatus];
  const Icon = config.icon;

  const isError = displayedStatus === "error";

  return (
    <div
      ref={containerRef}
      role={isError ? "alert" : "status"}
      aria-live={displayedStatus === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      aria-busy={displayedStatus === "pending" ? "true" : undefined}
      className={`relative flex items-start gap-3 overflow-hidden rounded-2xl border bg-white p-3 shadow-[0_16px_36px_rgba(15,23,42,0.10)] dark:bg-void-800 dark:shadow-[0_16px_36px_rgba(0,0,0,0.34)] ${config.colors} ${className}`}
    >
      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${config.iconSurface}`}>
        <Icon key={displayedStatus} className={`h-4 w-4 ${displayedStatus === "pending" ? "motion-safe:animate-spin" : ""} motion-safe:animate-[icon-pop_0.18s_ease-out] motion-reduce:animate-none`} />
      </div>
      <div className="relative mt-0.5 min-w-0 flex-1 text-sm font-medium">
        <div ref={messageRef} className="break-words leading-relaxed text-slate-700 dark:text-slate-200">
          <span className="sr-only">{displayedStatus}</span>
          {displayedMessage}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        {retryAction && (
          <button
            ref={retryRef}
            type="button"
            onClick={retryAction}
            aria-label={retryLabel || "Retry"}
            className="flex min-h-8 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white/70 px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:bg-black/20 dark:text-slate-200 dark:hover:bg-black/40"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {retryLabel || "Retry"}
          </button>
        )}
        {displayedStatus === "error" && clearError ? (
          <div role="alert" className="ml-auto flex min-h-8 items-center gap-2 rounded-lg border border-status-red/20 bg-status-red/10 px-3 py-1 text-xs font-medium text-status-red">
            Failed
            <button className="rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40" aria-label="Clear error" onClick={clearError}>×</button>
          </div>
        ) : onDismiss && (
          <button
            ref={dismissBtnRef}
            type="button"
            onClick={() => {
              if (document.activeElement === dismissBtnRef.current) {
                // attempt to restore focus contextually or drop it safely
                const fallback = document.body;
                if (fallback !== document.body && fallback.tabIndex < 0) {
                    fallback.tabIndex = -1;
                }
                fallback.focus();
                if (document.activeElement === dismissBtnRef.current) {
                    dismissBtnRef.current?.blur();
                }
              }
              onDismiss?.();
            }}
            className="rounded-lg p-1.5 opacity-70 transition-colors hover:bg-black/5 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {(displayedStatus === "success" || displayedStatus === "warning") && autoDismiss !== false && !retryAction && (
        <div
          ref={progressRef}
          aria-hidden="true"
          className={`absolute bottom-0 left-0 h-1 opacity-20 ${config.progressColors}`}
        />
      )}
      {displayedStatus === "pending" && progress !== undefined && (
        <div
          ref={barRef}
          aria-hidden="true"
          className="absolute bottom-0 left-0 h-1 bg-signal-500 opacity-20"
        />
      )}
    </div>
  );
}
