import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Bot, Plus, Target, X, Save, AlertCircle } from "lucide-preact";
import { Tooltip } from "./Tooltip.js";
import type { Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";
import { useTaskComposerState, type TaskDraft } from "../../lib/task-composer-state.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface TaskComposerProps {
  sprints: Sprint[];
  availableTasks: Task[];
  initialTask?: Task | null;
  initialSprintId?: string | null;
  onClose: () => void;
  onSubmit: (task: TaskDraft) => Promise<void> | void;
}

const PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "completed"];
const EXECUTOR_OPTIONS: Array<{ value: TaskExecutorType; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Use the default Sprint OS routing." },
  { value: "docker_cli", label: "CLI", description: "Run through Docker or local CLI worktrees." },
  { value: "jules", label: "Jules", description: "Force remote Jules execution." },
  { value: "mcp_worker", label: "Worker", description: "Queue this task for a connected MCP worker." },
];

export const TaskComposer: FunctionComponent<TaskComposerProps> = ({
  sprints,
  availableTasks,
  initialTask,
  initialSprintId,
  onClose,
  onSubmit,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const fieldsRef = useRef<HTMLFormElement>(null);

  const state = useTaskComposerState(sprints, availableTasks, initialTask, initialSprintId);
  const reducedMotion = useReducedMotion();

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
      return;
    }

    state.setIsSubmitting(true);
    state.setSubmitError(null);

    try {
      await onSubmit(state.getPayload());
      state.setIsSubmitting(false);
      onClose();
    } catch (err) {
      state.setIsSubmitting(false);
      state.setSubmitError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section
      ref={cardRef}
      className="relative w-full overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 shadow-[0_20px_50px_rgba(15,23,42,0.08)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/72 dark:shadow-[0_24px_56px_rgba(0,0,0,0.28)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.08),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.08),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.1),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.09),transparent_34%)]" />

      <form
        ref={fieldsRef}
        onSubmit={handleSubmit}
        className="relative z-10 grid gap-0 xl:grid-cols-[minmax(0,1fr)_21rem]"
      >
        <div className="border-b border-black/[0.06] p-6 dark:border-white/[0.06] sm:p-8 lg:p-10 xl:border-b-0 xl:border-r">
          <div data-composer-stagger className="flex items-start justify-between gap-4">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/15 bg-signal-500/[0.07] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">
                <Target className="h-3.5 w-3.5" strokeWidth={2.3} />
                {state.isEditing ? "Edit Task" : "Task Composer"}
              </div>
              <div className="space-y-3">
                <h2 className="font-display text-[2rem] font-black leading-none tracking-tight text-slate-900 dark:text-white sm:text-[2.35rem]">
                  {state.isEditing ? "Refine The Task." : "Create A New Task."}
                </h2>
                <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400 sm:text-[15px]">
                  Define the task scope, execution prompt, and specify any dependencies required before starting.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-all hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:scale-95 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white"
              aria-label="Close task composer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div data-composer-stagger className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Sprint</div>
              <select
                value={state.sprintId}
                onInput={(event) => state.setSprintId((event.target as HTMLSelectElement).value)}
                onBlur={() => state.setFieldTouched('sprintId')}
                className={`w-full bg-transparent text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-lg px-1 py-0.5 -ml-1 border ${(state.hasAttemptedSubmit || state.touchedFields.sprintId) && !state.isSprintIdValid ? 'border-red-500' : 'border-transparent'}`} aria-invalid={!state.isSprintIdValid}
                required
              >
                <option value="" disabled>Select sprint</option>
                {sprints.map((sprint) => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                ))}
              </select>
              <div className="min-h-[20px] mt-1">
                {(state.hasAttemptedSubmit || state.touchedFields.sprintId) && state.sprintIdError && (
                  <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {state.sprintIdError}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[1.4rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">Status</div>
              <div className="flex gap-2 flex-wrap">
                {STATUS_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => state.setStatus(option)}
                    className={`px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-[0.14em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
                      state.status === option
                        ? "bg-signal-500 text-void-900 shadow-[0_2px_12px_rgba(0,224,160,0.3)]"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    }`}
                  >
                    {option.replace("_", " ")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <label data-composer-stagger className="mt-8 block space-y-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Task Title</span>
            <input
              type="text"
              value={state.title}
              onInput={(event) => state.setTitle((event.target as HTMLInputElement).value)}
              onBlur={() => state.setFieldTouched('title')}
              placeholder="Fix navigation layout shift"
              className={`w-full border-0 border-b-2 bg-transparent pb-3 font-display text-[1.65rem] font-black leading-none tracking-tight text-slate-900 outline-none transition-colors placeholder:text-slate-200 focus:border-signal-500 dark:text-white dark:placeholder:text-slate-700 sm:text-[1.9rem] ${(state.hasAttemptedSubmit || state.touchedFields.title) && !state.isTitleValid ? 'border-red-500' : 'border-black/[0.08] dark:border-white/[0.08]'}`} aria-invalid={!state.isTitleValid}
              required
              autoFocus
            />
            <div className="min-h-[24px] mt-1">
              {(state.hasAttemptedSubmit || state.touchedFields.title) && state.titleError && (
                <div className="flex items-center gap-1.5 text-xs text-red-500 font-medium">
                  <AlertCircle className="w-4 h-4" />
                  {state.titleError}
                </div>
              )}
            </div>
          </label>

          <div data-composer-stagger className="mt-8 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Task Details</label>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-[1.7rem] border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.03]">
                <textarea
                  value={state.description}
                  onInput={(event) => state.setDescription((event.target as HTMLTextAreaElement).value)}
                  placeholder="Summarize the intent and outcome."
                  className="min-h-[160px] w-full resize-none rounded-[1.7rem] bg-transparent px-4 py-4 text-sm leading-relaxed text-slate-700 outline-none placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-slate-300 dark:placeholder:text-slate-600 sm:px-5"
                />
              </div>

              <div className="rounded-[1.7rem] border border-black/[0.07] bg-black/[0.025] dark:border-white/[0.08] dark:bg-white/[0.03]">
                <textarea
                  value={state.promptMarkdown}
                  onInput={(event) => state.setPromptMarkdown((event.target as HTMLTextAreaElement).value)}
                  placeholder="Detailed markdown instructions for the agent."
                  className="min-h-[160px] w-full resize-none rounded-[1.7rem] bg-transparent px-4 py-4 text-sm leading-relaxed font-mono text-slate-700 outline-none placeholder:text-slate-300 focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-slate-300 dark:placeholder:text-slate-600 sm:px-5"
                />
              </div>
            </div>
          </div>

          <div data-composer-stagger className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Target className="w-3.5 h-3.5 text-ember-500" strokeWidth={2.3} />
                <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Dependencies</label>
              </div>
              {availableTasks.filter(t => t.sprintId === state.sprintId && t.recordId !== initialTask?.recordId).length > 5 && (
                <input
                  type="search"
                  placeholder="Filter tasks..."
                  value={state.dependencySearchQuery}
                  onInput={(e) => state.setDependencySearchQuery((e.target as HTMLInputElement).value)}
                  className="w-48 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-3 py-1.5 text-xs rounded-xl focus:outline-none focus:border-ember-500 focus-visible:ring-1 focus-visible:ring-ember-500/50"
                />
              )}
            </div>
            {state.dependencyOptions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.08] dark:border-white/[0.08] px-4 py-4 text-xs text-slate-400">
                No existing tasks in this sprint yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                {state.dependencyOptions.map((task) => {
                  const active = state.dependsOnTaskIds.includes(task.recordId);
                  return (
                    <button
                      key={task.recordId}
                      type="button"
                      onClick={() => state.toggleDependency(task.recordId)}
                      aria-pressed={active}
                      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
                        active
                          ? "border-ember-500/45 bg-ember-500/[0.08] text-ember-600 dark:text-ember-400"
                          : "border-black/[0.07] dark:border-white/[0.07] bg-black/[0.02] dark:bg-white/[0.02] text-slate-500"
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">{task.id}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${task.priority === 'critical' ? 'bg-red-500/10 text-red-500' : task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-slate-500/10 text-slate-500'}`}>
                            {task.priority}
                          </span>
                        </div>
                        <div className="text-sm font-semibold truncate leading-tight">{task.title}</div>
                      </div>
                      <span className={`w-4 h-4 rounded-full border ${active ? "border-ember-500 bg-ember-500" : "border-slate-300 dark:border-slate-600"}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <aside className="flex flex-col gap-4 p-6 sm:p-8">
          <div data-composer-stagger>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-3">Priority</div>
            <div className="grid grid-cols-2 gap-2">
              {PRIORITY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => state.setPriority(option)}
                  className={`px-3 py-2 rounded-[1.1rem] border text-[10px] font-bold uppercase tracking-[0.14em] transition-all text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:scale-95 ${
                    state.priority === option
                      ? "border-ember-500/45 bg-ember-500/[0.08] text-ember-600 dark:text-ember-400 shadow-[0_4px_12px_rgba(255,184,0,0.15)]"
                      : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div data-composer-stagger>
            <div className="flex items-center gap-2 mb-3">
              <Bot className="w-3.5 h-3.5 text-signal-500" strokeWidth={2.3} />
              <label className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Executor</label>
            </div>
            <div className="grid gap-3">
              {EXECUTOR_OPTIONS.map((option) => {
                const isActive = state.executorType === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => state.setExecutorType(option.value)}
                    className={`rounded-[1.35rem] border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 active:scale-[0.98] ${
                      isActive
                        ? "border-signal-500/30 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)]"
                        : "border-black/[0.06] bg-white/66 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-white/[0.02] dark:hover:border-white/[0.1]"
                    }`}
                  >
                    <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-700 dark:text-white">
                      <span className={`w-2 h-2 rounded-full ${isActive ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                      {option.label}
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {option.description}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div data-composer-stagger className="mt-auto flex flex-col gap-3 pt-2">
            {state.submitError && (
              <div className="flex items-start gap-3 rounded-2xl bg-red-500/[0.05] border border-red-500/20 p-4 text-sm text-red-600 dark:text-red-400">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div className="leading-relaxed font-medium">{state.submitError}</div>
              </div>
            )}
            <Tooltip
              content={!state.isValid ? "Please fix the validation errors before submitting." : null}
              position="top"
              className="bg-red-600"
            >
              <button
                type="submit"
                disabled={!state.isValid || state.isSubmitting}
                className="w-full inline-flex items-center justify-center gap-2.5 rounded-[1.2rem] bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)] transition-all hover:-translate-y-px hover:opacity-92 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:bg-white dark:text-void-900"
              >
                {state.isSubmitting ? (
                  <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white dark:border-void-900/20 dark:border-t-void-900 animate-spin" />
                ) : state.isEditing ? (
                  <Save className="h-4 w-4" strokeWidth={2.3} />
                ) : (
                  <Plus className="h-4 w-4" strokeWidth={2.3} />
                )}
                {state.isSubmitting ? (state.isEditing ? "Saving Task..." : "Creating Task...") : state.isEditing ? "Save Task" : "Create Task"}
              </button>
            </Tooltip>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[1.2rem] border border-black/[0.06] bg-white/66 px-5 py-3 text-sm font-semibold text-slate-500 transition-all hover:text-slate-900 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-300 dark:hover:text-white"
            >
              Cancel
            </button>
          </div>
        </aside>
      </form>
    </section>
  );
};
