// We need to define getLane since it's only in task-board-state.ts
const getLane = (status: string) => (status === "coding_completed" || status === "QA_REVIEW_FAILED") ? "in_progress" : status;

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
  ArrowRight,
  AlertCircle,
} from "lucide-preact";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import { TaskComposer } from "./components/ui/TaskComposer.js";
import { AddProjectModal } from "./components/ui/AddProjectModal.js";
import type { AddProjectModalSubmission } from "./components/ui/AddProjectModal.js";
import { buildDependentTasksMap, type DependentTaskMetadata } from "./lib/task-relations.js";
import type { Sprint, Task, TaskPriority, TaskStatus } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import { useSprints } from "../hooks/useSprints.js";
import { useProjectTasks } from "./hooks/use-project-tasks.js";
import { createTask, deleteTask, updateTask } from "./lib/project-api.js";
import { deriveTaskBoardState } from "./lib/task-board-state.js";
import { DEFAULT_LIST_WINDOW, type ListWindowOption } from "./lib/list-window.js";
import { ListWindowSelector } from "./components/ui/ListWindowSelector.js";
import { SkeletonCard, SkeletonLoader } from "./components/layout/SkeletonLoader.js";
import { FilterStrip } from "./components/ui/FilterStrip.js";
import { PageContainer } from "./components/layout/PageContainer.js";
import { formatSprintDisplay } from "./lib/format-sprint.js";
import { useProjectEffectiveSettings } from "./hooks/use-project-effective-settings.js";
import { KanbanTaskCard } from "./components/tasks/KanbanTaskCard.js";
import { Button } from "./components/ui/Button.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import type { AgentPreset } from "./types.js";
import { STATUS_CFG } from "./lib/tasks-constants.js";
import { buildTaskCardViewModel } from "./lib/tasks/task-card-view-model.js";
import { useDashboardRuntimeData } from "../hooks/use-dashboard-runtime-data.js";
import { buildLiveTaskEnrichmentMap } from "./lib/tasks/live-task-enrichment.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";

const STATUS_ORDER: TaskStatus[] = ["pending", "in_progress", "coding_completed", "QA_REVIEW_FAILED", "completed"];

type StatusFilter = "all" | TaskStatus;
type PriorityFilter = "all" | TaskPriority;
type TaskScopePlaceholderMode = "project" | "sprint";

