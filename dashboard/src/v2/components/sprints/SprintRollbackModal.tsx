import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { AlertTriangle, Bot, Loader2, RotateCcw, ShieldCheck, X } from "lucide-preact";
import type { Sprint, SprintRollbackAssessment } from "../../types.js";
import { assessSprintRollback, createSprintRollback } from "../../lib/project-api.js";
import { Modal } from "../ui/Modal.js";

interface SprintRollbackModalProps {
  sprint: Sprint | null;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

export const SprintRollbackModal: FunctionComponent<SprintRollbackModalProps> = ({
  sprint,
  onClose,
  onCreated,
}) => {
  const [assessment, setAssessment] = useState<SprintRollbackAssessment | null>(null);
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!sprint) {
      setAssessment(null);
      setInstructions("");
      setError(null);
      setSubmitting(false);
      return;
    }
    const controller = new AbortController();
    setAssessment(null);
    setError(null);
    void assessSprintRollback(sprint.projectId, sprint.id, controller.signal)
      .then(setAssessment)
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      });
    return () => controller.abort();
  }, [sprint?.id, sprint?.projectId]);

  const customScope = instructions.trim().length > 0;
  const effectiveMode = customScope ? "agent_assisted" : assessment?.recommendedMode;

  const submit = async (): Promise<void> => {
    if (!sprint || !assessment?.eligible || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSprintRollback(sprint.projectId, sprint.id, instructions);
      await onCreated();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={Boolean(sprint)}
      onClose={submitting ? () => undefined : onClose}
      disableBackdropClick={submitting}
      ariaLabelledBy="sprint-rollback-title"
      ariaDescribedBy="sprint-rollback-description"
      initialFocusRef={textareaRef}
      className="w-[min(44rem,calc(100vw-2rem))] overflow-hidden rounded-[1.7rem]"
    >
      <div className="relative overflow-hidden border-b border-black/[0.06] bg-[radial-gradient(circle_at_10%_0%,rgba(249,115,22,0.16),transparent_48%),linear-gradient(135deg,rgba(15,23,42,0.04),transparent)] px-6 py-6 dark:border-white/[0.07] dark:bg-[radial-gradient(circle_at_10%_0%,rgba(249,115,22,0.2),transparent_48%)] sm:px-8">
        <div className="flex items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-orange-500/25 bg-orange-500/12 text-orange-600 shadow-[0_0_24px_rgba(249,115,22,0.14)] dark:text-orange-300">
              <RotateCcw className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-600 dark:text-orange-300">Dedicated rollback sprint</div>
              <h2 id="sprint-rollback-title" className="mt-2 font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Revert {sprint?.name || "sprint"}
              </h2>
              <p id="sprint-rollback-description" className="mt-2 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                Code UX will preserve the original sprint and create a separately tracked rollback branch and sprint. Remote projects use a pull request; local projects merge the branch locally.
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="Close rollback dialog" className="touch-target flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-black/[0.05] hover:text-slate-900 disabled:opacity-40 dark:hover:bg-white/[0.06] dark:hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-5 px-6 py-6 sm:px-8">
        {!assessment && !error && (
          <div role="status" className="flex items-center gap-3 rounded-2xl border border-black/[0.06] bg-slate-50 px-4 py-4 text-sm text-slate-600 dark:border-white/[0.07] dark:bg-white/[0.035] dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-orange-500 motion-reduce:animate-none" />
            Inspecting merge history and later sprint work…
          </div>
        )}

        {assessment && (
          <div className={`rounded-2xl border px-4 py-4 ${assessment.eligible && assessment.recommendedMode === "automatic" ? "border-emerald-500/20 bg-emerald-500/[0.07]" : "border-orange-500/20 bg-orange-500/[0.07]"}`}>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
              {assessment.eligible && assessment.recommendedMode === "automatic" ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <Bot className="h-4 w-4 text-orange-500" />}
              {assessment.eligible
                ? assessment.recommendedMode === "automatic" ? "Safe automatic rollback available" : "Agent-assisted rollback required"
                : "Rollback is not available"}
            </div>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {assessment.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
            </ul>
          </div>
        )}

        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Rollback instructions <span className="font-medium normal-case tracking-normal">(optional)</span></span>
          <textarea
            ref={textareaRef}
            value={instructions}
            onInput={(event) => setInstructions(event.currentTarget.value)}
            disabled={!assessment?.eligible || submitting}
            rows={5}
            maxLength={6000}
            placeholder="Example: Remove only feature XY from this sprint and keep the database migration."
            className="mt-2 w-full resize-y rounded-2xl border border-black/[0.08] bg-white px-4 py-3 text-sm leading-relaxed text-slate-900 outline-none transition focus:border-orange-500/40 focus:ring-4 focus:ring-orange-500/10 disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-white"
          />
          <span className="mt-2 block text-xs text-slate-500 dark:text-slate-400">
            Adding instructions always invokes an agent so the requested subset can be removed safely.
          </span>
        </label>

        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-2xl border border-status-red/20 bg-status-red/[0.07] px-4 py-3 text-sm text-status-red">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t border-black/[0.06] pt-5 dark:border-white/[0.07] sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {effectiveMode === "automatic" ? "No coding invocation will be started." : effectiveMode === "agent_assisted" ? "A rollback coding invocation will be started." : ""}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-full px-4 py-2 text-xs font-semibold text-slate-600 transition hover:bg-black/[0.04] disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/[0.05]">Cancel</button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!assessment?.eligible || submitting}
              className="inline-flex min-w-36 items-center justify-center gap-2 rounded-full bg-orange-500 px-5 py-2.5 text-xs font-bold uppercase tracking-[0.12em] text-white shadow-[0_10px_24px_rgba(249,115,22,0.22)] transition hover:-translate-y-px hover:bg-orange-400 focus-visible:ring-2 focus-visible:ring-orange-500/40 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw className="h-4 w-4" />}
              {submitting ? "Starting" : customScope ? "Start agent rollback" : "Create rollback"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
