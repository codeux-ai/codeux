import { h, type FunctionComponent, type JSX } from "preact";
import { useCallback, useEffect, useRef, useLayoutEffect, useState } from "preact/hooks";
import { AlertTriangle, CheckCircle, Info, XCircle, X } from "lucide-preact";
import gsap from "gsap";
import { GSAP_DURATIONS, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

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
  retryAction?: () => void | Promise<void>;
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
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const dismissingRef = useRef(false);
  const retryPendingRef = useRef(false);
  const retryStatusIdRef = useRef<string | null>(null);
  const autoDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownFrameRef = useRef<number | null>(null);
  const activeStartedAtRef = useRef(0);
  const elapsedBeforePauseRef = useRef(0);
  const pauseReasonsRef = useRef({ pointer: false, focus: false });
  if (retryStatusIdRef.current === null) {
    retryStatusIdRef.current = `toast-retry-status-${Math.random().toString(36).slice(2)}`;
  }
  const [retryPending, setRetryPending] = useState(false);
  const [countdownRatio, setCountdownRatio] = useState(1);
  const [isCountdownPaused, setIsCountdownPaused] = useState(false);
  const reducedMotion = useReducedMotion();
  const motionTokens = useGsapInteractionTokens();
  const cssTokens = useInteractionTokens();
  const Icon = icons[type];
  const colorClass = colors[type];
  const retryText = retryLabel || "Retry";
  const shouldAutoDismiss = autoDismissMs > 0 && type !== "error";

  useLayoutEffect(() => {
    if (!containerRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        containerRef.current,
        { y: reducedMotion ? 0 : 20, opacity: 0, scale: reducedMotion ? 1 : 0.95 },
        {
          y: 0,
          opacity: 1,
          scale: 1,
          duration: motionTokens.asyncFeedback.duration,
          ease: motionTokens.asyncFeedback.ease,
          onComplete: () => {
          }
        }
      );
    });

    return () => ctx.revert();
  }, [motionTokens.asyncFeedback.duration, motionTokens.asyncFeedback.ease, reducedMotion, type]);

  const focusWithoutScroll = (element: HTMLElement) => {
    try {
      element.focus({ preventScroll: true });
    } catch {
      element.focus();
    }
  };

  const moveFocusToFallback = () => {
    const fallback = document.querySelector<HTMLElement>('[data-feedback-focus-fallback], [data-focus-fallback], [role="main"], main, #root') || document.body;
    if (fallback.tabIndex < 0) fallback.tabIndex = -1;
    if (fallback === document.body) {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      return;
    }
    focusWithoutScroll(fallback);
    if (
      document.activeElement === dismissButtonRef.current ||
      document.activeElement === actionButtonRef.current ||
      document.activeElement === retryButtonRef.current
    ) {
      (document.activeElement as HTMLElement).blur();
    }
  };

  const moveFocusToFallbackIfRemoved = (previousActive: Element | null) => {
    queueMicrotask(() => {
      const activeElement = document.activeElement;
      const activeWasRemoved = previousActive instanceof HTMLElement && !previousActive.isConnected;
      const focusWasLost = activeElement === document.body || activeElement === null;
      if (activeWasRemoved || focusWasLost) {
        moveFocusToFallback();
      }
    });
  };

  const clearAutoDismissWork = useCallback(() => {
    if (autoDismissTimerRef.current !== null) {
      clearTimeout(autoDismissTimerRef.current);
      autoDismissTimerRef.current = null;
    }
    if (countdownFrameRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(countdownFrameRef.current);
      }
      countdownFrameRef.current = null;
    }
  }, []);

  const getElapsedMs = useCallback(() => {
    const activeElapsed = autoDismissTimerRef.current === null
      ? 0
      : Math.max(0, Date.now() - activeStartedAtRef.current);
    return Math.min(autoDismissMs, elapsedBeforePauseRef.current + activeElapsed);
  }, [autoDismissMs]);

  const updateCountdownRatio = useCallback(() => {
    if (!shouldAutoDismiss || autoDismissMs <= 0) return;
    const remainingMs = Math.max(0, autoDismissMs - getElapsedMs());
    setCountdownRatio(remainingMs / autoDismissMs);
  }, [autoDismissMs, getElapsedMs, shouldAutoDismiss]);

  const startCountdownFrame = useCallback(() => {
    if (reducedMotion || !shouldAutoDismiss || typeof requestAnimationFrame !== "function") return;

    const tick = () => {
      updateCountdownRatio();
      if (autoDismissTimerRef.current !== null) {
        countdownFrameRef.current = requestAnimationFrame(tick);
      }
    };

    countdownFrameRef.current = requestAnimationFrame(tick);
  }, [reducedMotion, shouldAutoDismiss, updateCountdownRatio]);

  const handleDismiss = useCallback(() => {
    if (dismissingRef.current) return;
    dismissingRef.current = true;
    clearAutoDismissWork();
    const previousActive = document.activeElement;
    if (!containerRef.current) return;

    gsap.to(containerRef.current, {
      x: reducedMotion ? '0%' : '110%',
      opacity: 0,
      duration: motionTokens.enterExit.duration,
      ease: motionTokens.enterExit.ease,
      onComplete: () => {
        onDismiss(id);
        if (previousActive instanceof HTMLElement && containerRef.current?.contains(previousActive)) {
          moveFocusToFallback();
        } else {
          moveFocusToFallbackIfRemoved(previousActive);
        }
      },
    });
  }, [clearAutoDismissWork, id, motionTokens.enterExit.duration, motionTokens.enterExit.ease, onDismiss, reducedMotion]);

  const resumeAutoDismiss = useCallback(() => {
    if (!shouldAutoDismiss || dismissingRef.current) return;
    clearAutoDismissWork();

    const remainingMs = Math.max(0, autoDismissMs - elapsedBeforePauseRef.current);
    setIsCountdownPaused(false);
    setCountdownRatio(autoDismissMs > 0 ? remainingMs / autoDismissMs : 0);

    if (remainingMs <= 0) {
      handleDismiss();
      return;
    }

    activeStartedAtRef.current = Date.now();
    autoDismissTimerRef.current = setTimeout(() => {
      handleDismiss();
    }, remainingMs);
    startCountdownFrame();
  }, [autoDismissMs, clearAutoDismissWork, handleDismiss, shouldAutoDismiss, startCountdownFrame]);

  const pauseAutoDismiss = useCallback((reason: "pointer" | "focus") => {
    pauseReasonsRef.current[reason] = true;
    if (!shouldAutoDismiss || autoDismissTimerRef.current === null) {
      setIsCountdownPaused(shouldAutoDismiss);
      return;
    }

    elapsedBeforePauseRef.current = getElapsedMs();
    clearAutoDismissWork();
    updateCountdownRatio();
    setIsCountdownPaused(true);
  }, [clearAutoDismissWork, getElapsedMs, shouldAutoDismiss, updateCountdownRatio]);

  const releaseAutoDismissPause = useCallback((reason: "pointer" | "focus") => {
    pauseReasonsRef.current[reason] = false;
    if (pauseReasonsRef.current.pointer || pauseReasonsRef.current.focus) return;
    resumeAutoDismiss();
  }, [resumeAutoDismiss]);

  const handleFocusOut = useCallback((event: JSX.TargetedFocusEvent<HTMLDivElement>) => {
    const nextFocusedElement = event.relatedTarget;
    if (nextFocusedElement instanceof Node && event.currentTarget.contains(nextFocusedElement)) {
      return;
    }
    releaseAutoDismissPause("focus");
  }, [releaseAutoDismissPause]);

  const handleRetry = async () => {
    if (!retryAction || retryPending || retryPendingRef.current) {
      return;
    }

    const previousActive = document.activeElement === retryButtonRef.current ? document.activeElement : null;
    retryPendingRef.current = true;
    setRetryPending(true);
    try {
      await retryAction();
    } finally {
      retryPendingRef.current = false;
      setRetryPending(false);
      if (previousActive) moveFocusToFallbackIfRemoved(previousActive);
    }
  };

  useEffect(() => {
    if (isDismissing) {
      handleDismiss();
    }
  }, [isDismissing]);

  useEffect(() => {
    clearAutoDismissWork();
    elapsedBeforePauseRef.current = 0;
    activeStartedAtRef.current = 0;
    pauseReasonsRef.current = { pointer: false, focus: false };
    setIsCountdownPaused(false);
    setCountdownRatio(1);

    if (!shouldAutoDismiss) {
      return clearAutoDismissWork;
    }

    resumeAutoDismiss();
    return clearAutoDismissWork;
  }, [autoDismissMs, clearAutoDismissWork, resumeAutoDismiss, shouldAutoDismiss, type]);

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (toastRef) toastRef(el);
      }}
      data-toast-type={type}
      data-motion-contract="asyncFeedback"
      onPointerEnter={() => pauseAutoDismiss("pointer")}
      onPointerLeave={() => releaseAutoDismissPause("pointer")}
      onFocusCapture={() => pauseAutoDismiss("focus")}
      onBlurCapture={handleFocusOut}
      onFocusIn={() => pauseAutoDismiss("focus")}
      onFocusOut={handleFocusOut}
      className={`pointer-events-auto relative overflow-hidden flex items-start gap-3 w-full max-w-sm p-4 rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] backdrop-blur-md bg-white/95 dark:bg-void-900/95 ${colorClass} ${className}`}
    >
      <Icon aria-hidden="true" className="w-5 h-5 shrink-0 mt-0.5" />
      <span className="sr-only">{type}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-relaxed dark:text-slate-200">
          {message}
        </p>
        {retryAction && (
          <button
            ref={retryButtonRef}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void handleRetry();
            }}
            disabled={retryPending}
            aria-busy={retryPending ? "true" : undefined}
            aria-label={retryText}
            aria-describedby={retryPending ? retryStatusIdRef.current : undefined}
            style={{ transitionDuration: cssTokens.controlFeedback.duration, transitionTimingFunction: cssTokens.controlFeedback.ease }}
            className="mt-2 text-xs font-bold uppercase tracking-wider underline hover:opacity-80 transition-opacity motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded mr-3 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {retryText}
            <span
              id={retryStatusIdRef.current}
              role="status"
              aria-live="polite"
              className="sr-only"
            >
              {retryPending ? `${retryText} in progress.` : ""}
            </span>
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
            style={{ transitionDuration: cssTokens.controlFeedback.duration, transitionTimingFunction: cssTokens.controlFeedback.ease }}
            className="mt-2 text-xs font-bold uppercase tracking-wider underline hover:opacity-80 transition-opacity motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current rounded"
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
        style={{ transitionDuration: cssTokens.controlFeedback.duration, transitionTimingFunction: cssTokens.controlFeedback.ease }}
        className="shrink-0 p-1 rounded-md opacity-70 hover:opacity-100 transition-opacity motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        aria-label="Dismiss toast"
      >
        <X className="w-4 h-4" />
      </button>
      {shouldAutoDismiss && !reducedMotion && (
        <div
          aria-hidden="true"
          data-toast-countdown
          data-paused={isCountdownPaused ? "true" : undefined}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-current/10"
          style={{ transitionDuration: `${GSAP_DURATIONS.fast * 1000}ms`, transitionTimingFunction: motionTokens.controlFeedback.ease }}
        >
          <div
            className="h-full w-full origin-left bg-current/30"
            style={{ transform: `scaleX(${countdownRatio})` }}
          />
        </div>
      )}
    </div>
  );
};
