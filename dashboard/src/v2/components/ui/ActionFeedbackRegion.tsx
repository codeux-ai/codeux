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
}

const statusConfig: Record<Exclude<ActionFeedbackStatus, "idle">, { icon: FunctionComponent<any>, colors: string, progressColors: string }> = {
  pending: { icon: Loader2, colors: "bg-signal-500/10 text-signal-700 border-signal-500/20 dark:text-signal-400", progressColors: "bg-signal-500" },
  success: { icon: CheckCircle, colors: "bg-status-green/10 text-status-green border-status-green/20", progressColors: "bg-status-green" },
  warning: { icon: AlertTriangle, colors: "bg-status-amber/10 text-status-amber border-status-amber/20", progressColors: "bg-status-amber" },
  error: { icon: XCircle, colors: "bg-status-red/10 text-status-red border-status-red/20", progressColors: "bg-status-red" },
};

export function ActionFeedbackRegion({ status, message, onDismiss, className = "", autoDismissMs = 5000, autoDismiss, retryAction, retryLabel }: ActionFeedbackRegionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const dismissBtnRef = useRef<HTMLButtonElement>(null);
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
              gsap.fromTo(messageRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: durations.fast });
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

  const ariaLive = displayedStatus === "error" ? "assertive" : "polite";

  return (
    <div
      ref={containerRef}
      role={displayedStatus === "error" ? "alert" : "status"}
      aria-live={ariaLive}
      className={`relative overflow-hidden flex items-start gap-3 p-3 rounded-xl border ${config.colors} ${className}`}
    >
      <Icon key={displayedStatus} className={`w-5 h-5 shrink-0 ${displayedStatus === "pending" ? "animate-spin" : ""} motion-safe:animate-[icon-pop_0.18s_ease-out]`} />
      <div className="flex-1 text-sm font-medium mt-0.5 relative">
        <div ref={messageRef}>
          {displayedMessage}
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1">
        {retryAction && (
          <button
            type="button"
            onClick={retryAction}
            aria-label={`Retry: ${displayedMessage}`}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-white/50 dark:bg-black/20 hover:bg-white/80 dark:hover:bg-black/40 border border-black/5 dark:border-white/5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {retryLabel || "Retry"}
          </button>
        )}
        {onDismiss && (
          <button
            ref={dismissBtnRef}
            type="button"
            onClick={() => {
              if (document.activeElement === dismissBtnRef.current) {
                // attempt to restore focus contextually or drop it safely
                const fallback = document.querySelector('[role="main"]') || document.body;
                (fallback as HTMLElement).focus();
                if (document.activeElement === dismissBtnRef.current) {
                    dismissBtnRef.current?.blur();
                }
              }
              onDismiss?.();
            }}
            className="p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label={`Dismiss: ${displayedMessage}`}
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
    </div>
  );
}
