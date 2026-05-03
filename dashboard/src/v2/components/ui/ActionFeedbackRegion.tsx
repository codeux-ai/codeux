import { h, type FunctionComponent } from "preact";
import { useRef, useLayoutEffect, useEffect, useState } from "preact/hooks";
import { X, CheckCircle, AlertTriangle, XCircle, Loader2, RotateCcw } from "lucide-preact";
import gsap from "gsap";
import type { ActionFeedbackStatus } from "../../hooks/use-action-feedback.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

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

  const [displayedMessage, setDisplayedMessage] = useState(message);
  const messageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (message !== displayedMessage) {
      if (reducedMotion || !messageRef.current) {
        setDisplayedMessage(message);
      } else {
        const ctx = gsap.context(() => {
          gsap.to(messageRef.current, {
            opacity: 0,
            y: -4,
            duration: 0.15,
            onComplete: () => {
              setDisplayedMessage(message);
              gsap.fromTo(messageRef.current, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.15 });
            }
          });
        });
        return () => ctx.revert();
      }
    }
  }, [message, displayedMessage, reducedMotion]);

  const [isVisible, setIsVisible] = useState(false);
  useLayoutEffect(() => {
    if (status !== "idle" && message) setIsVisible(true);
    else setIsVisible(false);
  }, [status, message]);

  useLayoutEffect(() => {
    if (!isVisible || !containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { y: reducedMotion ? 0 : MODAL_MOTION.feedback.yStart, opacity: 0, scale: reducedMotion ? 1 : MODAL_MOTION.feedback.scaleStart },
        { y: MODAL_MOTION.feedback.yEnd, opacity: 1, scale: MODAL_MOTION.feedback.scaleEnd, duration: reducedMotion ? 0 : MODAL_MOTION.feedback.duration, ease: MODAL_MOTION.feedback.ease }
      );
    });

    return () => ctx.revert();
  }, [isVisible, reducedMotion]);

  useEffect(() => {
    if (status === "idle" || !message || status === "error" || status === "pending" || !progressRef.current) return;
    if (autoDismiss === false || retryAction) return;

    const ctx = gsap.context(() => {
      if (reducedMotion) {
        gsap.set(progressRef.current, { width: "0%" });
      } else {
        gsap.fromTo(
          progressRef.current,
          { width: "100%" },
          { width: "0%", duration: autoDismissMs / 1000, ease: "linear" }
        );
      }
    });

    return () => ctx.revert();
  }, [status, message, autoDismissMs, autoDismiss, retryAction, reducedMotion]);

  if (status === "idle" || !message) return null;

  const config = statusConfig[status];
  const Icon = config.icon;

  const ariaLive = status === "error" ? "assertive" : "polite";

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live={ariaLive}
      className={`relative overflow-hidden flex items-start gap-3 p-3 rounded-xl border ${config.colors} ${className}`}
    >
      <Icon className={`w-5 h-5 shrink-0 ${status === "pending" ? "animate-spin" : ""}`} />
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
                dismissBtnRef.current?.blur();
              }
              onDismiss?.();
            }}
            className="p-1 rounded-md opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {(status === "success" || status === "warning") && autoDismiss !== false && !retryAction && (
        <div
          ref={progressRef}
          className={`absolute bottom-0 left-0 h-1 opacity-20 ${config.progressColors}`}
        />
      )}
    </div>
  );
}
