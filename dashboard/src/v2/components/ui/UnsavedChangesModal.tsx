import { h, FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useEffect } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { AlertTriangle } from "lucide-preact";

interface UnsavedChangesModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  onSave?: () => void;
  saving?: boolean;
}

export const UnsavedChangesModal: FunctionComponent<UnsavedChangesModalProps> = ({
  onConfirm,
  onCancel,
  onSave,
  saving = false,
}) => {
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const trapRef = useFocusTrap(true, onCancel);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const durationMultiplier = prefersReducedMotion ? 0 : 1;

      if (backdropRef.current) {
        gsap.fromTo(
          backdropRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.2 * durationMultiplier, ease: "power2.out" }
        );
      }

      if (panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          { y: 8, opacity: 0 },
          { y: 0, opacity: 1, duration: 0.22 * durationMultiplier, ease: "power3.out" }
        );
      }
    });
    return () => ctx.revert();
  }, [prefersReducedMotion]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-end justify-center bg-void-900/50 p-4 backdrop-blur-sm sm:items-center"
    >
      <div
        ref={(el) => {
          if (el) {
            panelRef.current = el;
            trapRef.current = el;
          }
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unsaved-modal-title"
        aria-describedby="unsaved-modal-body"
        className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_28px_90px_rgba(0,0,0,0.56)]"
      >
        <div className="flex-1 overflow-y-auto p-5 pb-4 sm:p-6 sm:pb-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-status-red/20 bg-status-red/10 text-status-red">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 id="unsaved-modal-title" className="min-w-0 break-words text-xl font-bold tracking-tight text-void-900 dark:text-white">
              Unsaved changes
            </h2>
          </div>
          <p id="unsaved-modal-body" className="mt-4 break-words text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            You have unsaved settings. Save them, discard them, or keep editing?
          </p>
        </div>

        <div className="flex flex-col-reverse items-stretch justify-end gap-2 border-t border-black/[0.06] bg-void-50/80 p-4 dark:border-white/[0.06] dark:bg-white/[0.04] sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="min-h-10 w-full rounded-xl border border-black/[0.08] bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-slate-600 transition-all hover:bg-black/[0.035] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.14] dark:bg-white/[0.08] dark:text-slate-300 dark:hover:text-white sm:w-auto"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={saving}
            className="min-h-10 w-full rounded-xl border border-status-red/30 bg-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-status-red transition-all hover:bg-status-red/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40 disabled:cursor-not-allowed disabled:opacity-50 dark:border-status-red/30 dark:bg-white/[0.08] sm:w-auto"
          >
            Discard changes
          </button>
          {onSave ? (
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="min-h-10 w-full rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold uppercase tracking-widest text-white shadow-[0_10px_22px_rgba(15,23,42,0.16)] transition-all hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100 sm:w-auto"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
