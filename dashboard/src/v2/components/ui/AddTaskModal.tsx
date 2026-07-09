import type { FunctionComponent } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { Check, X, ListChecks, Target, Bot, Plus } from "lucide-preact";
import type { Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import { ActionFeedbackRegion } from "./ActionFeedbackRegion.js";
import { Button } from "./Button.js";
import { Modal } from "./Modal.js";
import { FieldWrapper } from "../forms/FieldWrapper.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

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

const choiceBaseClass = "flex items-center gap-2 rounded-xl border px-3.5 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all focus-within:ring-2 disabled:cursor-not-allowed";
const srOnlyInputClass = "sr-only peer";

function selectedChoiceClass(tone: "signal" | "ember"): string {
  return tone === "signal"
    ? "border-signal-500/60 bg-signal-500/[0.12] text-signal-800 shadow-[0_2px_12px_rgba(0,224,160,0.18)] dark:text-signal-200"
    : "border-ember-500/60 bg-ember-500/[0.12] text-ember-700 shadow-[0_2px_12px_rgba(255,184,0,0.18)] dark:text-ember-300";
}

function unselectedChoiceClass(tone: "signal" | "ember"): string {
  return tone === "signal"
    ? "border-black/[0.08] bg-white/40 text-slate-500 hover:border-signal-500/35 hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-slate-200"
    : "border-black/[0.08] bg-white/40 text-slate-500 hover:border-ember-500/35 hover:text-slate-800 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-slate-200";
}

function focusFirstInvalidField(formId: string, scrollContainerId: string, reducedMotion: boolean): void {
  const firstInvalid = document.getElementById(formId)?.querySelector('[aria-invalid="true"]');
  if (!(firstInvalid instanceof HTMLElement)) return;

  firstInvalid.focus({ preventScroll: true });
  const container = document.getElementById(scrollContainerId);
  if (!container) return;

  const containerRect = container.getBoundingClientRect();
  const elementRect = firstInvalid.getBoundingClientRect();
  const targetTop = elementRect.top - containerRect.top + container.scrollTop - 20;
  const maxTop = Math.max(0, container.scrollHeight - container.clientHeight);
  container.scrollTo({ top: Math.min(Math.max(targetTop, 0), maxTop), behavior: reducedMotion ? "auto" : "smooth" });
}

export const AddTaskModal: FunctionComponent<AddTaskModalProps> = ({
  sprints,
  availableTasks,
  initialTask,
  defaultSprintId,
  initialSprintId,
  onClose,
  onSubmit,
}) => {
  const fieldsRef = useRef<HTMLFormElement>(null);
  const reducedMotion = useReducedMotion();
  const [sprintId, setSprintId] = useState(initialTask?.sprintId || defaultSprintId || initialSprintId || sprints[0]?.id || "");
  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [promptMarkdown, setPromptMarkdown] = useState(initialTask?.promptMarkdown || "");
  const [status, setStatus] = useState<TaskStatus>(initialTask?.status || "pending");
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority || "medium");
  const [executorType, setExecutorType] = useState<TaskExecutorType>(initialTask?.executorType || "auto");
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>(initialTask?.dependsOnTaskIds || []);
  const { feedback, setPending, setSuccess, setError, clearFeedback, clearError } = useActionFeedback();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({ sprintId: false, title: false });
  const [dependencySearchQuery, setDependencySearchQuery] = useState("");
  const [dependencySelectionAnnouncement, setDependencySelectionAnnouncement] = useState("");


  const validationErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!sprintId) errors.sprintId = "Sprint is required.";
    if (!title.trim()) errors.title = "Title is required.";
    return errors;
  }, [sprintId, title]);


  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
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

  const totalDependencyCount = useMemo(
    () => availableTasks.filter(t => t.sprintId === sprintId && t.recordId !== initialTask?.recordId).length,
    [availableTasks, initialTask?.recordId, sprintId],
  );

  const dependencyLiveMessage = dependencySearchQuery.trim()
    ? `${dependencyOptions.length} dependency result${dependencyOptions.length === 1 ? "" : "s"} match "${dependencySearchQuery}". ${dependsOnTaskIds.length} selected.`
    : `${totalDependencyCount} dependency option${totalDependencyCount === 1 ? "" : "s"} available. ${dependsOnTaskIds.length} selected.`;
  const dependencySearchIsEmpty = dependencySearchQuery.trim().length > 0 && dependencyOptions.length === 0;
  const taskSubmitDisabledReason = isSubmitting
    ? "Task submission is in progress. Wait for it to finish or retry if it fails."
    : undefined;


  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (Object.keys(validationErrors).length > 0) {
      setTouched({ sprintId: true, title: true });
      setError(`Review required fields: ${Object.values(validationErrors).join(" ")}`, { autoDismiss: false });
      setTimeout(() => focusFirstInvalidField('add-task-form', 'add-task-form-body', reducedMotion), 0);
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
      setIsSubmitting(false);
      setSuccess("Task saved successfully.", { autoDismiss: false });
      window.setTimeout(() => onClose(), 700);
    } catch (err) {
      setIsSubmitting(false);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg, { retryAction: () => fieldsRef.current?.requestSubmit(), retryLabel: "Retry", autoDismiss: false });
    }
  };

  const toggleDependency = (task: Task) => {
    setDependsOnTaskIds((current) => {
      const isSelected = current.includes(task.recordId);
      setDependencySelectionAnnouncement(`${task.title} ${isSelected ? "removed from" : "added to"} dependencies.`);
      return isSelected
        ? current.filter((dependencyId) => dependencyId !== task.recordId)
        : [...current, task.recordId];
    });
  };

  return (
    <Modal
      isOpen={true}
      onClose={handleClose}
      ariaLabelledBy="add-task-modal-title"
      className="w-[calc(100vw-2rem)] sm:w-full max-w-4xl !p-0 rounded-2xl !overflow-hidden flex flex-col"
    >
      <div
        className="relative w-full flex-col sm:flex-row flex-1 min-h-0 flex"
      >
        <div className="relative hidden sm:flex w-56 shrink-0 bg-void-900 dark:bg-void-950 flex-col justify-between p-8 overflow-hidden">
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

        <div className="flex-1 bg-white/98 dark:bg-void-800/98 flex flex-col min-w-0">
          <div className="flex items-start justify-between shrink-0 p-5 sm:p-7 lg:px-8 lg:pt-8 lg:pb-6 border-b border-black/[0.04] dark:border-white/[0.04]">
            <div>
              <h2 id="add-task-modal-title" className="text-2xl font-semibold text-slate-900 dark:text-white tracking-tight font-display leading-none">
                {initialTask ? "Edit Task." : "Create Task."}
              </h2>
              <p className="text-xs font-medium text-slate-400 mt-2 tracking-wide">
                Define sprint scope, execution prompt, and dependencies.
              </p>
            </div>
            <button
              onClick={handleClose}
              aria-label="Close dialog"
              disabled={isSubmitting}
              aria-describedby={taskSubmitDisabledReason ? "add-task-submit-disabled-reason" : undefined}
              title={taskSubmitDisabledReason}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500"
            >
              <X aria-hidden="true" className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 sm:p-7 lg:px-8 lg:py-6" id="add-task-form-body">
            <form ref={fieldsRef} id="add-task-form" onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
            <ActionFeedbackRegion status={feedback.status} message={feedback.message} onDismiss={clearFeedback} clearError={clearError} autoDismiss={feedback.autoDismiss} retryAction={feedback.retryAction} retryLabel={feedback.retryLabel} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <FieldWrapper label="Sprint" required error={validationErrors.sprintId} forceTouch={touched.sprintId} announceError={false}>
                <select
                  id="add-task-sprint"
                  value={sprintId}
                  onInput={(event) => {
                    setSprintId((event.target as HTMLSelectElement).value);
                    if (feedback.status === "error") clearError();
                  }}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500"
                  onBlur={() => setTouched(prev => ({ ...prev, sprintId: true }))}
                  required
                >
                  <option value="" disabled>Select sprint</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </select>
              </FieldWrapper>

              <FieldWrapper label="Title" required error={validationErrors.title} forceTouch={touched.title} announceError={false}>
                <input
                  id="add-task-title"
                  type="text"
                  value={title}
                  onInput={(event) => {
                    setTitle((event.target as HTMLInputElement).value);
                    if (feedback.status === "error") clearError();
                  }}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500"
                  placeholder="Define the task scope"
                  required
                  onBlur={() => setTouched(prev => ({ ...prev, title: true }))}
                />
              </FieldWrapper>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <fieldset>
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Status</legend>
                <div role="radiogroup" aria-label="Status" className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {STATUS_OPTIONS.map((option) => (
                    <label
                      key={option}
                      className={`${choiceBaseClass} cursor-pointer focus-within:ring-signal-500 ${status === option ? selectedChoiceClass("signal") : unselectedChoiceClass("signal")} has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50`}
                    >
                      <input
                        type="radio"
                        name="task-status"
                        value={option}
                        checked={status === option}
                        disabled={isSubmitting}
                        onChange={() => setStatus(option)}
                        className={srOnlyInputClass}
                      />
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${status === option ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                      {option.replace("_", " ")}
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 block mb-2.5">Priority</legend>
                <div role="radiogroup" aria-label="Priority" className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {PRIORITY_OPTIONS.map((option) => (
                    <label
                      key={option}
                      className={`${choiceBaseClass} cursor-pointer focus-within:ring-ember-500 ${priority === option ? selectedChoiceClass("ember") : unselectedChoiceClass("ember")} has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50`}
                    >
                      <input
                        type="radio"
                        name="task-priority"
                        value={option}
                        checked={priority === option}
                        disabled={isSubmitting}
                        onChange={() => setPriority(option)}
                        className={srOnlyInputClass}
                      />
                      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${priority === option ? "bg-ember-500" : "bg-slate-300 dark:bg-slate-600"}`} />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            <fieldset>
              <legend className="flex items-center gap-2 mb-2.5">
                <Bot className="w-3.5 h-3.5 text-signal-500" strokeWidth={2.3} />
                <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Executor</span>
              </legend>
              <div role="radiogroup" aria-label="Executor" className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {EXECUTOR_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all focus-within:ring-2 focus-within:ring-signal-500 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${
                      executorType === option.value
                        ? "border-signal-500/50 bg-signal-500/[0.1] text-signal-700 dark:text-signal-300"
                        : "border-black/[0.08] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] text-slate-500 dark:text-slate-400 hover:border-signal-500/30"
                    }`}
                  >
                    <input
                      type="radio"
                      name="task-executor"
                      value={option.value}
                      checked={executorType === option.value}
                      disabled={isSubmitting}
                      onChange={() => setExecutorType(option.value)}
                      className={srOnlyInputClass}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em]">{option.label}</div>
                      <span aria-hidden="true" className={`h-3 w-3 rounded-full border ${executorType === option.value ? "border-signal-500 bg-signal-500" : "border-slate-300 dark:border-slate-600"}`} />
                    </div>
                    <div className="mt-1 text-xs leading-relaxed">{option.description}</div>
                  </label>
                ))}
              </div>
            </fieldset>

            <FieldWrapper label="Description">
              <textarea
                id="add-task-description"
                value={description}
                onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[110px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none"
                placeholder="Summarize the intent and outcome."
              />
            </FieldWrapper>

            <FieldWrapper label="Execution Prompt">
              <textarea
                id="add-task-prompt"
                value={promptMarkdown}
                onInput={(event) => setPromptMarkdown((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[150px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500 resize-none font-mono"
                placeholder="Detailed markdown instructions for the agent."
              />
            </FieldWrapper>

            <fieldset>
              <div className="flex items-center justify-between mb-3">
                <legend className="flex items-center gap-2">
                  <Target className="w-3.5 h-3.5 text-ember-500" strokeWidth={2.3} />
                  <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">Dependencies</span>
                </legend>
                {availableTasks.filter(t => t.sprintId === sprintId && t.recordId !== initialTask?.recordId).length > 5 && (
                  <div>
                    <label htmlFor="dependency-search" className="sr-only">Filter dependencies</label>
                    <input
                      id="dependency-search"
                      type="search"
                      placeholder="Filter tasks..."
                      value={dependencySearchQuery}
                      onInput={(e) => setDependencySearchQuery((e.target as HTMLInputElement).value)}
                      aria-describedby="dependency-result-count"
                      className="w-48 bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-3 py-1.5 text-xs rounded-xl focus:outline-none focus:border-ember-500 focus-visible:ring-1 focus-visible:ring-ember-500/50"
                    />
                  </div>
                )}
              </div>
              <div
                id="dependency-result-count"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className={`mb-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
                  dependencySearchIsEmpty
                    ? "border-status-amber/30 bg-status-amber/[0.06] text-status-amber"
                    : "border-black/[0.06] bg-black/[0.025] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400"
                }`}
              >
                {dependencyLiveMessage}
              </div>
              <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {dependencySelectionAnnouncement}
              </div>
              {dependencyOptions.length === 0 ? (
                <div role="status" aria-live="polite" className="rounded-2xl border border-dashed border-black/[0.08] dark:border-white/[0.08] px-4 py-4 text-xs text-slate-400">
                  {totalDependencyCount === 0
                    ? "No existing tasks in this sprint yet."
                    : `No dependency results match "${dependencySearchQuery.trim()}". Clear the filter to show ${totalDependencyCount} available option${totalDependencyCount === 1 ? "" : "s"}.`}
                </div>
              ) : (
                <div role="group" aria-label="Dependency choices" className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-1">
                  {dependencyOptions.map((task) => {
                    const active = dependsOnTaskIds.includes(task.recordId);
                    return (
                      <label
                        key={task.recordId}
                        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all focus-within:ring-2 focus-within:ring-ember-500 cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 ${
                          active
                            ? "border-ember-500/50 bg-ember-500/[0.1] text-ember-700 dark:text-ember-300"
                            : "border-black/[0.07] dark:border-white/[0.07] bg-black/[0.02] dark:bg-white/[0.02] text-slate-500 hover:border-ember-500/30"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={isSubmitting}
                          onChange={() => toggleDependency(task)}
                          className={srOnlyInputClass}
                        />
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-mono uppercase tracking-[0.14em] text-slate-400">{task.id}</span>
                            <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${task.priority === 'critical' ? 'bg-red-500/10 text-red-500' : task.priority === 'high' ? 'bg-orange-500/10 text-orange-500' : 'bg-slate-500/10 text-slate-500'}`}>
                              {task.priority}
                            </span>
                          </div>
                          <div className="text-sm font-semibold truncate leading-tight">{task.title}</div>
                        </div>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] ${
                          active
                            ? "border-ember-500 bg-ember-500 text-void-900"
                            : "border-slate-300 text-slate-400 dark:border-slate-600"
                        }`}>
                          {active && <Check aria-hidden="true" className="h-3 w-3" strokeWidth={3} />}
                          {active ? "Selected" : "Add"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </fieldset>

            </form>
          </div>
          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between shrink-0 p-5 sm:p-7 lg:px-8 lg:py-6 border-t border-black/[0.04] dark:border-white/[0.04] bg-white/50 dark:bg-void-800/50 gap-3">
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                aria-describedby={taskSubmitDisabledReason ? "add-task-submit-disabled-reason" : undefined}
                title={taskSubmitDisabledReason}
                className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 rounded disabled:opacity-50 disabled:cursor-not-allowed py-2 sm:py-0 w-full sm:w-auto"
              >
                Cancel
              </button>
              <Button
                type="submit"
                form="add-task-form"
                pending={isSubmitting}
                disabledReason={taskSubmitDisabledReason}
                variant="signal"
                size="lg"
                className="w-full sm:w-auto"
              >
                <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                {initialTask ? "Save Task" : "Create Task"}
              </Button>
              <span id="add-task-submit-disabled-reason" className="sr-only">
                {taskSubmitDisabledReason}
              </span>
            </div>
        </div>
      </div>
    </Modal>
  );
};
