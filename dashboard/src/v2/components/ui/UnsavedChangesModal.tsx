import { h, FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useEffect } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { AlertTriangle } from "lucide-preact";

interface UnsavedChangesModalProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export const UnsavedChangesModal: FunctionComponent<UnsavedChangesModalProps> = ({
  onConfirm,
  onCancel,
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
      if (event.key === "Escape") {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-void-900/50 backdrop-blur-sm p-4"
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
        className="bg-white dark:bg-void-800 w-full max-w-md rounded-[1.75rem] shadow-2xl overflow-hidden border border-black/[0.06] dark:border-white/[0.06] flex flex-col"
      >
        <div className="p-7 pb-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-red/10 text-status-red">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 id="unsaved-modal-title" className="text-xl font-bold tracking-tight text-void-900 dark:text-white">
              Unsaved changes
            </h2>
          </div>
          <p id="unsaved-modal-body" className="mt-4 text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            You have unsaved settings. Discard changes and leave?
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 bg-void-50 dark:bg-void-900/30 p-5 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl border border-black/[0.06] bg-white/70 text-slate-600 hover:text-slate-900 transition-all dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl bg-status-red text-white shadow-[0_4px_12px_rgba(227,0,15,0.25)] hover:bg-status-red/90 transition-all active:scale-95"
          >
            Discard changes
          </button>
        </div>
      </div>
    </div>
  );
};
