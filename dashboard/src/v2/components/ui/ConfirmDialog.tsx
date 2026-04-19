import { h } from "preact";
import { useLayoutEffect, useRef, useState, useEffect, useCallback } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

function DestructiveConfirmButton({
  onConfirm,
  label,
  className
}: {
  onConfirm: () => void;
  label: string;
  className?: string;
}) {
  const [isHolding, setIsHolding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isShaking, setIsShaking] = useState(false);

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
    if (isHolding) return;
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
    e.currentTarget.setPointerCapture(e.pointerId);
    startHold();
  };

  const handlePointerUp = (e: h.JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
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
    if (isHolding) {
      setIsHolding(false);
      setProgress(0);
      clearTimers();
      startTimeRef.current = null;
    }
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
      onContextMenu={(e) => e.preventDefault()}
      className={`relative overflow-hidden ${className} ${isShaking ? "animate-shake" : ""}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {isHolding && (
        <div
          className="absolute inset-0 bg-black/20 dark:bg-white/20 origin-left"
          style={{
            transform: `scaleX(${progress / 100})`,
            transition: 'transform 0.1s linear'
          }}
        />
      )}

      <span className="relative z-10">
        {isHolding ? `Hold to ${label}` : label}
      </span>
    </button>
  );
}

interface ConfirmDialogProps {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ isOpen, options, onConfirm, onCancel }: ConfirmDialogProps) {
  const [shouldRender, setShouldRender] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);

  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const trapRef = useFocusTrap(shouldRender && !isClosing, () => handleClose(onCancel));
  const reducedMotion = useReducedMotion();

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

  const pendingCallback = useRef<(() => void) | null>(null);

  const handleClose = (callback: () => void) => {
    if (isClosing) return;
    pendingCallback.current = callback;
    setIsClosing(true);
  };

  useEffect(() => {
    if (isClosing) {
      const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;

      if (cardRef.current) {
        gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration: d, ease: MODAL_MOTION.exit.ease });
      }

      if (backdropRef.current) {
        gsap.to(backdropRef.current, {
          opacity: 0,
          duration: d,
          delay: reducedMotion ? 0 : 0.05,
          onComplete: () => {
            setShouldRender(false);
            setIsClosing(false);
            if (pendingCallback.current) {
              pendingCallback.current();
              pendingCallback.current = null;
            }
          }
        });
      } else {
        setShouldRender(false);
        setIsClosing(false);
        if (pendingCallback.current) {
          pendingCallback.current();
          pendingCallback.current = null;
        }
      }
    }
  }, [isClosing, reducedMotion]);

  if (!shouldRender || !options) return null;

  const { title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = options;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-void-950/40 backdrop-blur-3xl p-4"
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
        className="bg-white/95 dark:bg-void-900/95 backdrop-blur-3xl w-full max-w-md rounded-3xl shadow-[0_32px_64px_rgba(0,0,0,0.4)] overflow-hidden border border-black/[0.06] dark:border-white/[0.08] flex flex-col"
      >
        <div className="p-8 pb-6">
          <h2 id="confirm-dialog-title" className="text-2xl font-black text-void-900 dark:text-white tracking-tight leading-none">
            {title}
          </h2>
          <p id="confirm-dialog-body" className="mt-4 text-[13px] font-medium text-void-500 dark:text-void-400 leading-relaxed">
            {body}
          </p>
          {destructive && (
            <div className="mt-6 p-4 bg-status-red/5 border border-status-red/10 rounded-2xl">
              <p className="text-[11px] font-bold uppercase tracking-wider text-status-red">
                ⚠️ Permanent Action
              </p>
              <p className="mt-1 text-[11px] font-medium text-status-red/80">
                This process cannot be undone.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-6 bg-black/[0.02] dark:bg-white/[0.02] border-t border-black/[0.04] dark:border-white/[0.04]">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            className="px-6 py-3 text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95"
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={() => handleClose(onConfirm)}
              label={confirmLabel}
              className="px-6 py-3 text-xs font-black uppercase tracking-widest rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 active:scale-95 bg-status-red text-white hover:bg-red-600 shadow-[0_8px_20px_rgba(211,47,47,0.3)] transition-all"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleClose(onConfirm)}
              className="px-6 py-3 text-xs font-black uppercase tracking-widest rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-signal-500 text-void-900 hover:bg-signal-400 shadow-[0_8px_20px_rgba(0,224,160,0.3)] transition-all"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
