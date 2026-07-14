import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, ListChecks, Plus, Save, Settings2, Target, X } from "lucide-preact";
import { Tooltip } from "./Tooltip.js";
import { FieldWrapper } from "../forms/FieldWrapper.js";
import type { AgentPreset, Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";
import { useTaskComposerState, type TaskDraft } from "../../lib/task-composer-state.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import { Button } from "./Button.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import { AgentSelectAvatarIcon } from "../agents/AgentSelectAvatarIcon.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";
import { sprintAuthoringMessages } from "../../i18n/messages/sprint-authoring.js";
import { getTaskPriorityLabel, getTaskStatusLabel } from "../../lib/tasks-constants.js";

interface TaskComposerProps {
  sprints: Sprint[];
  availableTasks: Task[];
  agentPresets?: AgentPreset[];
  initialTask?: Task | null;
  initialSprintId?: string | null;
  onClose: () => void;
  onSubmit: (task: TaskDraft) => Promise<void> | void;
}

const PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "completed"];
const pillButtonClass = "transition-[background-color,border-color,color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900";

export const TaskComposer: FunctionComponent<TaskComposerProps> = ({
  sprints,
  availableTasks,
  agentPresets = [],
  initialTask,
  initialSprintId,
  onClose,
  onSubmit,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const fieldsRef = useRef<HTMLFormElement>(null);
  const { locale, translate } = useOptionalDashboardI18n();
  const state = useTaskComposerState(sprints, availableTasks, initialTask, initialSprintId, locale);
  const executorOptions: Array<{ value: TaskExecutorType; label: string; description: string }> = [
    { value: "auto", label: translate(sprintAuthoringMessages, "executorAuto"), description: translate(taskMessages, "executorAutoDescription") },
    { value: "docker_cli", label: "CLI", description: translate(taskMessages, "executorCliDescription") },
    { value: "jules", label: "Jules", description: translate(taskMessages, "executorJulesDescription") },
  ];
  const reducedMotion = useReducedMotion();
  const { feedback, setPending, setSuccess, setError, clearFeedback, clearError } = useActionFeedback();
  const sprintTaskCount = availableTasks.filter((task) => task.sprintId === state.sprintId && task.recordId !== initialTask?.recordId).length;
  const agentSelectOptions = agentPresets.map((preset) => ({
    value: preset.id,
    label: preset.name,
    icon: () => <AgentSelectAvatarIcon avatarConfig={preset.avatarConfig} seed={`${preset.id}:${preset.name}`} />,
  }));

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const timeline = gsap.timeline();
      const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
      const d_fields = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
      const d_stagger = reducedMotion ? 0 : 0.055;

      if (cardRef.current) {
        timeline.fromTo(
          cardRef.current,
          { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
          { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease },
        );
      }

      if (fieldsRef.current) {
        timeline.fromTo(
          Array.from(fieldsRef.current.querySelectorAll("[data-composer-stagger]")),
          { y: reducedMotion ? 0 : 18, opacity: 0 },
          { y: 0, opacity: 1, stagger: d_stagger, duration: d_fields, ease: "power3.out" },
          reducedMotion ? "+=0" : "-=0.45",
        );
      }
    });

    return () => ctx.revert();
  }, [initialTask?.recordId, reducedMotion]);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!state.isValid) {
      state.setHasAttemptedSubmit(true);
      setTimeout(() => {
        const firstInvalid = fieldsRef.current?.querySelector('[aria-invalid="true"]');
        if (firstInvalid instanceof HTMLElement) {
          firstInvalid.focus();
        }
      }, 0);

      if (!state.isTitleValid && titleInputRef.current && !reducedMotion) {
        gsap.to(titleInputRef.current, {
          keyframes: [{ x: -6 }, { x: 6 }, { x: -4 }, { x: 4 }, { x: 0 }],
          duration: 0.4,
          ease: "power2.inOut",
        });
      }
      return;
    }

    state.setIsSubmitting(true);
    state.setSubmitError(null);
    clearFeedback();
    setPending(translate(taskMessages, "submittingTask"));

    try {
      await onSubmit(state.getPayload());
      state.setIsSubmitting(false);
      setSuccess(translate(taskMessages, "submittedTask"));
      onClose();
    } catch (err) {
      state.setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      state.setSubmitError(msg);
      setError(msg, { retryAction: () => fieldsRef.current?.requestSubmit(), retryLabel: translate(taskMessages, "retry"), autoDismiss: false });
    }
  };

  return (
    <section
      ref={cardRef}
      className="relative flex h-full min-h-[min(760px,calc(100vh-8rem))] w-full flex-col overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)]"
    >
      <form ref={fieldsRef} onSubmit={handleSubmit} className="relative z-10 flex min-h-0 flex-1 flex-col">
        <div data-composer-stagger className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] px-5 py-4 dark:border-white/[0.06] sm:px-6 lg:px-8">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <div className="inline-flex shrink-0 items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">
                <Target className="h-3.5 w-3.5" strokeWidth={2.3} />
                {translate(taskMessages, state.isEditing ? "editTaskPill" : "taskComposer")}
              </div>
              <h2 className="min-w-0 break-words font-display text-xl font-semibold leading-tight tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                {translate(taskMessages, state.isEditing ? "refineTask" : "createTask")}
              </h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {translate(taskMessages, "composerBody")}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Tooltip content={!state.isValid ? translate(taskMessages, "fixValidation") : null} position="bottom" className="bg-red-600">
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={state.isEditing ? Save : Plus}
                disabled={!state.isValid || state.isSubmitting}
                isLoading={state.isSubmitting}
                className="!rounded-[1.05rem]"
              >
                {translate(taskMessages, state.isEditing ? "saveTask" : "createTaskButton")}
              </Button>
            </Tooltip>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:scale-95 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
              aria-label={translate(taskMessages, "closeTaskComposer")}
              disabled={state.isSubmitting}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_22rem]">
          <main className="min-h-0 overflow-y-auto px-5 py-6 sm:px-6 lg:px-8">
            <div data-composer-stagger className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_13rem]">
              <FieldWrapper label={translate(taskMessages, "sprint")} required error={state.sprintIdError} forceTouch={state.touchedFields.sprintId || state.hasAttemptedSubmit}>
                <AvantgardeSelect
                  value={state.sprintId}
                  onChange={state.setSprintId}
                  onBlur={() => state.setFieldTouched("sprintId")}
                  aria-required="true"
                  invalid={Boolean(state.sprintIdError && (state.touchedFields.sprintId || state.hasAttemptedSubmit))}
                  placeholder={translate(taskMessages, "selectSprint")}
                  options={[
                    { value: "", label: translate(taskMessages, "selectSprint"), disabled: true },
                    ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
                  ]}
                />
              </FieldWrapper>

              <fieldset className="rounded-[1.2rem] border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <legend className="px-1 text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "status")}</legend>
                {(state.hasAttemptedSubmit || state.touchedFields.status) && state.statusError && (
                  <div className="mt-2 rounded bg-status-red/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-status-red">{state.statusError}</div>
                )}
                <div className="mt-2 flex flex-wrap gap-2" onBlur={() => state.setFieldTouched("status")}>
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => state.setStatus(option)}
                      className={`rounded-xl px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${pillButtonClass} ${
                        state.status === option
                          ? "bg-signal-500 text-white shadow-[0_2px_12px_rgba(0,94,184,0.18)] dark:text-void-900"
                          : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      {getTaskStatusLabel(option, locale)}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div data-composer-stagger className="mt-5">
              <FieldWrapper label={translate(taskMessages, "taskTitle")} required error={state.titleError} forceTouch={state.touchedFields.title || state.hasAttemptedSubmit}>
                <input
                  aria-label={`${translate(taskMessages, "taskTitle")} (${translate(taskMessages, "required")})`}
                  ref={titleInputRef}
                  type="text"
                  value={state.title}
                  onInput={(event) => state.setTitle((event.target as HTMLInputElement).value)}
                  onBlur={() => state.setFieldTouched("title")}
                  placeholder={translate(taskMessages, "taskTitlePlaceholder")}
                  className="w-full min-w-0 border-0 border-b-2 border-black/[0.08] bg-transparent pb-3 font-display text-2xl font-semibold leading-tight tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-300 focus:border-signal-500 dark:border-white/[0.08] dark:text-white dark:placeholder:text-slate-700 sm:text-4xl"
                  required
                  autoFocus
                />
              </FieldWrapper>
            </div>

            <div data-composer-stagger className="mt-6 grid gap-5 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <FieldWrapper label={translate(taskMessages, "description")} required error={state.descriptionError} forceTouch={state.touchedFields.description || state.hasAttemptedSubmit}>
                <textarea
                  aria-label={`${translate(taskMessages, "description")} (${translate(taskMessages, "required")})`}
                  value={state.description}
                  onInput={(event) => state.setDescription((event.target as HTMLTextAreaElement).value)}
                  onBlur={() => state.setFieldTouched("description")}
                  placeholder={translate(taskMessages, "descriptionPlaceholder")}
                  className="min-h-[220px] w-full min-w-0 resize-y rounded-[1.35rem] border border-black/[0.07] bg-white/45 px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-slate-300 dark:placeholder:text-slate-600 sm:px-5"
                  required
                />
              </FieldWrapper>

              <FieldWrapper label={translate(taskMessages, "markdownPrompt")} required error={state.promptMarkdownError} forceTouch={state.touchedFields.promptMarkdown || state.hasAttemptedSubmit}>
                <textarea
                  aria-label={`${translate(taskMessages, "markdownPrompt")} (${translate(taskMessages, "required")})`}
                  value={state.promptMarkdown}
                  onInput={(event) => state.setPromptMarkdown((event.target as HTMLTextAreaElement).value)}
                  onBlur={() => state.setFieldTouched("promptMarkdown")}
                  placeholder={translate(taskMessages, "markdownPromptPlaceholder")}
                  className="min-h-[320px] w-full min-w-0 resize-y rounded-[1.35rem] border border-black/[0.07] bg-white/45 px-4 py-4 font-mono text-sm leading-relaxed text-slate-700 outline-none transition-[border-color,box-shadow,background-color] placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-slate-300 dark:placeholder:text-slate-600 sm:px-5"
                  required
                />
              </FieldWrapper>
            </div>

            <div data-composer-stagger className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-500" strokeWidth={2.3} />
                  <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "dependencies")}</label>
                  {state.dependencyOptions.length === 0 && sprintTaskCount > 0 && (
                    <span className="rounded bg-status-amber/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-status-amber">{translate(taskMessages, "cyclePrevented")}</span>
                  )}
                </div>
                {sprintTaskCount > 5 && (
                  <input
                    type="search"
                    placeholder={translate(taskMessages, "filterTasks")}
                    value={state.dependencySearchQuery}
                    onInput={(event) => state.setDependencySearchQuery((event.target as HTMLInputElement).value)}
                    className="w-full min-w-0 rounded-xl border border-black/[0.08] bg-black/[0.03] px-3 py-1.5 text-xs outline-none transition-[border-color,box-shadow] focus:border-signal-500 focus-visible:ring-1 focus-visible:ring-signal-500/50 dark:border-white/[0.08] dark:bg-white/[0.03] sm:w-56"
                  />
                )}
              </div>
              {state.dependencyOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-4 text-xs text-slate-400 dark:border-white/[0.08]">
                  {translate(taskMessages, "noExistingTasks")}
                </div>
              ) : (
                <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 lg:grid-cols-2">
                  {state.dependencyOptions.map((task) => {
                    const active = state.dependsOnTaskIds.includes(task.recordId);
                    return (
                      <button
                        key={task.recordId}
                        type="button"
                        onClick={() => state.toggleDependency(task.recordId)}
                        aria-pressed={active ? "true" : "false"}
                        className={`flex min-w-0 items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left ${pillButtonClass} ${
                          active
                            ? "border-signal-500/40 bg-signal-500/[0.08] text-signal-600 shadow-[0_4px_16px_rgba(0,94,184,0.08)] dark:text-signal-300"
                            : "border-black/[0.07] bg-black/[0.02] text-slate-500 hover:border-black/[0.12] dark:border-white/[0.07] dark:bg-white/[0.02] dark:hover:border-white/[0.12]"
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 break-all font-mono text-[10px] uppercase tracking-[0.14em] text-slate-400">{task.id}</span>
                            <span className={`break-words rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${task.priority === "critical" ? "bg-status-red/10 text-status-red" : task.priority === "high" ? "bg-status-amber/10 text-status-amber" : "bg-slate-500/10 text-slate-500"}`}>
                              {getTaskPriorityLabel(task.priority, locale)}
                            </span>
                          </div>
                          <div className="break-words text-sm font-semibold leading-tight">{task.title}</div>
                        </div>
                        <span className={`h-4 w-4 shrink-0 rounded-full border ${active ? "border-signal-500 bg-signal-500" : "border-slate-300 dark:border-slate-600"}`} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </main>

          <aside className="flex min-h-0 flex-col gap-5 border-t border-black/[0.06] bg-black/[0.018] p-5 dark:border-white/[0.06] dark:bg-white/[0.018] sm:p-6 xl:border-l xl:border-t-0">
            <div data-composer-stagger>
              <div className="mb-3 flex items-center gap-2">
                <Settings2 className="h-3.5 w-3.5 text-slate-500" strokeWidth={2.3} />
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "executionSettings")}</div>
              </div>
              <div className="rounded-[1.4rem] border border-black/[0.06] bg-white/50 p-4 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "workerAgent")}</div>
                <div className="mt-3">
                  <AvantgardeSelect
                    variant="card"
                    aria-label={translate(taskMessages, "workerAgent")}
                    disabled={state.isSubmitting}
                    value={state.agentPresetId || ""}
                    onChange={(value) => state.setAgentPresetId(value || null)}
                    options={[
                      { value: "", label: translate(taskMessages, "builtInWorker"), icon: () => <AgentSelectAvatarIcon seed="built-in:worker" /> },
                      ...agentSelectOptions,
                    ]}
                    placeholder={translate(taskMessages, "builtInWorker")}
                  />
                </div>
              </div>
            </div>

            <div data-composer-stagger>
              <div className="mb-3 flex items-center gap-2">
                <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "priority")}</div>
                {(state.hasAttemptedSubmit || state.touchedFields.priority) && state.priorityError && (
                  <div className="rounded bg-status-red/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-status-red">{state.priorityError}</div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2" onBlur={() => state.setFieldTouched("priority")}>
                {PRIORITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => state.setPriority(option)}
                    className={`rounded-[1.1rem] border px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.14em] ${pillButtonClass} active:scale-95 ${
                      state.priority === option
                        ? "border-signal-500/40 bg-signal-500/[0.08] text-signal-600 shadow-[0_4px_12px_rgba(0,94,184,0.1)] dark:text-signal-300"
                        : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
                    }`}
                  >
                    {getTaskPriorityLabel(option, locale)}
                  </button>
                ))}
              </div>
            </div>

            <div data-composer-stagger>
              <div className="mb-3 flex items-center gap-2">
                <Bot className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.3} />
                <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">{translate(taskMessages, "executor")}</label>
                {(state.hasAttemptedSubmit || state.touchedFields.executorType) && state.executorTypeError && (
                  <div className="rounded bg-status-red/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.2em] text-status-red">{state.executorTypeError}</div>
                )}
              </div>
              <div className="grid gap-3" onBlur={() => state.setFieldTouched("executorType")}>
                {executorOptions.map((option) => {
                  const isActive = state.executorType === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => state.setExecutorType(option.value)}
                      className={`rounded-[1.35rem] border p-4 text-left ${pillButtonClass} active:scale-[0.98] ${
                        isActive
                          ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,94,184,0.08)]"
                          : "border-black/[0.06] bg-white/66 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-white">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${isActive ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                        <span className="min-w-0 break-words">{option.label}</span>
                      </div>
                      <div className="mt-2 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div data-composer-stagger className="mt-auto flex flex-col gap-3 pt-2">
              <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} clearError={clearError} autoDismiss={feedback.autoDismiss} retryAction={feedback.retryAction} retryLabel={feedback.retryLabel} />
              <button
                type="button"
                onClick={onClose}
                disabled={state.isSubmitting}
                className="rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-5 py-3 text-sm font-semibold text-slate-500 transition-[background-color,color,transform,opacity] hover:text-slate-900 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-300 dark:hover:text-white"
              >
                {translate(taskMessages, "cancel")}
              </button>
            </div>
          </aside>
        </div>
      </form>
    </section>
  );
};
