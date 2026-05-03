import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "preact/hooks";
import gsap from "gsap";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  ListChecks,
  ChevronDown,
  CheckCircle2,
  Circle,
  PlayCircle,
  Clock,
  FolderGit2,
  Flame,
  Target,
  Settings,
  Trash2,
  Plus,
  X,
  ArrowUpRight,
  AlertCircle,
} from "lucide-preact";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { TaskComposer } from "./components/ui/TaskComposer.js";
import { buildDependentTasksMap, type DependentTaskMetadata } from "./lib/task-relations.js";
import type { Sprint, Task, TaskPriority, TaskStatus } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import { useSprints } from "../hooks/useSprints.js";
import { useProjectTasks } from "./hooks/use-project-tasks.js";
import { VirtualizedItem } from "./components/ui/VirtualizedItem.js";
import { createTask, deleteTask, updateTask } from "./lib/project-api.js";
import { deriveTaskBoardState } from "./lib/task-board-state.js";
import { DEFAULT_LIST_WINDOW, type ListWindowOption } from "./lib/list-window.js";
import { ListWindowSelector } from "./components/ui/ListWindowSelector.js";
import { SkeletonCard } from "./components/ui/ListSkeletons.js";
import { FilterStrip } from "./components/ui/FilterStrip.js";
import { formatSprintDisplay } from "./lib/format-sprint.js";
import { KanbanTaskCard } from "./components/tasks/KanbanTaskCard.js";
import { STATUS_CFG } from "./lib/tasks-constants.js";
import { buildTaskCardViewModel } from "./lib/tasks/task-card-view-model.js";

const STATUS_ORDER: TaskStatus[] = ["pending", "in_progress", "coding_completed", "QA_REVIEW_FAILED", "completed"];

type StatusFilter = "all" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;

