import { h } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef, useState, useEffect, useCallback } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

import { Loader2, AlertTriangle, CheckCircle2, CircleAlert, Info, XCircle } from "lucide-preact";
import { Overlay } from "./Overlay.js";

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
  const [isHolding, setIsHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const reducedMotion = useReducedMotion();

  const holdDuration = 1000;
  const holdTimerRef = useRef<number | null>(null);
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
  }, []);

  const startHold = () => {
    if (isHolding || isLoading) return;
    setIsHolding(true);
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
          gsap.to(barRef.current, { width: `${newProgress}%`, duration: 0.12, ease: "power2.out", overwrite: true });
        }
      }

      if (elapsed < holdDuration) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    holdTimerRef.current = window.setTimeout(() => {
      setIsHolding(false);
      setProgress(100);
      if (barRef.current) {
        barRef.current.style.width = '100%';
      }
      onConfirm();
    }, holdDuration);
  };

  const cancelHold = () => {
    if (isHolding) {
      if (!reducedMotion && holdButtonRef.current) {
        gsap.to(holdButtonRef.current, {
          keyframes: [{ x: -6, duration: 0.05 }, { x: 5, duration: 0.06 }, { x: -4, duration: 0.07 }, { x: 3, duration: 0.06 }, { x: -2, duration: 0.05 }, { x: 0, duration: 0.04 }],
          ease: "none"
        });
      }
    }
    setIsHolding(false);
    setProgress(0);
    if (barRef.current) {
      gsap.killTweensOf(barRef.current);
      barRef.current.style.width = '0%';
    }
    clearTimers();
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
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      aria-busy={isLoading}
      disabled={isLoading}
      aria-live="polite"
      aria-label={isHolding ? `Holding — ${Math.floor(progress / 10) * 10}% complete, release to cancel` : `Hold to ${label}`}
    >
      {isHolding && (
        <div
          ref={barRef}
          className="absolute inset-0 bg-black/20 dark:bg-white/20 origin-left"
          style={{ width: "0%" }}
        />
      )}

      <span className="relative z-10 flex items-center justify-center gap-2">
        {isLoading && <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /><span className="sr-only">Processing, please wait</span></>}
        {isHolding ? `Hold to ${label}` : isLoading ? "Processing..." : label}
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
  }, [shouldRender, isClosing, reducedMotion]);

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
  }, [isClosing, reducedMotion]);

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
        className="my-auto w-full max-w-[28rem] overflow-hidden rounded-[1.5rem] border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)]"
      >
        <div className={`border-b p-5 ${toneStyles.panel}`}>
          <div className="flex items-start gap-4">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${toneStyles.ring}`}>
              <ToneIcon className="h-5 w-5" strokeWidth={1.8} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">Confirm Runtime Action</p>
              <h2 id="confirm-dialog-title" className="mt-1 text-lg font-black leading-tight tracking-tight text-void-900 dark:text-slate-50">
                {title}
              </h2>
            </div>
          </div>
        </div>
        <div className="p-5 pt-4">
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
        <div className="flex flex-col-reverse gap-2 border-t border-black/[0.06] bg-void-50/80 p-4 dark:border-white/[0.08] dark:bg-white/[0.04] sm:flex-row sm:items-center sm:justify-end sm:gap-3">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            disabled={isProcessing}
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-black/[0.08] bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all duration-200 hover:bg-black/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.14] dark:bg-white/[0.08] dark:text-slate-100 dark:hover:bg-white/[0.12]"
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={() => handleClose(onConfirm)}
              label={confirmLabel}
              isLoading={isProcessing}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 py-2 text-sm font-black transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.confirm}`}
            />
          ) : (
            <button
              type="button"
              onClick={() => handleClose(onConfirm)}
              disabled={isProcessing}
              aria-busy={isProcessing}
              className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-black transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${toneStyles.confirm} ${confirmFlash ? '!bg-status-green !text-white !border-transparent' : ''}`}
            >
              {isProcessing && <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /><span className="sr-only">Processing, please wait</span></>}
              {isProcessing ? "Processing..." : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Overlay>,
    document.body
  );
}
