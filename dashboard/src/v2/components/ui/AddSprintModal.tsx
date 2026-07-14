import type { FunctionComponent } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { AlertCircle, Loader2, Plus, Target, X } from "lucide-preact";
import { Modal } from "./Modal.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { sprintAuthoringMessages } from "../../i18n/messages/sprint-authoring.js";

export interface AddSprintModalSubmission {
  name: string;
  goal: string;
}

interface AddSprintModalProps {
  projectName?: string;
  onClose: () => void;
  onAdd: (sprint: AddSprintModalSubmission) => void | Promise<void>;
}

const fieldLabelClass = "text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 group-focus-within/field:text-signal-600 dark:group-focus-within/field:text-signal-300 transition-colors";
const inputClass = "mt-2.5 w-full rounded-[1.15rem] border border-black/[0.06] bg-black/[0.025] px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition-all placeholder:text-slate-300 focus:border-signal-500/45 focus:bg-white focus:shadow-[0_0_0_1px_rgba(35,137,218,0.16)] focus-visible:outline-none dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-100 dark:placeholder:text-slate-600 dark:focus:border-signal-400/50 dark:focus:bg-white/[0.055] aria-[invalid=true]:border-status-red/60";

export const AddSprintModal: FunctionComponent<AddSprintModalProps> = ({ projectName, onClose, onAdd }) => {
  const { translate } = useDashboardI18n();
  const t = (key: keyof typeof sprintAuthoringMessages.en, variables?: Record<string, string>): string => translate(sprintAuthoringMessages, key, variables);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [touched, setTouched] = useState({ name: false, goal: false });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const validationErrors = useMemo(() => ({
    name: name.trim() ? null : t("sprintNameRequiredPeriod"),
    goal: goal.trim() ? null : t("sprintGoalRequired"),
  }), [goal, name, translate]);
  const hasErrors = Boolean(validationErrors.name || validationErrors.goal);

  const handleClose = (): void => {
    if (!isSubmitting) {
      onClose();
    }
  };

  const handleSubmit = async (event: Event): Promise<void> => {
    event.preventDefault();
    setTouched({ name: true, goal: true });
    setSubmitError(null);

    if (hasErrors) {
      const firstInvalid = name.trim() ? document.getElementById("add-sprint-goal") : nameInputRef.current;
      if (firstInvalid instanceof HTMLElement) {
        firstInvalid.focus({ preventScroll: true });
      }
      return;
    }

    setIsSubmitting(true);
    try {
      await Promise.resolve(onAdd({ name: name.trim(), goal: goal.trim() }));
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      initialFocusRef={nameInputRef}
      ariaLabelledBy="add-sprint-modal-title"
      ariaDescribedBy="add-sprint-modal-description"
      className="w-[calc(100vw-2rem)] max-w-xl !overflow-hidden !rounded-[2rem] !p-0"
    >
      <form onSubmit={(event) => { void handleSubmit(event); }} className="flex min-w-0 flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] bg-black/[0.025] px-5 py-4 dark:border-white/[0.08] dark:bg-white/[0.035]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">
              <Target className="h-3.5 w-3.5" strokeWidth={2.4} />
              {t("newSprint")}
            </div>
            <h2 id="add-sprint-modal-title" className="mt-2 break-words text-xl font-black tracking-tight text-slate-900 dark:text-white">
              {t("addSprint")}
            </h2>
            <p id="add-sprint-modal-description" className="mt-1 max-w-md text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
              {t("addSprintDescription", { projectName: projectName || t("activeProject") })}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            aria-label={t("closeAddSprint")}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-black/[0.06] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/[0.06] dark:hover:text-white"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
          </button>
        </div>

        <div className="grid gap-4 px-5 py-5">
          <label className="group/field block">
            <span className={fieldLabelClass}>{t("sprintNameLower")}</span>
            <input
              ref={nameInputRef}
              id="add-sprint-name"
              value={name}
              disabled={isSubmitting}
              aria-invalid={touched.name && validationErrors.name ? "true" : "false"}
              aria-describedby={touched.name && validationErrors.name ? "add-sprint-name-error" : undefined}
              onInput={(event) => setName(event.currentTarget.value)}
              onBlur={() => setTouched((current) => ({ ...current, name: true }))}
              placeholder={t("sprintNamePlaceholder")}
              className={inputClass}
            />
            {touched.name && validationErrors.name ? (
              <span id="add-sprint-name-error" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-status-red">
                <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
                {validationErrors.name}
              </span>
            ) : null}
          </label>

          <label className="group/field block">
            <span className={fieldLabelClass}>{t("goal")}</span>
            <textarea
              id="add-sprint-goal"
              value={goal}
              rows={5}
              disabled={isSubmitting}
              aria-invalid={touched.goal && validationErrors.goal ? "true" : "false"}
              aria-describedby={touched.goal && validationErrors.goal ? "add-sprint-goal-error" : undefined}
              onInput={(event) => setGoal(event.currentTarget.value)}
              onBlur={() => setTouched((current) => ({ ...current, goal: true }))}
              placeholder={t("sprintGoalPlaceholder")}
              className={`${inputClass} min-h-32 resize-y leading-relaxed`}
            />
            {touched.goal && validationErrors.goal ? (
              <span id="add-sprint-goal-error" className="mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-status-red">
                <AlertCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
                {validationErrors.goal}
              </span>
            ) : null}
          </label>

          {submitError ? (
            <div role="alert" className="flex items-center gap-2 rounded-xl border border-status-red/25 bg-status-red/[0.06] px-3 py-2 text-sm font-semibold text-status-red">
              <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={2.2} />
              <span>{submitError}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-black/[0.06] bg-black/[0.02] px-5 py-4 dark:border-white/[0.08] dark:bg-white/[0.025]">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="min-h-11 rounded-xl px-4 text-sm font-bold text-slate-500 transition-colors hover:bg-black/[0.04] hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-white"
          >
            {t("cancel")}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            aria-busy={isSubmitting ? "true" : "false"}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-signal-500 px-4 text-sm font-black text-white shadow-sm transition-colors hover:bg-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-signal-400 dark:text-void-900 dark:hover:bg-signal-300"
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Plus className="h-4 w-4" strokeWidth={2.4} />}
            {t("createSprint")}
          </button>
        </div>
      </form>
    </Modal>
  );
};