const ColumnHeader: FunctionComponent<{ status: TaskStatus; count: number }> = memo(({ status, count }) => {
  const cfg = STATUS_CFG[status];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2.5">
        <Icon className={`w-5 h-5 ${cfg.color}`} strokeWidth={2} />
        <span className={`text-sm font-bold tracking-tight ${cfg.color}`}>{cfg.label}</span>
      </div>
      <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.04] ${cfg.color}`}>
        {count}
      </span>
    </div>
  );
});

const SprintSelector: FunctionComponent<{
  sprints: Sprint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}> = memo(({ sprints, selectedId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const selected = selectedId ? sprints.find((sprint: Sprint) => sprint.id === selectedId) : null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((current) => !current)}
        className={`group flex items-center gap-3 px-5 py-3 rounded-2xl border transition-all duration-300 ${
          selected
            ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08] border-ember-500/20 dark:border-ember-500/25 shadow-[0_0_20px_rgba(255,184,0,0.06)]"
            : "bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]"
        } hover:border-ember-500/40 dark:hover:border-ember-500/40`}
      >
        <Target className={`w-4 h-4 ${selected ? "text-ember-500" : "text-slate-400"} transition-colors`} strokeWidth={2} />
        <span className={`text-sm font-bold tracking-tight ${selected ? "text-ember-600 dark:text-ember-400" : "text-slate-600 dark:text-slate-400"}`}>
          {selected ? formatSprintDisplay(selected) : "All Sprints"}
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-80 z-50 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden">
          <button
            onClick={() => { onSelect(null); setOpen(false); }}
            className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200 ${
              !selectedId ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            }`}
          >
            <ListChecks className="w-4 h-4 text-signal-500" strokeWidth={2} />
            <div className="flex-1">
              <span className="text-sm font-bold text-slate-800 dark:text-white">All Sprints</span>
            </div>
          </button>

          <div className="h-px bg-black/[0.04] dark:bg-white/[0.04]" />

          {sprints.map((sprint) => {
            const isActive = selectedId === sprint.id;
            return (
              <button
                key={sprint.id}
                onClick={() => { onSelect(sprint.id); setOpen(false); }}
                className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200 ${
                  isActive ? "bg-ember-500/[0.06] dark:bg-ember-500/[0.08]" : "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
                }`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  sprint.status === "running" ? "bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] animate-pulse" :
                  sprint.status === "paused" ? "bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.45)]" :
                  sprint.status === "completed" ? "bg-signal-500" :
                  sprint.status === "failed" ? "bg-status-red" :
                  sprint.status === "cancelled" ? "bg-slate-400 dark:bg-slate-500" :
                  "bg-slate-400 dark:bg-slate-600"
                }`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-bold tracking-tight ${isActive ? "text-ember-600 dark:text-ember-400" : "text-slate-800 dark:text-white"}`}>
                    {formatSprintDisplay(sprint)}
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.date}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-[10px] font-mono font-bold text-slate-500">{sprint.tasksCount}</span>
                  <div className="w-12 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                    <div className="h-full rounded-full bg-signal-500 transition-all duration-500" style={{ width: `${sprint.completion}%` }} />
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

const SprintProgressCard: FunctionComponent<{
  sprint: { id: string; name: string; date: string };
  tasks: Task[];
}> = memo(({ sprint, tasks }) => {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const inProgress = tasks.filter((task) => task.status === "in_progress").length;
  const pending = tasks.filter((task) => task.status === "pending").length;
  const total = tasks.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      <div aria-hidden className="absolute -right-4 -bottom-6 text-[6rem] font-black tracking-tighter text-black/[0.025] dark:text-white/[0.02] pointer-events-none select-none font-display leading-none">
        {pct}%
      </div>

      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-ember-500/[0.1] dark:bg-ember-500/[0.15] flex items-center justify-center">
          <Target className="w-5 h-5 text-ember-500" strokeWidth={2} />
        </div>
        <div>
          <h3 className="text-lg font-black font-display tracking-tight text-slate-900 dark:text-white">{sprint.name}</h3>
          <p className="text-[10px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.date}</p>
        </div>
      </div>

      <div 
        className="flex gap-1 h-2.5 rounded-full overflow-hidden mb-5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Sprint progress: ${pct}%`}
      >
        {completed > 0 && <div className="bg-status-green rounded-full transition-all duration-700" style={{ width: `${(completed / total) * 100}%` }} />}
        {inProgress > 0 && <div className="bg-signal-500 rounded-full transition-all duration-700" style={{ width: `${(inProgress / total) * 100}%` }} />}
        {pending > 0 && <div className="bg-slate-200 dark:bg-slate-700 rounded-full transition-all duration-700" style={{ width: `${(pending / total) * 100}%` }} />}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Completed", value: completed, color: "text-status-green" },
          { label: "Running", value: inProgress, color: "text-signal-500" },
          { label: "Queued", value: pending, color: "text-slate-400" },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col items-center py-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.04]">
            <span className={`text-xl font-black font-mono leading-none ${color}`}>{value}</span>
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 mt-1">{label}</span>
          </div>
        ))}
      </div>

      <Link
        to="/sprints"
        className="flex items-center gap-1.5 mt-5 pt-4 border-t border-black/[0.05] dark:border-white/[0.04] text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 hover:text-ember-500 transition-colors duration-200 group/link"
      >
        <ArrowUpRight className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform duration-200" strokeWidth={2.5} />
        View Sprint
      </Link>
    </div>
  );
});

