import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState, useEffect } from "preact/hooks";
import { useForm } from "react-hook-form";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import gsap from "gsap";
import { X, ListChecks, Target, Bot, Plus, AlertCircle } from "lucide-preact";
import type { Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import { Button } from "./Button.js";

interface TaskDraft {
  sprintId: string;
  title: string;
  description: string;
  promptMarkdown: string;
  status: TaskStatus;
  priority: TaskPriority;
  executorType: TaskExecutorType;
  dependsOnTaskIds: string[];
}

interface AddTaskModalProps {
  sprints: Sprint[];
  availableTasks: Task[];
  initialTask?: Task | null;
  defaultSprintId?: string | null;
  initialSprintId?: string | null;
  onClose: () => void;
  onSubmit: (task: TaskDraft) => Promise<void> | void;
}

const PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "completed"];
const EXECUTOR_OPTIONS: Array<{ value: TaskExecutorType; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Use the default Sprint OS routing." },
  { value: "docker_cli", label: "CLI", description: "Run through the isolated Docker workspace." },
  { value: "jules", label: "Jules", description: "Force remote Jules execution." },
];

export const AddTaskModal: FunctionComponent<AddTaskModalProps> = ({
  sprints,
  availableTasks,
  initialTask,
  defaultSprintId,
  initialSprintId,
  onClose,
  onSubmit,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [isClosing, setIsClosing] = useState(false);
  const [dependencySearchQuery, setDependencySearchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const confirmDialog = useConfirmDialog();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isDirty, isSubmitting }
  } = useForm<{
    sprintId: string;
    title: string;
    description: string;
    promptMarkdown: string;
    status: TaskStatus;
    priority: TaskPriority;
    executorType: TaskExecutorType;
    dependsOnTaskIds: string[];
  }>({
    mode: 'onBlur',
    reValidateMode: 'onChange',
    defaultValues: {
      sprintId: initialTask?.sprintId || defaultSprintId || initialSprintId || sprints[0]?.id || "",
      title: initialTask?.title || "",
      description: initialTask?.description || "",
      promptMarkdown: initialTask?.promptMarkdown || "",
      status: initialTask?.status || "pending",
      priority: initialTask?.priority || "medium",
      executorType: initialTask?.executorType || "auto",
      dependsOnTaskIds: initialTask?.dependsOnTaskIds || [],
    }
  });

  const sprintId = watch("sprintId");
  const title = watch("title");
  const description = watch("description");
  const promptMarkdown = watch("promptMarkdown");
  const status = watch("status");
  const priority = watch("priority");
  const executorType = watch("executorType");
  const dependsOnTaskIds = watch("dependsOnTaskIds");


  useLayoutEffect(() => {
    const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
    const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
    gsap.fromTo(cardRef.current,
      { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
      { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease }
    );
  }, [reducedMotion]);

  const executeClose = () => {
    setIsClosing(true);
    const d = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
    gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration: d, ease: MODAL_MOTION.exit.ease });
    gsap.to(backdropRef.current, { opacity: 0, duration: d, delay: reducedMotion ? 0 : 0.05, onComplete: onClose });
  };

  const handleClose = async () => {
    if (isSubmitting) return;
    if (isDirty) {
      const confirmed = await confirmDialog.requestConfirm({
        title: "Discard changes?",
        body: "You have unsaved changes. Are you sure you want to discard them?",
        destructive: true,
        confirmLabel: "Discard",
        cancelLabel: "Cancel"
      });
      if (confirmed) {
        executeClose();
      }
    } else {
      executeClose();
    }
  };

  const backdropRef = useFocusTrap(!isClosing, { onClose: () => handleClose(), restoreFocus: true });


  const dependencyOptions = useMemo(() => {
    return availableTasks.filter((task) => {
      if (task.sprintId !== sprintId) return false;
      if (task.recordId === initialTask?.recordId) return false;
      if (dependencySearchQuery) {
        const query = dependencySearchQuery.toLowerCase();
        const matchesId = task.id ? task.id.toLowerCase().includes(query) : false;
        const matchesRecordId = task.recordId.toLowerCase().includes(query);
        const matchesTitle = task.title.toLowerCase().includes(query);
        return matchesId || matchesRecordId || matchesTitle;
      }
      return true;
    });
  }, [availableTasks, initialTask?.recordId, sprintId, dependencySearchQuery]);

  const handleBackdropClick = (event: PointerEvent) => {
    if (event.target === backdropRef.current) {
      handleClose();
    }
  };

  const onSubmitForm = async (data: any) => {
    setError(null);
    try {
      await onSubmit({
        sprintId: data.sprintId,
        title: data.title.trim(),
        description: data.description.trim(),
        promptMarkdown: data.promptMarkdown.trim(),
        status: data.status,
        priority: data.priority,
        executorType: data.executorType,
        dependsOnTaskIds: data.dependsOnTaskIds,
      });
      executeClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleDependency = (taskId: string) => {
    setValue("dependsOnTaskIds", dependsOnTaskIds.includes(taskId) ? dependsOnTaskIds.filter(id => id !== taskId) : [...dependsOnTaskIds, taskId], { shouldDirty: true });
  };

  return (
    <div
      ref={backdropRef}
      onPointerDown={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-task-modal-title"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
    >
      <div
        ref={cardRef}
        className="relative w-full max-w-4xl overflow-hidden rounded-[2.5rem] shadow-[0_48px_96px_rgba(0,0,0,0.25)] dark:shadow-[0_48px_96px_rgba(0,0,0,0.7)] flex"
      >
        <div className="relative w-56 shrink-0 bg-void-900 dark:bg-void-950 flex flex-col justify-between p-8 overflow-hidden">
          <span className="absolute -top-2 -left-4 text-[7.5rem] font-black text-white/[0.035] font-display leading-none pointer-events-none select-none tracking-tighter">
            {initialTask ? "EDIT" : "TASK"}
          </span>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-44 h-44 bg-signal-500/[0.08] animate-organic" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
            <div className="absolute w-28 h-28 bg-signal-500/[0.14] animate-organic-reverse" style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }} />
          </div>
          <div className="relative z-10 flex items-center gap-2 text-signal-500 font-mono font-bold text-[10px] tracking-[0.2em] uppercase">
            <ListChecks className="w-3.5 h-3.5" strokeWidth={2.5} />
            {initialTask ? "Update Task" : "New Task"}
          </div>
          <div className="relative z-10">
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-white/25 font-mono mb-1.5">Workflow</div>
            <div className="text-4xl font-black text-white font-display tracking-tight leading-none">
              {status.replace("_", " ")}
            </div>
            <div className="mt-3 w-8 h-[2px] bg-signal-500/50" />
          </div>
        </div>

        <div className="flex-1 bg-white/98 dark:bg-void-800/98 p-8 flex flex-col">
          <div className="flex items-start justify-between mb-8">
            <div>
              <h2 id="add-task-modal-title" className="text-[2rem] font-black text-slate-900 dark:text-white tracking-tight font-display leading-none">
                {initialTask ? "Edit Task." : "Create Task."}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                Define sprint scope, execution prompt, and dependencies.
              </p>
            </div>
            <button
              onClick={handleClose}
              aria-label="Close"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit(onSubmitForm)} className="flex flex-col gap-6">
            {error && (
              // form errors demand immediate user attention to proceed.
              <div role="alert" aria-live="assertive" id="task-form-error" className="flex items-center gap-2 text-status-red text-sm font-bold bg-status-red/5 dark:bg-status-red/10 px-4 py-2.5 rounded-xl border border-status-red/20 animate-in fade-in slide-in-from-top-1">
                <AlertCircle className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                <span>Error: {error}</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="group/field">
                <label htmlFor="add-task-sprint" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Sprint</label>
                <select
                  id="add-task-sprint"
                  {...register("sprintId", { required: "Sprint is required.", onChange: () => error && setError(null) })}
                  disabled={isSubmitting}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500"
                  aria-invalid={!!errors.sprintId}
                  aria-describedby={errors.sprintId ? "task-sprint-error" : undefined}
                >
                  <option value="" disabled>Select sprint</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </select>
                {errors.sprintId && <div id="task-sprint-error" className="text-xs text-status-red mt-1 font-medium">{errors.sprintId.message}</div>}
              </div>

              <div className="group/field">
                <label htmlFor="add-task-title" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Title</label>
                <input
                  id="add-task-title"
                  type="text"
                  {...register("title", { required: "Title is required.", onChange: () => error && setError(null) })}
                  disabled={isSubmitting}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500"
                  placeholder="Define the task scope"
                  aria-invalid={!!errors.title}
                  aria-describedby={errors.title ? "task-title-error" : undefined}
                />
                {errors.title && <div id="task-title-error" className="text-xs text-status-red mt-1 font-medium">{errors.title.message}</div>}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <fieldset>
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Status</legend>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setValue("status", option, { shouldDirty: true })} disabled={isSubmitting}
                      className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.14em] transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
                        status === option
                          ? "bg-signal-500 text-void-900 shadow-[0_2px_12px_rgba(0,224,160,0.3)]"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {option.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Priority</legend>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setValue("priority", option, { shouldDirty: true })} disabled={isSubmitting}
                      className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.14em] transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
                        priority === option
                          ? "bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset>
              <legend className="flex items-center gap-2 mb-2.5">
                <Bot className="w-3.5 h-3.5 text-signal-500" strokeWidth={2.3} />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Executor</span>
              </legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {EXECUTOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setValue("executorType", option.value, { shouldDirty: true })} disabled={isSubmitting}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 ${
                      executorType === option.value
                        ? "border-signal-500/45 bg-signal-500/[0.08] text-signal-700 dark:text-signal-300"
                        : "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em]">{option.label}</div>
                    <div className="mt-1 text-xs leading-relaxed">{option.description}</div>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="group/field">
              <label htmlFor="add-task-description" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Description</label>
              <textarea
                id="add-task-description"
                {...register("description")}
                disabled={isSubmitting}
                className="mt-2.5 w-full min-h-[110px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none"
                placeholder="Summarize the intent and outcome."
              />
            </div>

            <div className="group/field">
              <label htmlFor="add-task-prompt" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Execution Prompt</label>
              <textarea
                id="add-task-prompt"
                {...register("promptMarkdown")}
                disabled={isSubmitting}
                className="mt-2.5 w-full min-h-[150px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none font-mono"
                placeholder="Detailed markdown instructions for the agent."
              />
            </div>

            <fieldset>
              <div className="flex items-center justify-between mb-3">
                <legend className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-ember-500" strokeWidth={2.3} />
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Dependencies</span>
                </legend>
                {availableTasks.filter(t => t.sprintId === sprintId && t.recordId !== initialTask?.recordId).length > 5 && (
                  <input
                    type="search"
                    placeholder="Filter tasks..."
                    value={dependencySearchQuery}
                    onInput={(e) => setDependencySearchQuery((e.target as HTMLInputElement).value)}
                    className="w-48 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-3 py-1.5 text-xs rounded-xl focus:outline-none focus:border-ember-500 focus-visible:ring-1 focus-visible:ring-ember-500/50"
                  />
                )}
              </div>
              {dependencyOptions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-black/[0.08] dark:border-white/[0.08] px-4 py-4 text-xs text-slate-400">
                  No existing tasks in this sprint yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {dependencyOptions.map((task) => {
                    const active = dependsOnTaskIds.includes(task.recordId);
                    return (
                      <button
                        key={task.recordId}
                        type="button"
                        onClick={() => toggleDependency(task.recordId)} disabled={isSubmitting}
                        aria-pressed={active}
                        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-ember-500 ${
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
            </fieldset>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded"
              >
                Cancel
              </button>
              <Button
                type="submit"
                pending={isSubmitting}
                variant="signal"
                size="lg"
              >
                <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                {initialTask ? "Save Task" : "Create Task"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
