import { h } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useCallback } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { GSAP_INTERACTION_TOKENS, useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

import { Loader2, AlertTriangle, CheckCircle2, CircleAlert, Info, XCircle } from "lucide-preact";
import { Overlay } from "./Overlay.js";

type DestructiveConfirmState = "idle" | "holding" | "cancelled" | "complete";

function tokenSecondsToMs(seconds: number): number {
  return seconds * 1000;
}

function DestructiveConfirmButton({
  onConfirm,
  label,
  className,
  isLoading
}: {
  onConfirm: () => void;
  label: string;
  className?: string;
  isLoading?: boolean;
}) {
  const [confirmState, setConfirmState] = useState<DestructiveConfirmState>("idle");
  const [progress, setProgress] = useState(0);
  const reducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const cssTokens = useInteractionTokens();
  const progressId = "destructive-confirm-progress";
  const progressBarId = "destructive-confirm-progressbar";

  const holdDuration = 1000;
  const holdTimerRef = useRef<number | null>(null);
  const cancelResetTimerRef = useRef<number | null>(null);
  const holdButtonRef = useRef<HTMLButtonElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (cancelResetTimerRef.current !== null) {
      window.clearTimeout(cancelResetTimerRef.current);
      cancelResetTimerRef.current = null;
    }
  }, []);

  const startHold = () => {
    if (confirmState === "holding" || isLoading) return;
    clearTimers();
    setConfirmState("holding");
    setProgress(0);
    if (barRef.current) {
      gsap.killTweensOf(barRef.current);
      barRef.current.style.width = '0%';
    }
    startTimeRef.current = performance.now();

    const updateProgress = (currentTime: number) => {
      if (!startTimeRef.current) return;

      const elapsed = currentTime - startTimeRef.current;
      const newProgress = Math.min(100, (elapsed / holdDuration) * 100);

      setProgress(newProgress);
      if (barRef.current) {
        if (reducedMotion) {
          barRef.current.style.width = `${newProgress}%`;
        } else {
          gsap.to(barRef.current, {
            width: `${newProgress}%`,
            duration: gsapTokens.controlFeedback.duration,
            ease: gsapTokens.controlFeedback.ease,
            overwrite: true,
          });
        }
      }

      if (elapsed < holdDuration) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    holdTimerRef.current = window.setTimeout(() => {
      setConfirmState("complete");
      setProgress(100);
      if (barRef.current) {
        barRef.current.style.width = '100%';
      }
      onConfirm();
    }, holdDuration);
  };

  const cancelHold = () => {
    clearTimers();
    if (confirmState === "holding") {
      setConfirmState("cancelled");
      if (!reducedMotion && holdButtonRef.current) {
        gsap.fromTo(
          holdButtonRef.current,
          { x: -4 },
          { x: 0, duration: gsapTokens.inlineValidation.duration, ease: gsapTokens.inlineValidation.ease }
        );
      }
      const resetDelay = tokenSecondsToMs(gsapTokens.controlFeedback.duration || GSAP_INTERACTION_TOKENS.controlFeedback.duration);
      if (resetDelay === 0) {
        setConfirmState("idle");
      } else {
        cancelResetTimerRef.current = window.setTimeout(() => {
          setConfirmState("idle");
          cancelResetTimerRef.current = null;
        }, resetDelay);
      }
    } else if (confirmState !== "complete") {
      setConfirmState("idle");
    }
    setProgress(0);
    if (barRef.current) {
      gsap.killTweensOf(barRef.current);
      barRef.current.style.width = '0%';
    }
    startTimeRef.current = null;
  };

  const handlePointerDown = (e: h.JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    startHold();
  };

  const handlePointerUp = (e: h.JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    cancelHold();
  };

  const handleKeyDown = (e: h.JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startHold();
    }
  };

  const handleKeyUp = (e: h.JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cancelHold();
    }
  };

  const handlePointerLeave = () => {
    cancelHold();
  };

  const handlePointerCancel = () => {
    cancelHold();
  };

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  return (
    <button
      ref={holdButtonRef}
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative overflow-hidden ${className}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none', transitionDuration: cssTokens.controlFeedback.duration, transitionTimingFunction: cssTokens.controlFeedback.ease }}
      aria-busy={isLoading ? "true" : undefined}
      disabled={isLoading}
      aria-label={isLoading ? `Completing ${label}` : `Hold to ${label}`}
      aria-describedby={progressId}
    >
      {(confirmState === "holding" || confirmState === "complete") && (
        <div
          ref={barRef}
          id={progressBarId}
          role="progressbar"
          aria-label="Hold confirmation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          className="absolute inset-0 bg-black/20 dark:bg-white/20 origin-left"
          style={{ width: "0%" }}
        />
      )}

      <span className="relative z-10 flex items-center justify-center gap-2">
        {isLoading && <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span className="sr-only">Processing, please wait</span></>}
        {isLoading ? "Completing..." : confirmState === "complete" ? "Confirmed" : confirmState === "cancelled" ? "Release canceled" : confirmState === "holding" ? `Hold to ${label}` : label}
        {confirmState === "holding" && (
          <span aria-hidden="true" className="tabular-nums opacity-85">
            {Math.round(progress)}%
          </span>
        )}
      </span>
      <span id={progressId} className="sr-only">
        {confirmState === "holding"
          ? "Keep holding until progress completes. Release before completion to cancel."
          : confirmState === "cancelled"
            ? "Confirmation canceled. Hold again to confirm."
            : confirmState === "complete"
              ? "Confirmation completed."
              : "Hold until complete. Release before completion to cancel."}
      </span>
    </button>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, options, onConfirm, onCancel }: ConfirmDialogProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmFlash, setConfirmFlash] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(shouldRender && !isClosing, { onClose: () => handleClose(onCancel), restoreFocus: true });
  const reducedMotion = useReducedMotion();
  const gsapTokens = useGsapInteractionTokens();
  const cssTokens = useInteractionTokens();
  const controlTransitionStyle = {
    transitionDuration: cssTokens.controlFeedback.duration,
    transitionTimingFunction: cssTokens.controlFeedback.ease,
  };

  useEffect(() => {
    if (isOpen) {
      setShouldRender(true);
      setIsClosing(false);
    } else if (shouldRender) {
      setIsClosing(true);
    }
  }, [isOpen, shouldRender]);

  useLayoutEffect(() => {
    if (shouldRender && !isClosing) {
      const d_card = reducedMotion ? 0 : gsapTokens.enterExit.duration;

      if (cardRef.current) {
        gsap.fromTo(cardRef.current,
          { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
          { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: gsapTokens.enterExit.ease }
        );
      }
    }
  }, [shouldRender, isClosing, reducedMotion, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

  const handleClose = async (callback: () => void | Promise<void>) => {
    if (isClosing || isProcessing) return;

    setIsProcessing(true);
    try {
      await callback();
      if (callback === onConfirm) {
        setConfirmFlash(true);
      }
    } finally {
      setIsProcessing(false);
      setIsClosing(true);
    }
  };

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : gsapTokens.enterExit.duration;

      const onExitComplete = () => {
        setShouldRender(false);
        setIsClosing(false);
      };

      if (cardRef.current) {
        gsap.to(cardRef.current, {
          y: MODAL_MOTION.exit.yEnd,
          opacity: MODAL_MOTION.exit.opacityEnd,
          scale: MODAL_MOTION.exit.scaleEnd,
          filter: MODAL_MOTION.exit.filterEnd,
          duration: d,
          ease: gsapTokens.enterExit.ease,
          onComplete: onExitComplete
        });
      } else {
        onExitComplete();
      }
    }
  }, [isClosing, reducedMotion, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

  if (!shouldRender || !options) return null;

  const { title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = options;
  const tone = destructive ? "danger" : options.tone || "default";
  const toneStyles = {
    default: {
      icon: Info,
      ring: "border-signal-500/20 bg-signal-500/10 text-signal-600 dark:text-signal-400",
      panel: "bg-signal-500/[0.06] border-signal-500/15 dark:bg-signal-500/[0.10]",
      confirm: "bg-signal-500 text-white hover:bg-signal-600 dark:hover:bg-signal-400 shadow-[0_10px_22px_rgba(0,224,160,0.22)]",
    },
    success: {
      icon: CheckCircle2,
      ring: "border-status-green/20 bg-status-green/10 text-status-green",
      panel: "bg-status-green/[0.07] border-status-green/15 dark:bg-status-green/[0.11]",
      confirm: "bg-status-green text-white hover:brightness-95 shadow-[0_10px_22px_rgba(0,171,132,0.22)]",
    },
    warning: {
      icon: CircleAlert,
      ring: "border-status-amber/20 bg-status-amber/10 text-status-amber",
      panel: "bg-status-amber/[0.08] border-status-amber/16 dark:bg-status-amber/[0.12]",
      confirm: "bg-status-amber text-white hover:brightness-95 shadow-[0_10px_22px_rgba(245,158,11,0.22)]",
    },
    danger: {
      icon: AlertTriangle,
      ring: "border-status-red/20 bg-status-red/10 text-status-red",
      panel: "bg-status-red/[0.08] border-status-red/18 dark:bg-status-red/[0.12]",
      confirm: "bg-status-red text-white hover:brightness-95 shadow-[0_10px_22px_rgba(211,47,47,0.24)]",
    },
    neutral: {
      icon: XCircle,
      ring: "border-slate-500/15 bg-slate-500/10 text-slate-600 dark:text-slate-300",
      panel: "bg-slate-500/[0.06] border-slate-500/12 dark:bg-white/[0.06]",
      confirm: "bg-slate-800 text-white hover:bg-slate-700 dark:bg-slate-200 dark:text-void-900 dark:hover:bg-white shadow-[0_10px_22px_rgba(15,23,42,0.16)]",
    },
  }[tone];
  const ToneIcon = toneStyles.icon;

  return createPortal(
    <Overlay
      isOpen={!isClosing}
      intent="destructive"
      className="z-[10000] overflow-y-auto p-4 sm:p-6"
      blur
      onClose={() => handleClose(onCancel)}
    >
      <div
        ref={(el) => {
          if (el) {
            trapRef.current = el;
            cardRef.current = el;
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={body ? "confirm-dialog-body" : undefined}
        tabIndex={-1}
        className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-[1.5rem] border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)] sm:max-w-[28rem]"
      >
        <div className={`shrink-0 border-b p-5 ${toneStyles.panel}`}>
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${toneStyles.ring}`}>
              <ToneIcon className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">Confirm Runtime Action</p>
              <h2 id="confirm-dialog-title" className="mt-1 text-base font-semibold leading-tight tracking-tight text-void-900 dark:text-slate-50">
                {title}
              </h2>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 pt-4">
          {body && (
            <p id="confirm-dialog-body" className="text-sm font-medium leading-relaxed text-slate-700 dark:text-slate-200">
              {body}
            </p>
          )}
          {destructive && (
            <div className="mt-4 rounded-xl border border-status-red/20 bg-status-red/10 p-3">
              <p className="text-xs font-medium text-status-red">
                <span className="inline-flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />This action is permanent and cannot be undone.</span>
              </p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-black/[0.06] bg-void-50/80 p-4 dark:border-white/[0.08] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            disabled={isProcessing}
            style={controlTransitionStyle}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/[0.08] bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.98] motion-reduce:duration-0 motion-reduce:ease-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.14] dark:bg-white/[0.08] dark:text-slate-100 dark:hover:bg-white/[0.12]"
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={() => handleClose(onConfirm)}
              label={confirmLabel}
              isLoading={isProcessing}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.98] motion-reduce:duration-0 motion-reduce:ease-none disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.confirm}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => handleClose(onConfirm)}
              disabled={isProcessing}
              aria-busy={isProcessing}
              style={controlTransitionStyle}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.98] motion-reduce:duration-0 motion-reduce:ease-none disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.confirm} ${confirmFlash ? '!bg-status-green !text-white !border-transparent' : ''}`}
            >
              {isProcessing && <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /><span className="sr-only">Processing, please wait</span></>}
              {isProcessing ? "Processing..." : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Overlay>,
    document.body
  );
}
