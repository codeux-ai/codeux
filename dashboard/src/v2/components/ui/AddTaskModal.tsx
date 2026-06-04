import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, ListChecks, Target, Bot, Plus, AlertCircle } from "lucide-preact";
import type { Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
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
  { value: "auto", label: "Auto", description: "Use the default Code UX routing." },
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
  const fieldsRef = useRef<HTMLFormElement>(null);
  const [sprintId, setSprintId] = useState(initialTask?.sprintId || defaultSprintId || initialSprintId || sprints[0]?.id || "");
  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [promptMarkdown, setPromptMarkdown] = useState(initialTask?.promptMarkdown || "");
  const [status, setStatus] = useState<TaskStatus>(initialTask?.status || "pending");
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority || "medium");
  const [executorType, setExecutorType] = useState<TaskExecutorType>(initialTask?.executorType || "auto");
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>(initialTask?.dependsOnTaskIds || []);
  const { feedback, setPending, setSuccess, setError, clearFeedback } = useActionFeedback();

  const reducedMotion = useReducedMotion();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [touched, setTouched] = useState({ sprintId: false, title: false });
  const shakeTargets = useRef<(HTMLDivElement | null)[]>([]);
  const [dependencySearchQuery, setDependencySearchQuery] = useState("");

  const initialTriggerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    initialTriggerRef.current = document.activeElement as HTMLElement | null;
  }, []);

  const backdropRef = useFocusTrap(!isClosing, { onClose: () => handleClose(), restoreFocus: true });

  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!sprintId) errors.sprintId = "Sprint is required.";
    if (!title.trim()) errors.title = "Title is required.";
    return errors;
  }, [sprintId, title]);

  useLayoutEffect(() => {
    const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
    const d_card = reducedMotion ? 0 : MODAL_MOTION.entry.duration;
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: d_backdrop, ease: MODAL_MOTION.backdrop.ease });
    gsap.fromTo(cardRef.current,
      { y: reducedMotion ? 0 : MODAL_MOTION.entry.yStart, opacity: MODAL_MOTION.entry.opacityStart, scale: reducedMotion ? 1 : MODAL_MOTION.entry.scaleStart, filter: reducedMotion ? MODAL_MOTION.entry.filterEnd : MODAL_MOTION.entry.filterStart },
      { y: MODAL_MOTION.entry.yEnd, opacity: MODAL_MOTION.entry.opacityEnd, scale: MODAL_MOTION.entry.scaleEnd, filter: MODAL_MOTION.entry.filterEnd, duration: d_card, ease: MODAL_MOTION.entry.ease, clearProps: "filter" }
    );
    if (fieldsRef.current) {
      gsap.fromTo(fieldsRef.current.querySelectorAll('.modal-animate-in'),
        { y: reducedMotion ? 0 : MODAL_MOTION.fieldStagger.yStart, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          stagger: reducedMotion ? 0 : MODAL_MOTION.fieldStagger.stagger,
          duration: reducedMotion ? 0 : MODAL_MOTION.fieldStagger.duration,
          ease: MODAL_MOTION.fieldStagger.ease,
          delay: reducedMotion ? 0 : MODAL_MOTION.fieldStagger.delay
        }
      );
    }
  }, [reducedMotion]);

  const handleClose = () => {
    if (isSubmitting) return;
    setIsClosing(true);
    const d_card = reducedMotion ? 0 : MODAL_MOTION.exit.duration;
    const d_backdrop = reducedMotion ? 0 : MODAL_MOTION.backdrop.duration;
    gsap.to(cardRef.current, { y: MODAL_MOTION.exit.yEnd, opacity: MODAL_MOTION.exit.opacityEnd, scale: MODAL_MOTION.exit.scaleEnd, filter: MODAL_MOTION.exit.filterEnd, duration: d_card, ease: MODAL_MOTION.exit.ease });
    gsap.to(backdropRef.current, { opacity: 0, duration: d_backdrop, delay: reducedMotion ? 0 : 0.05, onComplete: () => {
      onClose();
      if (initialTriggerRef.current) {
        initialTriggerRef.current.focus();
      }
    }});
  };

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

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (Object.keys(validationErrors).length > 0) {
      setTouched({ sprintId: true, title: true });

      const targets = shakeTargets.current.filter((el, idx) => {
        if (!el) return false;
        if (idx === 0 && validationErrors.sprintId) return true;
        if (idx === 1 && validationErrors.title) return true;
        return false;
      });

      if (targets.length > 0 && !reducedMotion) {
        gsap.fromTo(targets,
          { x: -4 },
          { x: 4, duration: 0.1, yoyo: true, repeat: 3, ease: "linear", onComplete: () => {
            gsap.set(targets, { x: 0 });
          }}
        );
      }
      return;
    }

    setIsSubmitting(true);
    clearFeedback();
    setPending("Saving task...");
    try {
      await onSubmit({
        sprintId,
        title: title.trim(),
        description: description.trim(),
        promptMarkdown: promptMarkdown.trim(),
        status,
        priority,
        executorType,
        dependsOnTaskIds,
      });
      setSuccess("Task saved successfully.");
      setIsSubmitting(false);
      handleClose();
    } catch (err) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg, { autoDismiss: false });
    }
  };

  const toggleDependency = (taskId: string) => {
    setDependsOnTaskIds((current) => (
      current.includes(taskId)
        ? current.filter((dependencyId) => dependencyId !== taskId)
        : [...current, taskId]
    ));
  };

  return (
    <div
      ref={backdropRef}
      onPointerDown={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-task-modal-title"
      className="fixed inset-0 z-[200] flex items-center justify-center px-6 bg-black/55 dark:bg-black/75 backdrop-blur-xl"
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
              disabled={isSubmitting}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form ref={fieldsRef} onSubmit={handleSubmit} className="flex flex-col gap-6">
            <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} autoDismiss={feedback.autoDismiss} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div ref={el => { shakeTargets.current[0] = el as HTMLDivElement; }} className="group/field modal-animate-in relative">
                <label htmlFor="add-task-sprint" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Sprint</label>
                <select
                  id="add-task-sprint"
                  value={sprintId}
                  onInput={(event) => {
                    setSprintId((event.target as HTMLSelectElement).value);
                    if (feedback.status === "error") clearFeedback();
                  }}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500" aria-invalid={!!validationErrors.sprintId && touched.sprintId}
                  aria-describedby={validationErrors.sprintId && touched.sprintId ? "task-sprint-error" : undefined}
                  onBlur={() => setTouched(prev => ({ ...prev, sprintId: true }))}
                  required
                >
                  <option value="" disabled>Select sprint</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </select>
                <div className="h-5 mt-1">
                  {validationErrors.sprintId && touched.sprintId && <div id="task-sprint-error" className="text-xs text-red-500 font-medium motion-safe:animate-form-slide-down">{validationErrors.sprintId}</div>}
                </div>
              </div>

              <div ref={el => { shakeTargets.current[1] = el as HTMLDivElement; }} className="group/field modal-animate-in relative">
                <label htmlFor="add-task-title" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Title</label>
                <input
                  id="add-task-title"
                  type="text"
                  value={title}
                  onInput={(event) => {
                    setTitle((event.target as HTMLInputElement).value);
                    if (feedback.status === "error") clearFeedback();
                  }}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500"
                  placeholder="Define the task scope"
                  required
                  aria-invalid={!!validationErrors.title && touched.title}
                  aria-describedby={validationErrors.title && touched.title ? "task-title-error" : undefined}
                  onBlur={() => setTouched(prev => ({ ...prev, title: true }))}

                />
                <div className="h-5 mt-1">
                  {validationErrors.title && touched.title && <div id="task-title-error" className="text-xs text-red-500 font-medium motion-safe:animate-form-slide-down">{validationErrors.title}</div>}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <fieldset className="modal-animate-in">
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Status</legend>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatus(option)}
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

              <fieldset className="modal-animate-in">
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Priority</legend>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPriority(option)}
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

            <fieldset className="modal-animate-in">
              <legend className="flex items-center gap-2 mb-2.5">
                <Bot className="w-3.5 h-3.5 text-signal-500" strokeWidth={2.3} />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Executor</span>
              </legend>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {EXECUTOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExecutorType(option.value)}
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

            <div className="group/field modal-animate-in">
              <label htmlFor="add-task-description" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Description</label>
              <textarea
                id="add-task-description"
                value={description}
                onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[110px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none"
                placeholder="Summarize the intent and outcome."
              />
            </div>

            <div className="group/field modal-animate-in">
              <label htmlFor="add-task-prompt" className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Execution Prompt</label>
              <textarea
                id="add-task-prompt"
                value={promptMarkdown}
                onInput={(event) => setPromptMarkdown((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[150px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none font-mono"
                placeholder="Detailed markdown instructions for the agent."
              />
            </div>

            <fieldset className="modal-animate-in">
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
                        onClick={() => toggleDependency(task.recordId)}
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

            <div className="flex items-center justify-between pt-2 modal-animate-in">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded disabled:opacity-50 disabled:cursor-not-allowed"
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