export const TasksPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { projects, selectedProject } = useProjectData();
  const {
    data: sprints,
    loading: sprintsLoading,
    selectedSprintId,
    selectSprint,
    refetch: refreshSprints,
  } = useSprints(selectedProject?.id || null);
  const locationSearch = useRouterState({ select: (state) => state.location.searchStr });
  const initialSprint = useMemo(() => {
    const params = new URLSearchParams(locationSearch);
    return params.get("sprint");
  }, [locationSearch]);
  const routeSprintId = useMemo(() => {
    if (!initialSprint) {
      return null;
    }
    return sprints.some((sprint: Sprint) => sprint.id === initialSprint) ? initialSprint : null;
  }, [initialSprint, sprints]);
  const taskScopeSprintId = routeSprintId ?? selectedSprintId;
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [listWindow, setListWindow] = useState<ListWindowOption>(DEFAULT_LIST_WINDOW);
  const [showComposer, setShowComposer] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([]);
  const composerRef = useRef<HTMLDivElement>(null);

  const { tasks, loading, error, refresh: refreshTasks } = useProjectTasks(
    selectedProject?.id || null,
    projects,
    sprints,
    taskScopeSprintId
  );

  const [showSkeletons, setShowSkeletons] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);

  useEffect(() => {
    let timeoutId: number;
    if (loading) {
      setIsFadingOut(false);
      timeoutId = window.setTimeout(() => setShowSkeletons(true), 200);
    } else {
      if (showSkeletons && boardRef.current) {
        setIsFadingOut(true);
        const skeletonCards = Array.from(boardRef.current.querySelectorAll(".skeleton-card-entry"));
        if (skeletonCards.length > 0) {
          gsap.to(skeletonCards, {
            opacity: 0,
            y: -10,
            duration: 0.3,
            stagger: 0.05,
            ease: "power2.in",
            onComplete: () => {
              setShowSkeletons(false);
              setIsFadingOut(false);
            }
          });
        } else {
          setShowSkeletons(false);
          setIsFadingOut(false);
        }
      } else {
        setShowSkeletons(false);
      }
    }
    return () => window.clearTimeout(timeoutId);
  }, [loading, showSkeletons]);

  useLayoutEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(Array.from(headerRef.current.children), { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 });
    }
  }, []);

  useLayoutEffect(() => {
    if (boardRef.current && !loading && !showSkeletons && !isFadingOut) {
      const taskCards = Array.from(boardRef.current.querySelectorAll(".task-card-entry"));
      if (taskCards.length > 0) {
        gsap.fromTo(taskCards, { opacity: 0, y: 15, scale: 0.98 }, {
          opacity: 1,
          y: 0,
          scale: 1,
          stagger: { amount: 0.2, from: "start" },
          duration: 0.6,
          ease: "power2.out",
          delay: 0.05,
        });
      }
    }
  }, [selectedProject?.id, statusFilter, priorityFilter, taskScopeSprintId, loading, showSkeletons, isFadingOut]);

  const allTasks = useMemo(() => [...optimisticTasks, ...tasks], [optimisticTasks, tasks]);
  const taskLookup = useMemo(() => new Map(allTasks.map(t => [t.recordId, t])), [allTasks]);

  const { filteredTasks, visibleTasks, stats, columns } = useMemo(() => {
    return deriveTaskBoardState(allTasks, statusFilter, priorityFilter, listWindow);
  }, [allTasks, statusFilter, priorityFilter, listWindow]);

  const taskViewModels = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildTaskCardViewModel>>();
    allTasks.forEach(task => {
      map.set(task.recordId, buildTaskCardViewModel(task, taskLookup));
    });
    return map;
  }, [allTasks, taskLookup]);

  const selectedSprintModel = taskScopeSprintId ? sprints.find((sprint: Sprint) => sprint.id === taskScopeSprintId) || null : null;

  const handleSprintScopeSelect = useCallback((sprintId: string | null) => {
    const params = new URLSearchParams(locationSearch);
    if (params.has("sprint")) {
      if (sprintId) {
        params.set("sprint", sprintId);
      } else {
        params.delete("sprint");
      }
      const nextSearch = params.toString();
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", nextUrl);
    }
    void selectSprint(sprintId);
  }, [locationSearch, selectSprint]);

  const handleTaskSubmit = useCallback(async (draft: {
    sprintId: string;
    title: string;
    description: string;
    promptMarkdown: string;
    status: TaskStatus;
    priority: TaskPriority;
    executorType: Task["executorType"];
    dependsOnTaskIds: string[];
  }) => {
    if (!selectedProject) return;

    const isEditing = !!editingTask;
    const optId = `opt-${Date.now()}`;

    if (!isEditing) {
      const optimisticTask: Task = {
        recordId: optId,
        id: "OPT-...",
        source: "dash",
        sprint: sprints.find((s: Sprint) => s.id === draft.sprintId)?.name || "...",
        sprintId: draft.sprintId,
        title: draft.title,
        status: draft.status,
        priority: draft.priority,
        executorType: draft.executorType,
        assignee: "Pending",
        time: "...",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        promptMarkdown: draft.promptMarkdown,
        description: draft.description,
        dependsOnTaskIds: draft.dependsOnTaskIds,
        isIndependent: false,
        isMerged: false,
        mergeIndicator: null,
        isOptimistic: true,
      };
      setOptimisticTasks((prev) => [optimisticTask, ...prev]);
    }

    try {
      if (isEditing) {
        await updateTask(editingTask.recordId, draft);
      } else {
        await createTask(selectedProject.id, draft);
      }
      await Promise.all([refreshTasks(), refreshSprints()]);
      setEditingTask(null);
      setShowComposer(false);
    } finally {
      if (!isEditing) {
        setOptimisticTasks((prev) => prev.filter((t) => t.recordId !== optId));
      }
    }
  }, [selectedProject, editingTask, refreshTasks, refreshSprints, sprints]);

  const handleDeleteTask = useCallback(async (task: Task) => {
    await deleteTask(task.recordId);
    await Promise.all([refreshTasks(), refreshSprints()]);
    setEditingTask((prev) => prev?.recordId === task.recordId ? null : prev);
  }, [refreshTasks, refreshSprints]);

  const handleEditClick = useCallback((nextTask: Task) => {
    setEditingTask(nextTask);
    setShowComposer(true);
    setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);

  return (
    <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">
      <div ref={headerRef} className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-2.5 text-signal-500 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
            <ListChecks className="w-3.5 h-3.5" strokeWidth={2.5} />
            Task Pipeline
          </div>

          <div className="relative overflow-hidden">
            <h2 aria-hidden className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter text-black/[0.04] dark:text-white/[0.03] pointer-events-none select-none font-display leading-none">
              FLOW
            </h2>
            <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
              Task <br />
              <span className="text-signal-500">Board.</span>
            </h1>
          </div>

          <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
            {selectedProject
              ? taskScopeSprintId
                ? `Task execution for ${selectedProject.name}, scoped to Sprint ${sprints.find((s: Sprint) => s.id === taskScopeSprintId)?.number ?? "..."}.`
                : `Task execution for ${selectedProject.name}. Showing all tasks across the project.`
              : "Select a project to manage sprint tasks."}
            {selectedProject && (statusFilter !== "all" || priorityFilter !== "all") && (
              <span className="block text-sm text-signal-600 dark:text-signal-500 mt-1">
                Filtered to show {statusFilter !== "all" ? statusFilter.replace("_", " ") : "all"} status and {priorityFilter !== "all" ? priorityFilter : "any"} priority.
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            {stats.inProgress > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-signal-500/[0.08] border border-signal-500/20 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
                <span className="w-1.5 h-1.5 rounded-full bg-signal-500 relative">
                  <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-70" />
                </span>
                {stats.inProgress} Running
              </div>
            )}
            {stats.critical > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-status-red/[0.06] border border-status-red/20 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red">
                <Flame className="w-3 h-3" strokeWidth={2.5} />
                {stats.critical} Critical
              </div>
            )}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
              <ListChecks className="w-3 h-3" strokeWidth={2} />
              {stats.total} Total
            </div>
          </div>

          <button
            onClick={() => {
              if (showComposer || editingTask) {
                setShowComposer(false);
                setEditingTask(null);
              } else {
                setShowComposer(true);
                setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }
            }}
            disabled={!selectedProject || sprints.length === 0}
            className="group flex items-center gap-2.5 px-6 py-3.5 bg-signal-500 hover:bg-signal-400 disabled:opacity-50 disabled:cursor-not-allowed text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:-translate-y-px shrink-0"
          >
            {(showComposer || editingTask) ? <X className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" strokeWidth={2.3} /> : <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" strokeWidth={2.3} />}
            {(showComposer || editingTask) ? "Close Composer" : "New Task"}
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 -mt-4">
        <SprintSelector sprints={sprints} selectedId={taskScopeSprintId} onSelect={handleSprintScopeSelect} />

        <FilterStrip
          options={[
            { value: "all", label: "All" },
            { value: "in_progress", label: "Running" },
            { value: "pending", label: "Queued" },
            { value: "completed", label: "Done" },
          ]}
          active={statusFilter}
          onChange={(val) => setStatusFilter(val as StatusFilter)}
        />

        <FilterStrip
          options={[
            { value: "all", label: "Any Priority" },
            { value: "critical", label: "Critical" },
            { value: "high", label: "High" },
            { value: "medium", label: "Medium" },
            { value: "low", label: "Low" },
          ]}
          active={priorityFilter}
          onChange={(val) => setPriorityFilter(val as PriorityFilter)}
        />

        <div className="ml-auto">
          <ListWindowSelector value={listWindow} onChange={setListWindow} label="Show" />
        </div>
      </div>

      {selectedSprintModel && (
        <div className="-mt-6">
          <SprintProgressCard sprint={selectedSprintModel} tasks={filteredTasks} />
        </div>
      )}

      {!selectedProject && (
        <div className="px-6 py-8 rounded-[1.75rem] border border-black/[0.06] dark:border-white/[0.06] bg-white/55 dark:bg-void-800/55 text-slate-500 dark:text-slate-400 text-sm max-w-xl">
          Projects, sprints, and tasks are now linked in the database. Select a project first, then create a sprint before adding tasks.
        </div>
      )}

      {error && (
        <div role="alert" className="px-6 py-4 rounded-2xl border border-status-red/20 bg-status-red/[0.06] text-status-red text-sm">
          {error}
        </div>
      )}

      {(showComposer || editingTask) && (
        <div ref={composerRef} className="scroll-mt-8">
          <TaskComposer
            key={editingTask?.recordId || "new"}
            sprints={sprints}
            availableTasks={tasks}
            initialTask={editingTask}
            initialSprintId={selectedSprintId}
            onClose={() => {
              setShowComposer(false);
              setEditingTask(null);
            }}
            onSubmit={handleTaskSubmit}
          />
        </div>
      )}

      <div ref={boardRef} className={`grid gap-6 ${
        columns.length === 1 ? "grid-cols-1" :
        columns.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
        "grid-cols-1 lg:grid-cols-3"
      }`}>
        {columns.map(({ status, count, tasks: columnTasks }) => (
          <div key={status} className="flex flex-col">
            <ColumnHeader status={status} count={count} />
            <div className="flex-1 flex flex-col gap-4 p-4 rounded-[1.5rem] min-h-[200px] bg-black/[0.015] dark:bg-white/[0.015] border border-black/[0.03] dark:border-white/[0.03]">
              {showSkeletons ? (
                <>
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </>
              ) : !loading && !isFadingOut && columnTasks.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-center p-6 text-xs font-medium text-slate-400 dark:text-slate-500 border-2 border-dashed border-black/[0.04] dark:border-white/[0.04] rounded-[1rem]">
                  No {status.replace("_", " ")} tasks
                  <br />
                  {statusFilter !== "all" || priorityFilter !== "all" ? "matching current filters" : taskScopeSprintId ? "in this sprint" : "in this project"}.
                </div>
              ) : !loading && !isFadingOut ? (
                columnTasks.map((task, index) => {
                  const viewModel = taskViewModels.get(task.recordId);
                  if (!viewModel) return null;

                  return (
                    <VirtualizedItem key={task.recordId} className="task-card-entry" defaultHeight={150}>
                      <KanbanTaskCard
                        viewModel={viewModel}
                        index={index}
                        onEdit={handleEditClick}
                        onDelete={handleDeleteTask}
                      />
                    </VirtualizedItem>
                  );
                })
              ) : null}
            </div>
          </div>
        ))}
      </div>

    </div>
  );
};
