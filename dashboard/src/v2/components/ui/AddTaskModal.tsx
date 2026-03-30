import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { X, ListChecks, Target, Bot, Plus } from "lucide-preact";
import type { Sprint, Task, TaskExecutorType, TaskPriority, TaskStatus } from "../../types.js";

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

const FOCUSABLE_SELECTOR = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const PRIORITY_OPTIONS: TaskPriority[] = ["critical", "high", "medium", "low"];
const STATUS_OPTIONS: TaskStatus[] = ["pending", "in_progress", "completed"];
const EXECUTOR_OPTIONS: Array<{ value: TaskExecutorType; label: string; description: string }> = [
  { value: "auto", label: "Auto", description: "Use the default Sprint OS routing." },
  { value: "docker_cli", label: "CLI", description: "Run through Docker or local CLI worktrees." },
  { value: "jules", label: "Jules", description: "Force remote Jules execution." },
  { value: "mcp_worker", label: "Worker", description: "Queue this task for a connected MCP worker." },
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
  const backdropRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [sprintId, setSprintId] = useState(initialTask?.sprintId || defaultSprintId || initialSprintId || sprints[0]?.id || "");
  const [title, setTitle] = useState(initialTask?.title || "");
  const [description, setDescription] = useState(initialTask?.description || "");
  const [promptMarkdown, setPromptMarkdown] = useState(initialTask?.promptMarkdown || "");
  const [status, setStatus] = useState<TaskStatus>(initialTask?.status || "pending");
  const [priority, setPriority] = useState<TaskPriority>(initialTask?.priority || "medium");
  const [executorType, setExecutorType] = useState<TaskExecutorType>(initialTask?.executorType || "auto");
  const [dependsOnTaskIds, setDependsOnTaskIds] = useState<string[]>(initialTask?.dependsOnTaskIds || []);

  useLayoutEffect(() => {
    gsap.fromTo(backdropRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" });
    gsap.fromTo(cardRef.current, { y: 40, opacity: 0, scale: 0.96 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power4.out" });
  }, []);

  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;

    // Initial focus setup
    if (cardRef.current) {
      const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];
      if (focusableElements.length > 0) {
        focusableElements[0].focus();
      }
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "Tab") {
        if (!cardRef.current) return;

        const focusableElements = Array.from(cardRef.current.querySelectorAll(FOCUSABLE_SELECTOR)) as HTMLElement[];

        if (focusableElements.length === 0) return;

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        // If focus has escaped the modal (e.g. user clicked background), force it back in
        if (!cardRef.current.contains(document.activeElement)) {
          event.preventDefault();
          first.focus();
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      if (triggerRef.current) {
        triggerRef.current.focus();
      }
    };
  }, [onClose]);

  const dependencyOptions = useMemo(() => {
    return availableTasks.filter((task) => task.sprintId === sprintId && task.recordId !== initialTask?.recordId);
  }, [availableTasks, initialTask?.recordId, sprintId]);

  const handleBackdropClick = (event: MouseEvent) => {
    if (event.target === backdropRef.current) {
      onClose();
    }
  };

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    if (!title.trim() || !sprintId) {
      return;
    }

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

    onClose();
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
      onClick={handleBackdropClick}
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
              onClick={onClose}
              aria-label="Close"
              className="w-9 h-9 flex items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-signal-500/50 bg-black/[0.05] dark:bg-white/[0.05] hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="group/field">
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Sprint</label>
                <select
                  value={sprintId}
                  onInput={(event) => setSprintId((event.target as HTMLSelectElement).value)}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus-visible:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/50"
                  required
                >
                  <option value="" disabled>Select sprint</option>
                  {sprints.map((sprint) => (
                    <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                  ))}
                </select>
              </div>

              <div className="group/field">
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Title</label>
                <input
                  type="text"
                  value={title}
                  onInput={(event) => setTitle((event.target as HTMLInputElement).value)}
                  className="mt-2.5 w-full rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 focus-visible:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/50"
                  placeholder="Define the task scope"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 block mb-2.5">Status</label>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {STATUS_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setStatus(option)}
                      className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                        status === option
                          ? "bg-signal-500 text-void-900 shadow-[0_2px_12px_rgba(0,224,160,0.3)]"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {option.replace("_", " ")}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 block mb-2.5">Priority</label>
                <div className="inline-flex p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-2xl gap-1 flex-wrap">
                  {PRIORITY_OPTIONS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setPriority(option)}
                      className={`px-3.5 py-2 rounded-xl text-[10px] font-bold uppercase tracking-[0.12em] transition-all ${
                        priority === option
                          ? "bg-ember-500 text-void-900 shadow-[0_2px_12px_rgba(255,184,0,0.3)]"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <Bot className="w-3.5 h-3.5 text-signal-500" strokeWidth={2.3} />
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Executor</label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {EXECUTOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setExecutorType(option.value)}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${
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
            </div>

            <div className="group/field">
              <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Description</label>
              <textarea
                value={description}
                onInput={(event) => setDescription((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[110px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus-visible:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/50 resize-none"
                placeholder="Summarize the intent and outcome."
              />
            </div>

            <div className="group/field">
              <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Execution Prompt</label>
              <textarea
                value={promptMarkdown}
                onInput={(event) => setPromptMarkdown((event.target as HTMLTextAreaElement).value)}
                className="mt-2.5 w-full min-h-[150px] rounded-2xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.08] dark:border-white/[0.08] px-4 py-3 text-sm text-slate-700 dark:text-slate-300 focus-visible:border-signal-500 focus-visible:ring-2 focus-visible:ring-signal-500/50 resize-none font-mono"
                placeholder="Detailed markdown instructions for the agent."
              />
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-3.5 h-3.5 text-ember-500" strokeWidth={2.3} />
                <label className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">Dependencies</label>
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
                        className={`flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
                          active
                            ? "border-ember-500/45 bg-ember-500/[0.08] text-ember-600 dark:text-ember-400"
                            : "border-black/[0.07] dark:border-white/[0.07] bg-black/[0.02] dark:bg-white/[0.02] text-slate-500"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-mono uppercase tracking-[0.14em]">{task.id}</div>
                          <div className="text-sm font-semibold truncate">{task.title}</div>
                        </div>
                        <span className={`w-4 h-4 rounded-full border ${active ? "border-ember-500 bg-ember-500" : "border-slate-300 dark:border-slate-600"}`} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onClose}
                className="text-sm font-semibold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="group/btn flex items-center gap-2.5 px-6 py-3 bg-signal-500 hover:bg-signal-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.4)] hover:-translate-y-px"
              >
                <Plus className="w-4 h-4 group-hover/btn:rotate-90 transition-transform duration-300" />
                {initialTask ? "Save Task" : "Create Task"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
