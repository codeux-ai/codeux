import { h } from "preact";
import { useLayoutEffect, useRef, useState, useEffect } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";

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
      const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
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
        </div>
        <div className="flex items-center justify-end gap-3 p-4 bg-void-50 dark:bg-void-900/30 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={() => handleClose(onCancel)}
            className="px-4 py-2 text-sm font-medium rounded-[1rem] border border-black/[0.06] dark:border-white/[0.06] hover:bg-black/5 dark:hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 transition-all duration-200"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => handleClose(onConfirm)}
            className={`px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 transition-all duration-200 ${
              destructive
                ? "bg-status-red text-white hover:opacity-90 shadow-[0_4px_12px_rgba(211,47,47,0.25)]"
                : "bg-signal-500 text-white hover:bg-signal-600 dark:hover:bg-signal-400 shadow-[0_4px_12px_rgba(0,224,160,0.25)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
