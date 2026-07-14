import { h, FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useEffect, useState } from "preact/hooks";
import gsap from "gsap";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { AlertTriangle, RefreshCw } from "lucide-preact";
import { SHARED_INTERACTION_CLASSES } from "./Button.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { shellMessages } from "../../i18n/messages/shell.js";

interface UnsavedChangesModalProps {
  onConfirm: () => void;
  onCancel: () => void;
  onSave?: () => void;
  saving?: boolean;
  discarding?: boolean;
}

export const UnsavedChangesModal: FunctionComponent<UnsavedChangesModalProps> = ({
  onConfirm,
  onCancel,
  onSave,
  saving = false,
  discarding = false,
}) => {
  const { translate } = useOptionalDashboardI18n();
  const backdropRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const trapRef = useFocusTrap(true, onCancel);
  const [pendingAction, setPendingAction] = useState<"save" | "discard" | "cancel" | null>(null);
  const isSaving = saving || pendingAction === "save";
  const isDiscarding = discarding || pendingAction === "discard";
  const isPending = isSaving || isDiscarding || pendingAction === "cancel";

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
      if (event.key === "Escape" && !isPending) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, isPending]);

  useEffect(() => {
    if (saving) {
      saveButtonRef.current?.focus();
    } else if (discarding) {
      discardButtonRef.current?.focus();
    }
  }, [discarding, saving]);

  useEffect(() => {
    if (pendingAction !== "save" || saving) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setPendingAction((current) => current === "save" ? null : current);
    }, 500);
    return () => window.clearTimeout(timeoutId);
  }, [pendingAction, saving]);

  const handleCancel = (): void => {
    if (isPending) {
      return;
    }
    setPendingAction("cancel");
    onCancel();
  };

  const handleDiscard = (): void => {
    if (isPending) {
      return;
    }
    setPendingAction("discard");
    onConfirm();
  };

  const handleSave = (): void => {
    if (!onSave || isPending) {
      return;
    }
    setPendingAction("save");
    onSave();
  };

  return (
    <div
      ref={backdropRef}
      aria-busy={isPending ? "true" : undefined}
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
        className="bg-white dark:bg-void-800 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-hidden rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] flex flex-col"
      >
        <div className="p-7 pb-5 flex-1 overflow-y-auto">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-red/10 text-status-red">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <h2 id="unsaved-modal-title" className="text-xl font-bold tracking-tight text-void-900 dark:text-white">
              {translate(shellMessages, "unsavedChanges")}
            </h2>
          </div>
          <p id="unsaved-modal-body" className="mt-4 text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
            {translate(shellMessages, "unsavedChangesBody")}
          </p>
          <p className="mt-3 rounded-xl border border-status-red/20 bg-status-red/[0.06] px-3 py-2 text-xs font-semibold leading-relaxed text-status-red">
            {translate(shellMessages, "unsavedDiscardWarning")}
          </p>
          <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {translate(shellMessages, isSaving ? "unsavedSaving" : isDiscarding ? "unsavedDiscarding" : isPending ? "unsavedClosing" : "unsavedReady")}
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-end gap-3 bg-void-50 dark:bg-void-900/30 p-5 border-t border-black/[0.06] dark:border-white/[0.06]">
          <button
            type="button"
            onClick={handleCancel}
            aria-disabled={isPending}
            aria-busy={pendingAction === "cancel" ? "true" : undefined}
            className={`w-full sm:w-auto px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl border border-black/[0.06] bg-white/70 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white ${SHARED_INTERACTION_CLASSES}`}
          >
            {translate(shellMessages, "keepEditing")}
          </button>
          <button
            ref={discardButtonRef}
            type="button"
            onClick={handleDiscard}
            aria-disabled={isPending}
            aria-busy={isDiscarding ? "true" : undefined}
            className={`w-full sm:w-auto px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl border border-status-red/40 bg-status-red/[0.08] text-status-red hover:bg-status-red/[0.14] dark:border-status-red/40 dark:bg-status-red/[0.1] ${SHARED_INTERACTION_CLASSES}`}
          >
            {isDiscarding ? (
              <span className="inline-flex items-center justify-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                {translate(shellMessages, "discarding")}
              </span>
            ) : translate(shellMessages, "discardWithoutSaving")}
          </button>
          {onSave ? (
            <button
              ref={saveButtonRef}
              type="button"
              onClick={handleSave}
              aria-disabled={isPending}
              aria-busy={isSaving ? "true" : undefined}
              className={`w-full sm:w-auto px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-xl bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100 ${SHARED_INTERACTION_CLASSES}`}
            >
              {isSaving ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                  {translate(shellMessages, "saving")}
                </span>
              ) : translate(shellMessages, "saveChanges")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};
