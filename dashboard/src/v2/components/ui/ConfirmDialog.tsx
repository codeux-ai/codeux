import { h } from "preact";
import { useRef, useState, useEffect, useCallback } from "preact/hooks";
import { Loader2 } from "lucide-preact";
import type { ConfirmDialogOptions } from "../../hooks/use-confirm-dialog.js";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle } from "./Dialog.js";

function DestructiveConfirmButton({
  onConfirm,
  label,
  className,
  disabled = false
}: {
  onConfirm: () => void;
  label: string;
  className?: string;
  disabled?: boolean;
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
    if (disabled || isHolding) return;
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
    if (disabled) return;
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
    if (e.button !== 0 || disabled) return;
    if (typeof e.currentTarget.setPointerCapture === "function") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    startHold();
  };

  const handlePointerUp = (e: h.JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    cancelHold();
  };

  const handleKeyDown = (e: h.JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      startHold();
    }
  };

  const handleKeyUp = (e: h.JSX.TargetedKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cancelHold();
    }
  };

  const handlePointerLeave = () => {
    if (disabled) return;
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
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(e) => e.preventDefault()}
      className={`relative overflow-hidden flex items-center justify-center ${className} ${isShaking ? "animate-shake" : ""} ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      style={{ userSelect: 'none', WebkitUserSelect: 'none' }}
    >
      {isHolding && !disabled && (
        <div
          className="absolute inset-0 bg-black/20 dark:bg-white/20 origin-left"
          style={{
            transform: `scaleX(${progress / 100})`,
            transition: 'transform 0.1s linear'
          }}
        />
      )}

      {disabled ? (
        <Loader2 className="w-4 h-4 animate-spin relative z-10" />
      ) : (
        <span className="relative z-10">
          {isHolding ? `Hold to ${label}` : label}
        </span>
      )}
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
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsPending(false);
    }
  }, [isOpen]);

  if (!options) return null;

  const handleConfirm = async () => {
    if (isPending) return;
    const result = onConfirm();
    if (result instanceof Promise) {
      setIsPending(true);
      try {
        await result;
      } finally {
        setIsPending(false);
      }
    }
  };

  const { title, body, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = options;

  return (
    <Dialog isOpen={isOpen} onClose={onCancel} preventOutsideClose={isPending}>
      <DialogContent ariaLabelledBy="confirm-dialog-title" ariaDescribedBy="confirm-dialog-body">
        <DialogHeader>
          <DialogTitle id="confirm-dialog-title">{title}</DialogTitle>
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
        </DialogHeader>
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className={`px-4 py-2 text-sm font-medium rounded-[1rem] border border-black/[0.06] dark:border-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 transition-all duration-200 ${isPending ? "opacity-50 cursor-not-allowed" : "hover:bg-black/5 dark:hover:bg-white/5"}`}
          >
            {cancelLabel}
          </button>
          {destructive ? (
            <DestructiveConfirmButton
              onConfirm={handleConfirm}
              disabled={isPending}
              label={confirmLabel}
              className="px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-status-red text-white hover:opacity-90 shadow-[0_4px_12px_rgba(211,47,47,0.25)] min-w-[100px]"
            />
          ) : (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={isPending}
              className={`px-4 py-2 text-sm font-medium rounded-[1rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 active:scale-95 bg-signal-500 text-white shadow-[0_4px_12px_rgba(0,224,160,0.25)] flex items-center justify-center min-w-[100px] ${isPending ? "opacity-50 cursor-not-allowed" : "hover:bg-signal-600 dark:hover:bg-signal-400"}`}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmLabel}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