const TaskScopePlaceholder: FunctionComponent<{
  mode: TaskScopePlaceholderMode;
  hasProjects: boolean;
  onAddProject: () => void;
}> = ({ mode, hasProjects, onAddProject }) => {
  const isProjectMode = mode === "project";
  const title = isProjectMode ? "Task work starts with a project." : "Create a sprint to unlock tasks.";
  const eyebrow = isProjectMode ? "Task Board Standby" : "Sprint Scope Required";
  const body = isProjectMode
    ? "Connect a project before the task board starts tracking queued work, active implementation, QA review, and completed delivery."
    : "Tasks are organized inside sprint scope. Create or select a sprint before adding implementation work to the board.";

  return (
    <section className="relative overflow-hidden rounded-[2.2rem] border border-black/[0.06] bg-white/72 p-8 shadow-[0_18px_48px_rgba(15,23,42,0.07)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_18px_48px_rgba(0,0,0,0.28)] md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.09),transparent_64%)] dark:bg-[radial-gradient(ellipse_72%_58%_at_48%_25%,rgba(0,224,160,0.13),transparent_64%)]" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-52 w-52 rounded-full border border-signal-500/14 animate-[ping_5.8s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-80 w-80 rounded-full border border-ember-500/10 animate-[ping_8.4s_cubic-bezier(0.1,0.5,0.8,1)_infinite]" />
        <div className="absolute h-[28rem] w-[28rem] rounded-full border border-black/[0.035] animate-[ping_11s_cubic-bezier(0.1,0.5,0.8,1)_infinite] dark:border-white/[0.04]" />
      </div>

      <div className="relative z-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
        <div>
          <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-[1.35rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_32px_rgba(0,224,160,0.16)]">
            <ListChecks className="h-7 w-7" strokeWidth={1.7} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-500">
            {eyebrow}
          </div>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-black leading-[0.98] tracking-tight text-slate-900 dark:text-white md:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400 md:text-base">
            {body}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {isProjectMode ? (
              <Button
                type="button"
                onClick={onAddProject}
                variant="signal"
                icon={Plus}
                className="!inline-flex !min-h-[44px] !items-center !gap-2.5 !rounded-full !px-5 !py-2.5 !text-[10px] !font-bold !uppercase !tracking-[0.14em] !shadow-[0_10px_30px_rgba(0,224,160,0.22)] hover:!-translate-y-px focus-visible:!ring-2 focus-visible:!ring-signal-500/40"
              >
                {hasProjects ? "Add Project" : "Add First Project"}
              </Button>
            ) : (
              <Link
                to="/sprints"
                className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full bg-signal-500 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-void-900 shadow-[0_10px_30px_rgba(0,224,160,0.22)] transition-all hover:-translate-y-px hover:bg-signal-400 focus-visible:ring-2 focus-visible:ring-signal-500/40"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />
                Plan Sprint
              </Link>
            )}
            <Link
              to={isProjectMode ? "/projects" : "/sprints"}
              className="inline-flex min-h-[44px] items-center gap-2.5 rounded-full border border-black/[0.06] bg-white/75 px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-600 transition-all hover:-translate-y-px hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:text-white"
            >
              <FolderGit2 className="h-3.5 w-3.5 text-ember-500" strokeWidth={2.1} />
              {isProjectMode ? "Manage Projects" : "Open Sprints"}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.1} />
            </Link>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.7rem] border border-black/[0.06] bg-black/[0.025] p-5 dark:border-white/[0.06] dark:bg-white/[0.035]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_85%_65%_at_50%_0%,rgba(255,184,0,0.12),transparent_68%)]" />
          <div className="relative z-10 space-y-3">
            {[
              { label: "Project", value: isProjectMode ? "required" : "ready", tone: isProjectMode ? "text-ember-500" : "text-status-green" },
              { label: "Sprint", value: isProjectMode ? "waiting" : "required", tone: isProjectMode ? "text-signal-500" : "text-ember-500" },
              { label: "Tasks", value: "locked", tone: "text-slate-500 dark:text-slate-400" },
            ].map((item, index) => (
              <div
                key={item.label}
                className="rounded-[1.15rem] border border-white/60 bg-white/72 p-4 shadow-sm dark:border-white/[0.06] dark:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{item.label}</div>
                    <div className={`mt-1 text-xs font-bold uppercase tracking-[0.12em] ${item.tone}`}>{item.value}</div>
                  </div>
                  <div className={`h-2.5 w-2.5 rounded-full ${index === 0 ? "bg-ember-500" : index === 1 ? "bg-signal-500" : "bg-slate-300 dark:bg-slate-600"}`}>
                    <span className="block h-full w-full rounded-full animate-ping bg-current opacity-40" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

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
  sprintKeyPrefix: string;
}> = memo(({ sprints, selectedId, onSelect, sprintKeyPrefix }) => {
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
          {selected ? formatSprintDisplay(selected, sprintKeyPrefix) : "All Sprints"}
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
                    {formatSprintDisplay(sprint, sprintKeyPrefix)}
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
  const { projects, selectedProject, createProject } = useProjectData();
  const projectId = selectedProject?.id || null;
  const { execution, status } = useDashboardRuntimeData(
    projectId,
    !!selectedProject,
  );
  const settings = useProjectEffectiveSettings(projectId);
  const sprintKeyPrefix = settings.data?.settings?.git?.sprintKeyPrefix || "SPR";
  const [agentPresetsMap, setAgentPresetsMap] = useState<Map<string, AgentPreset>>(new Map());
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetchAgentPresets(projectId).then(presets => {
      if (!cancelled) setAgentPresetsMap(new Map(presets.map(p => [p.id, p])));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);
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
    // Support both "sprint" and "sprintId"
    return params.get("sprintId") || params.get("sprint");
  }, [locationSearch]);
  const routeSprintId = useMemo(() => {
    if (!initialSprint) {
      return null;
    }
    return sprints.some((sprint: Sprint) => sprint.id === initialSprint) ? initialSprint : null;
  }, [initialSprint, sprints]);
  const taskScopeSprintId = routeSprintId ?? selectedSprintId;

  useEffect(() => {
    if (!routeSprintId || routeSprintId === selectedSprintId) {
      return;
    }
    void selectSprint(routeSprintId);
  }, [routeSprintId, selectedSprintId, selectSprint]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [listWindow, setListWindow] = useState<ListWindowOption>(DEFAULT_LIST_WINDOW);
  const [showComposer, setShowComposer] = useState(false);
  const [showAddProjectModal, setShowAddProjectModal] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dropTargetContext, setDropTargetContext] = useState<{ status: TaskStatus, index: number } | null>(null);
  const [optimisticTasks, setOptimisticTasks] = useState<Task[]>([]);
  const [resolvedTaskId, setResolvedTaskId] = useState<string | null>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const { tasks, loading, error, refresh: refreshTasks } = useProjectTasks(
    selectedProject?.id || null,
    projects,
    sprints,
    taskScopeSprintId
  );

  // Handle route taskId resolution for scroll-to-focus
  useEffect(() => {
    if (!loading && tasks.length > 0) {
      const params = new URLSearchParams(locationSearch);
      const taskId = params.get("taskId");
      if (taskId && tasks.some(t => t.id === taskId || t.recordId === taskId)) {
        // Find the actual recordId (in case the route passed the short ID)
        const targetTask = tasks.find(t => t.id === taskId || t.recordId === taskId);
        if (targetTask) {
          setResolvedTaskId(targetTask.recordId);
          // Clean up URL so it doesn't keep refocusing on subsequent renders
          params.delete("taskId");
          const nextSearch = params.toString();
          const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
          window.history.replaceState(window.history.state, "", nextUrl);
        }
      }
    }
  }, [locationSearch, loading, tasks]);

  const reducedMotion = useReducedMotion();
  const [showSkeletons, setShowSkeletons] = useState(false);

  useEffect(() => {
    let timeoutId: number;
    if (loading) {
      timeoutId = window.setTimeout(() => setShowSkeletons(true), 200);
    } else {
      setShowSkeletons(false);
    }
    return () => window.clearTimeout(timeoutId);
  }, [loading]);

  useLayoutEffect(() => {
    if (!headerRef.current) return;
    const ctx = gsap.context(() => {
      gsap.fromTo(Array.from(headerRef.current!.children), { opacity: 0, y: 40 }, { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 });
    });
    return () => ctx.revert();
  }, []);

  useLayoutEffect(() => {
    if (!boardRef.current || loading || showSkeletons) return;
    const taskCards = Array.from(boardRef.current.querySelectorAll(".task-card-entry"));
    if (taskCards.length === 0) return;
    const ctx = gsap.context(() => {
      if (reducedMotion) {
        gsap.set(taskCards, { opacity: 1, y: 0, scale: 1 });
      } else {
        gsap.fromTo(taskCards, { opacity: 0, y: 15, scale: 0.98 }, {
          opacity: 1,
          y: 0,
          scale: 1,
          stagger: 0.05,
          duration: 0.6,
          ease: "power2.out",
          delay: 0.05,
        });
      }
    });
    return () => ctx.revert();
  }, [selectedProject?.id, statusFilter, priorityFilter, taskScopeSprintId, loading, showSkeletons, reducedMotion]);

  useLayoutEffect(() => {
    if (!resolvedTaskId || !boardRef.current) return;
    const el = boardRef.current.querySelector(`[data-task-id="${resolvedTaskId}"] .kanban-card`) as HTMLDivElement;
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "nearest" });

    const flashEl = document.createElement("div");
    flashEl.style.position = "absolute";
    flashEl.style.inset = "0";
    flashEl.style.backgroundColor = "rgba(0, 224, 160, 0.2)";
    flashEl.style.borderRadius = "1.75rem";
    flashEl.style.pointerEvents = "none";
    flashEl.style.zIndex = "50";
    el.appendChild(flashEl);

    const ctx = gsap.context(() => {
      gsap.to(flashEl, {
        opacity: 0,
        duration: 0.4,
        ease: "power2.out",
        onComplete: () => flashEl.remove()
      });

      gsap.fromTo(el,
        {
          opacity: 0.6,
          borderWidth: "2px",
          borderColor: "rgba(148, 163, 184, 0.5)",
          borderStyle: "dashed"
        },
        {
          opacity: 1,
          borderWidth: "1px",
          borderColor: "rgba(0,0,0,0.06)", // Fallback, clearProps will remove it
          borderStyle: "solid",
          duration: 0.4,
          ease: "power2.out",
          clearProps: "opacity,borderWidth,borderStyle,borderColor"
        }
      );
    });

    setResolvedTaskId(null);
    return () => ctx.revert();
  }, [resolvedTaskId, tasks]);

  const allTasks = useMemo(() => [...optimisticTasks, ...tasks], [optimisticTasks, tasks]);
  const taskLookup = useMemo(() => new Map(allTasks.map(t => [t.recordId, t])), [allTasks]);

  const { filteredTasks, visibleTasks, stats, columns } = useMemo(() => {
    return deriveTaskBoardState(allTasks, statusFilter, priorityFilter, listWindow);
  }, [allTasks, statusFilter, priorityFilter, listWindow]);

  const scopedDispatches = useMemo(() =>
    taskScopeSprintId
      ? execution.taskDispatches.filter((d) => d.sprintId === taskScopeSprintId)
      : execution.taskDispatches,
    [execution.taskDispatches, taskScopeSprintId]
  );
  const scopedEvents = useMemo(() =>
    taskScopeSprintId
      ? execution.recentEvents.filter((e) => e.sprintId === taskScopeSprintId)
      : execution.recentEvents,
    [execution.recentEvents, taskScopeSprintId]
  );

  const liveEnrichmentMap = useMemo(
    () => buildLiveTaskEnrichmentMap(status.subtasks ?? [], scopedDispatches, scopedEvents),
    [status.subtasks, scopedDispatches, scopedEvents]
  );

  const taskViewModels = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildTaskCardViewModel>>();
    allTasks.forEach(task => {
      map.set(task.recordId, buildTaskCardViewModel(task, taskLookup, liveEnrichmentMap.get(task.recordId)));
    });
    return map;
  }, [allTasks, taskLookup, liveEnrichmentMap]);

  const selectedSprintModel = taskScopeSprintId ? sprints.find((sprint: Sprint) => sprint.id === taskScopeSprintId) || null : null;
  const isTaskScopeReady = !!selectedProject && sprints.length > 0;

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
      let createdTaskId: string | null = null;
      if (isEditing) {
        await updateTask(editingTask.recordId, draft);
      } else {
        const createdTask = await createTask(selectedProject.id, draft);
        createdTaskId = createdTask.id;
      }
      await Promise.all([refreshTasks(), refreshSprints()]);
      setEditingTask(null);
      setShowComposer(false);

      if (createdTaskId) {
        setResolvedTaskId(createdTaskId);
      }
    } finally {
      if (!isEditing) {
        setOptimisticTasks((prev) => prev.filter((t) => t.recordId !== optId));
      }
    }
  }, [selectedProject, editingTask, refreshTasks, refreshSprints, sprints]);


  const handleDragStart = useCallback((taskId: string, e: DragEvent) => {
    if (reducedMotion) return;
    setDraggedTaskId(taskId);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    // e.dataTransfer.setDragImage(new Image(), 0, 0); // optional: hide default ghost
  }, [reducedMotion]);

  const handleDragEnd = useCallback(() => {
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, []);

  const handleDragOver = useCallback((status: TaskStatus, index: number, e: any) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    setDropTargetContext({ status, index });
  }, []);

  const handleDrop = useCallback(async (status: TaskStatus, insertIndex: number, e: DragEvent) => {
    e.preventDefault();
    if (!draggedTaskId) return;

    const draggedTask = tasks.find(t => t.recordId === draggedTaskId);
    if (!draggedTask) return;

    // We don't have sortOrder on Task currently, but we might just update the status for now
    // Actually, in the task board state it usually filters by getLane(task.status).
    // Let's just update the status if it changed lane, and for reordering, update sorting if we had it.
    // For now we will just use updateTask(task.id, { status })
    // If the dropped column is 'completed', and original isn't... etc.
    const newStatus = status === "in_progress" && draggedTask.status !== "coding_completed" && draggedTask.status !== "QA_REVIEW_FAILED"
      ? "in_progress"
      : status === "pending" ? "pending" : status === "completed" ? "completed" : draggedTask.status;

    // Actually, let's just forcefully set the status to the column's default status if we moved between columns.
    const laneMap: Record<string, TaskStatus> = {
      pending: "pending",
      in_progress: "in_progress",
      completed: "completed"
    };

    // Even if it's the same lane, we should allow it.
    // However, updating the order within the same column via updateTask might not be fully supported by the API yet if it lacks an 'order' field.
    // Assuming we want to optimistically update or at least support cross-status drops in the same lane.
    if (getLane(draggedTask.status) !== status) {
      const targetStatus = laneMap[status] || draggedTask.status;

      // Optimistic update
      const updatedTask = { ...draggedTask, status: targetStatus };
      setOptimisticTasks(prev => {
        const filtered = prev.filter(t => t.recordId !== updatedTask.recordId);
        return [updatedTask, ...filtered];
      });

      try {
        await updateTask(draggedTask.recordId, { status: targetStatus });
        await refreshTasks();
      } finally {
        setOptimisticTasks(prev => prev.filter(t => t.recordId !== updatedTask.recordId));
      }
    } else {
      // Logic for reordering within the same lane
      const targetStatus = laneMap[status] || draggedTask.status;
      if (draggedTask.status !== targetStatus) {
        const updatedTask = { ...draggedTask, status: targetStatus };
        setOptimisticTasks(prev => {
          const filtered = prev.filter(t => t.recordId !== updatedTask.recordId);
          // Insert at the new index position? For now, we are just appending it at the top as an optimistic update
          return [updatedTask, ...filtered];
        });
        try {
          await updateTask(draggedTask.recordId, { status: targetStatus });
          await refreshTasks();
        } finally {
          setOptimisticTasks(prev => prev.filter(t => t.recordId !== updatedTask.recordId));
        }
      }
    }
    setDraggedTaskId(null);
    setDropTargetContext(null);
  }, [draggedTaskId, tasks, refreshTasks]);

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

  const handleAddProject = useCallback(async (project: AddProjectModalSubmission) => {
    if (project.type === 'new_project') {
      await createProject({
        name: project.name,
        sourceType: project.initMode === 'new-local' ? 'local' : 'git',
        sourceRef: project.path || project.name,
        initMode: project.initMode,
        remoteProvider: project.remoteProvider,
        isPrivate: project.isPrivate,
      });
      return;
    }

    await createProject({
      name: project.name,
      sourceType: project.type,
      sourceRef: project.path,
      cloneDir: project.cloneDir,
    });
  }, [createProject]);

  return (
    <PageContainer
      className={isTaskScopeReady ? "gap-16" : "gap-10"}
      padding={isTaskScopeReady ? "standard" : "sprintsEmpty"}
    >
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

          <Button
            onClick={() => {
              if (showComposer || editingTask) {
                setShowComposer(false);
                setEditingTask(null);
              } else {
                setShowComposer(true);
                setTimeout(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
              }
            }}
            variant="signal"
            icon={(showComposer || editingTask) ? X : Plus}
            disabled={!selectedProject || sprints.length === 0}
            className="!flex !items-center !gap-2.5 !px-6 !py-3.5 !font-bold !text-sm !rounded-2xl !transition-all !duration-300 !shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:!shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:!-translate-y-px !shrink-0"
          >
            {(showComposer || editingTask) ? "Close Composer" : "New Task"}
          </Button>
        </div>
      </div>

      {isTaskScopeReady && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 -mt-4">
          <SprintSelector sprints={sprints} selectedId={taskScopeSprintId} onSelect={handleSprintScopeSelect} sprintKeyPrefix={sprintKeyPrefix} />

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
      )}

      {isTaskScopeReady && selectedSprintModel && (
        <div className="-mt-6">
          <SprintProgressCard sprint={selectedSprintModel} tasks={filteredTasks} />
        </div>
      )}

      {!selectedProject && (
        <TaskScopePlaceholder
          mode="project"
          hasProjects={projects.length > 0}
          onAddProject={() => setShowAddProjectModal(true)}
        />
      )}

      {selectedProject && !sprintsLoading && sprints.length === 0 && (
        <TaskScopePlaceholder
          mode="sprint"
          hasProjects={projects.length > 0}
          onAddProject={() => setShowAddProjectModal(true)}
        />
      )}

      {isTaskScopeReady && error && (
        <div role="alert" className="px-6 py-4 rounded-2xl border border-status-red/20 bg-status-red/[0.06] text-status-red text-sm">
          {error}
        </div>
      )}

      {isTaskScopeReady && (showComposer || editingTask) && (
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

      {isTaskScopeReady && (
        <div ref={boardRef} className={`grid gap-6 ${
          columns.length === 1 ? "grid-cols-1" :
          columns.length === 2 ? "grid-cols-1 lg:grid-cols-2" :
          "grid-cols-1 lg:grid-cols-3"
        }`}>
          {columns.map(({ status, count, tasks: columnTasks }) => (
            <div key={status} className="flex flex-col">
              <ColumnHeader status={status} count={count} />
              <div
              className="flex-1 grid grid-cols-1 grid-rows-1 p-4 rounded-[1.5rem] min-h-[200px] bg-black/[0.015] dark:bg-white/[0.015] border border-black/[0.03] dark:border-white/[0.03] relative"
              onDragOver={(e) => handleDragOver(status, columnTasks.length, e)}
              onDrop={(e) => handleDrop(status, columnTasks.length, e)}
            >
                <SkeletonLoader
                  show={showSkeletons}
                  className="col-start-1 row-start-1"
                  skeleton={(
                    <div className="flex flex-col gap-4">
                      <SkeletonCard />
                      <SkeletonCard />
                      <SkeletonCard />
                    </div>
                  )}
                >
                {!loading && columnTasks.length === 0 ? (
                  <div className="col-start-1 row-start-1 flex items-center justify-center text-center p-6 text-xs font-medium text-slate-400 dark:text-slate-500 border-2 border-dashed border-black/[0.04] dark:border-white/[0.04] rounded-[1rem]">
                    No {status.replace("_", " ")} tasks
                    <br />
                    {statusFilter !== "all" || priorityFilter !== "all" ? "matching current filters" : taskScopeSprintId ? "in this sprint" : "in this project"}.
                  </div>
                ) : !loading ? (
                  <div className="col-start-1 row-start-1 flex flex-col gap-4">
                    {columnTasks.map((task, index) => {
                      const isDraggedOver = dropTargetContext?.status === status && dropTargetContext?.index === index;
                      const viewModel = taskViewModels.get(task.recordId);
                      if (!viewModel) return null;

                      return (
                        <div key={task.recordId} className="contents">
                          {isDraggedOver && draggedTaskId !== task.recordId && (
                        <div className="h-24 mb-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all duration-300" />
                      )}
                      <div
                        key={task.recordId}
                        className="task-card-entry"
                        data-task-id={task.recordId}
                        onDragOver={(e) => { e.stopPropagation(); handleDragOver(status, index, e); }}
                        onDrop={(e) => { e.stopPropagation(); handleDrop(status, index, e); }}
                      >
                          <KanbanTaskCard
                            viewModel={viewModel}
                            index={index}
                            onEdit={handleEditClick}
                            onDelete={handleDeleteTask}
                            agentPresetName={task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.name ?? null : null}
                            agentPresetAvatarConfig={task.agentPresetId ? agentPresetsMap.get(task.agentPresetId)?.avatarConfig : undefined}
                            isDragging={draggedTaskId === task.recordId}
                            onDragStart={(e) => handleDragStart(task.recordId, e)}
                            onDragEnd={handleDragEnd}
                          />
                        </div>
                        </div>
                      );
                    })}
                    {dropTargetContext?.status === status && dropTargetContext?.index === columnTasks.length && (
                        <div className="h-24 mt-4 rounded-[1.5rem] border-2 border-dashed border-signal-500/50 bg-signal-500/10 transition-all duration-300" />
                      )}
                  </div>
                ) : null}
                </SkeletonLoader>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAddProjectModal && (
        <AddProjectModal
          onClose={() => setShowAddProjectModal(false)}
          onAdd={handleAddProject}
        />
      )}

    </PageContainer>
  );
};
