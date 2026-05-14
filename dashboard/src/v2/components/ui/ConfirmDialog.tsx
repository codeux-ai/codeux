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
      const d_backdrop = reducedMotion ? 0 : 0.4;
      const d_card = reducedMotion ? 0 : 0.4;

      if (backdropRef.current) {
        gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: "power4.out" });
      }

      if (cardRef.current) {
        gsap.fromTo(cardRef.current,
          { y: reducedMotion ? 0 : 20, opacity: 0, scale: reducedMotion ? 1 : 0.9, filter: reducedMotion ? "blur(0px)" : "blur(14px)" },
          { y: 0, opacity: 1, scale: 1, filter: "blur(0px)", duration: d_card, ease: "power4.out", clearProps: "filter" }
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
      const d = reducedMotion ? 0 : 0.4;

      if (cardRef.current) {
        gsap.to(cardRef.current, { y: reducedMotion ? 0 : 20, opacity: 0, scale: reducedMotion ? 1 : 0.9, filter: reducedMotion ? "blur(0px)" : "blur(14px)", duration: d, ease: "power4.in" });
      }

      if (backdropRef.current) {
        gsap.to(backdropRef.current, {
          opacity: 0,
          duration: d,
          delay: 0,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-void-900/40 backdrop-blur-2xl p-4"
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
                ⚠️ This action is permanent and cannot be undone.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-3 p-4 bg-void-50 dark:bg-void-900/30 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            className="px-4 py-2 text-sm font-medium rounded-[1rem] border border-black/[0.06] dark:border-white/[0.06] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 transition-all duration-200"
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={() => handleClose(onConfirm)}
              label={confirmLabel}
              className="px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-status-red text-white hover:opacity-90 shadow-[0_4px_12px_rgba(211,47,47,0.25)]"
            />
          ) : (
            <button
              type="button"
              onClick={() => handleClose(onConfirm)}
              className="px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-signal-500 text-white hover:bg-signal-600 dark:hover:bg-signal-400 shadow-[0_4px_12px_rgba(0,224,160,0.25)]"
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
