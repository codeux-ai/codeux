import { h } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useCallback } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

import { Loader2, AlertTriangle } from "lucide-preact";

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
  const [isShaking, setIsShaking] = useState(false);
  const reducedMotion = useReducedMotion();

  const holdDuration = 1000;
  const holdTimerRef = useRef<number | null>(null);
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
    setIsShaking(false);
    startTimeRef.current = performance.now();

    const updateProgress = (currentTime: number) => {
      if (!startTimeRef.current) return;

      const elapsed = currentTime - startTimeRef.current;
      const newProgress = Math.min(100, (elapsed / holdDuration) * 100);

      setProgress(newProgress);

      if (elapsed < holdDuration) {
        animationFrameRef.current = requestAnimationFrame(updateProgress);
      }
    };

    animationFrameRef.current = requestAnimationFrame(updateProgress);

    holdTimerRef.current = window.setTimeout(() => {
      setIsHolding(false);
      setProgress(100);
      onConfirm();
    }, holdDuration);
  };

  const cancelHold = () => {
    if (isHolding) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 400);
    }
    setIsHolding(false);
    setProgress(0);
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
      type="button"
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative overflow-hidden ${className} ${isShaking && !reducedMotion ? "animate-shake" : ""}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
      aria-busy={isLoading}
      aria-label={isHolding ? `Holding — ${Math.floor(progress / 10) * 10}% complete, release to cancel` : `Hold to ${label}`}
    >
      {isHolding && (
        <div
          className="absolute inset-0 bg-black/20 dark:bg-white/20 origin-left transition-transform duration-100"
          style={{ transform: `scaleX(${progress / 100})` }}
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
  triggerRef?: { current: HTMLElement | null };
}

export function ConfirmDialog({ isOpen, options, onConfirm, onCancel, triggerRef }: ConfirmDialogProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmFlash, setConfirmFlash] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const fallbackTriggerRef = useRef<HTMLElement | null>(null);
  const trapRef = useFocusTrap(shouldRender && !isClosing, { onClose: () => handleClose(onCancel), restoreFocus: false });
  const reducedMotion = useReducedMotion();

  const actualTriggerRef = triggerRef || fallbackTriggerRef;

  useLayoutEffect(() => {
    if (isOpen && !shouldRender) {
      actualTriggerRef.current = document.activeElement as HTMLElement | null;
    }
  }, [isOpen, shouldRender, actualTriggerRef]);

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
      const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
      const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;

      if (backdropRef.current) {
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
      }

      if (cardRef.current) {
        gsap.fromTo(cardRef.current,
          { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
          { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease }
        );
      }
    }
  }, [shouldRender, isClosing, reducedMotion]);

  const pendingCallback = useRef<(() => void | Promise<void>) | null>(null);

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
      pendingCallback.current = callback;
      setIsClosing(true);
    }
  };

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;

      if (cardRef.current) {
        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration: d, ease: MODAL_MOTION.exit.ease });
      }

      const onExitComplete = () => {
        setShouldRender(false);
        setIsClosing(false);

        if (actualTriggerRef.current) {
          actualTriggerRef.current.focus();
          actualTriggerRef.current = null;
        }

        if (pendingCallback.current) {
          pendingCallback.current();
          pendingCallback.current = null;
        }
      };

      if (backdropRef.current) {
        gsap.to(backdropRef.current, {
          opacity: 0,
          duration: d,
          delay: reducedMotion ? 0 : 0.05,
          onComplete: onExitComplete
        });
      } else {
        onExitComplete();
      }
    }
  }, [isClosing, reducedMotion, actualTriggerRef]);

  if (!shouldRender || !options) return null;

  const { title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = options;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-void-900/50 backdrop-blur-sm p-4"
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
        aria-describedby="confirm-dialog-body"
        className="bg-white dark:bg-void-800 w-full max-w-md rounded-[1.75rem] shadow-2xl overflow-hidden border border-black/[0.06] dark:border-white/[0.06] flex flex-col"
      >
        <div className="p-6 pb-4">
          <h2 id="confirm-dialog-title" className="text-xl font-semibold text-void-900 dark:text-white">
            {title}
          </h2>
          <p id="confirm-dialog-body" className="mt-3 text-sm text-void-600 dark:text-void-300">
            {body}
          </p>
          {destructive && (
            <div className="mt-4 p-3 bg-status-red/10 border border-status-red/20 rounded-lg">
              <p className="text-xs font-medium text-status-red">
                <span className="inline-flex items-start gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />This action is permanent and cannot be undone.</span>
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-4 bg-void-50 dark:bg-void-900/30 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            disabled={isProcessing}
            className="px-4 py-2 text-sm font-medium rounded-[1rem] border border-black/[0.06] dark:border-white/[0.06] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={() => handleClose(onConfirm)}
              label={confirmLabel}
              isLoading={isProcessing}
              className="px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-status-red text-white hover:opacity-90 shadow-[0_4px_12px_rgba(211,47,47,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleClose(onConfirm)}
              disabled={isProcessing}
              aria-busy={isProcessing}
              className={`px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 motion-safe:active:scale-[0.97] bg-signal-500 text-white hover:bg-signal-600 dark:hover:bg-signal-400 shadow-[0_4px_12px_rgba(0,224,160,0.25)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 ${confirmFlash ? '!bg-status-green !text-white !border-transparent' : ''}`}
            >
              {isProcessing && <><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /><span className="sr-only">Processing, please wait</span></>}
              {isProcessing ? "Processing..." : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
