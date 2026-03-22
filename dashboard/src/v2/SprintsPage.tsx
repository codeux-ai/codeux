import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  Heart,
  Maximize2,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Radio,
  Sparkles,
  Square,
  Target,
  X,
  XCircle,
} from "lucide-preact";
import { SprintBubble } from "./components/ui/SprintBubble.js";
import { HumanInterventionBadge } from "./components/ui/HumanInterventionBadge.js";
import { SprintComposer } from "./components/ui/SprintComposer.js";
import { filterShowcaseSprints, sortSprintsByRecency } from "./lib/sprint-gallery.js";
import type { SprintSubmitMode, PlanningRouteOption } from "./lib/sprint-composer-state.js";
import { SprintMarkdownModal } from "./components/ui/SprintMarkdownModal.js";
import { SprintSettingsOverrideModal } from "./components/ui/SprintSettingsOverrideModal.js";
import type { Sprint, SprintStatus, ImprovePromptInput } from "./types.js";
import { useProjectData } from "./context/project-data.js";
import { useProjectSprints } from "./hooks/use-project-sprints.js";
import { useProjectExecution } from "./hooks/use-project-execution.js";
import {
  createSprint,
  deleteSprint,
  exportSprintMarkdown,
  fetchProjectExecution,
  importSprintMarkdown,
  improveSprintPrompt,
  planSprint,
  updateSprint,
} from "./lib/project-api.js";
import { buildTaskBundle, parseTaskBundle } from "./lib/markdown-transfer.js";
import { fetchProjectEffectiveSettings } from "./lib/settings-api.js";
import { cancelSprintRun, orchestrateSprint } from "../lib/api/dashboard-api.js";
import { getSprintHumanInterventionBySprintId } from "../lib/execution-intervention.js";

const ACCENT_CYCLE = ["text-signal-500", "text-ember-500", "text-status-green"] as const;
const TABLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TABLE_META_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const ACTIVE_CONNECTION_STATUSES = new Set(["connected", "listening", "idle"]);
const IN_WORK_STATUSES = new Set<SprintStatus>(["running", "paused"]);
const STATUS_LABELS: Record<SprintStatus, string> = {
  running: "Running",
  paused: "Paused",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
  idle: "Draft",
};
const STATUS_ORDER: Record<SprintStatus, number> = {
  running: 0,
  paused: 1,
  idle: 2,
  completed: 3,
  failed: 4,
  cancelled: 5,
};
const STATUS_BADGE_TONES: Record<SprintStatus, string> = {
  running: "border-status-green/25 bg-status-green/10 text-status-green",
  paused: "border-ember-500/25 bg-ember-500/10 text-ember-500",
  completed: "border-black/[0.08] bg-black/[0.04] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  failed: "border-status-red/20 bg-status-red/10 text-status-red",
  cancelled: "border-slate-300/40 bg-slate-200/55 text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400",
  idle: "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300",
};
const PLANNING_ROLE_PRIORITY: Record<string, number> = {
  worker: 0,
  listener: 1,
};
const CONNECTION_STATUS_PRIORITY: Record<string, number> = {
  listening: 0,
  connected: 1,
  idle: 2,
  paused: 3,
  stale: 4,
  offline: 5,
};
const VIRTUAL_PROVIDER_LABELS: Record<string, string> = {
  gemini: "Virtual Gemini Worker",
  codex: "Virtual Codex Worker",
  "claude-code": "Virtual Claude Code Worker",
};

type SprintTableSortKey = "showcasePinned" | "sprintKey" | "name" | "status" | "tasksCount" | "completion" | "createdAt";
type SprintTableSortDirection = "asc" | "desc";

const formatSprintKey = (sprint: Sprint): string => (
  sprint.number ? `SPR-${sprint.number}` : sprint.slug.toUpperCase()
);

const shortenId = (value: string): string => value.slice(0, 8);
const formatTableDate = (value: string): string => TABLE_DATE_FORMATTER.format(new Date(value));
const formatMetaDate = (value: string): string => TABLE_META_DATE_FORMATTER.format(new Date(value));
const compareString = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { sensitivity: "base" })
);

export const SprintsPage: FunctionComponent = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  const bubblesRef = useRef<HTMLDivElement>(null);
  const createStageRef = useRef<HTMLDivElement>(null);
  const [showCreateComposer, setShowCreateComposer] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    sprintId: string;
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());
  const [optimisticStatuses, setOptimisticStatuses] = useState<Record<string, SprintStatus>>({});
  const [suppressedRunningSprintIds, setSuppressedRunningSprintIds] = useState<Set<string>>(new Set());
  const [exportState, setExportState] = useState<{
    sprintLabel: string;
    sprintMarkdown: string;
    tasksMarkdown: string;
  } | null>(null);
  const [overrideSprint, setOverrideSprint] = useState<Sprint | null>(null);
  const [workerMode, setWorkerMode] = useState<null | {
    executionMode: "CONNECTED_MCP" | "VIRTUAL";
    virtualWorkerProvider: string;
  }>(null);
  const [tableSort, setTableSort] = useState<{
    key: SprintTableSortKey;
    direction: SprintTableSortDirection;
  }>({
    key: "createdAt",
    direction: "desc",
  });
  const { selectedProject } = useProjectData();
  const { sprints, refresh } = useProjectSprints(selectedProject?.id || null);
  const { execution, refresh: refreshExecution } = useProjectExecution(selectedProject?.id || null);

  useLayoutEffect(() => {
    if (!headerRef.current) {
      return;
    }
    gsap.fromTo(
      Array.from(headerRef.current.children),
      { opacity: 0, y: 28 },
      { opacity: 1, y: 0, stagger: 0.08, duration: 0.75, ease: "power3.out" },
    );
  }, []);

  useEffect(() => {
    if ((!showCreateComposer && !editingSprint) || !createStageRef.current) {
      return;
    }
    createStageRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editingSprint, showCreateComposer]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedProject) {
      setWorkerMode(null);
      return () => {
        cancelled = true;
      };
    }

    void fetchProjectEffectiveSettings(selectedProject.id)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setWorkerMode({
          executionMode: response.settings.workers.executionMode,
          virtualWorkerProvider: response.settings.workers.virtualWorkerProvider,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorkerMode(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  useEffect(() => {
    if (!rowMenu) {
      return;
    }
    const closeMenu = () => setRowMenu(null);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [rowMenu]);

  const nextSprintNumber = useMemo(() => (
    sprints.reduce((maxNumber, sprint) => Math.max(maxNumber, sprint.number || 0), 0) + 1
  ), [sprints]);
  const nextId = `SPR-${String(nextSprintNumber).padStart(2, "0")}`;

  const actualActiveRunsBySprintId = useMemo(() => {
    const map = new Map<string, { id: string; status: string }>();
    for (const run of execution.sprintRuns) {
      if (run.status !== "running" && run.status !== "queued") {
        continue;
      }
      if (!map.has(run.sprintId)) {
        map.set(run.sprintId, { id: run.id, status: run.status });
      }
    }
    return map;
  }, [execution.sprintRuns]);

  useEffect(() => {
    setSuppressedRunningSprintIds((current) => {
      let changed = false;
      const next = new Set<string>();
      for (const sprintId of current) {
        if (actualActiveRunsBySprintId.has(sprintId)) {
          next.add(sprintId);
        } else {
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [actualActiveRunsBySprintId]);

  const activeRunsBySprintId = useMemo(() => {
    const map = new Map<string, { id: string; status: string }>();
    for (const [sprintId, run] of actualActiveRunsBySprintId.entries()) {
      if (suppressedRunningSprintIds.has(sprintId)) {
        continue;
      }
      map.set(sprintId, run);
    }
    return map;
  }, [actualActiveRunsBySprintId, suppressedRunningSprintIds]);

  const interventionBySprintId = useMemo(
    () => getSprintHumanInterventionBySprintId(execution),
    [execution],
  );

  const displaySprints = useMemo(() => (
    sprints.map((sprint) => ({
      ...sprint,
      status: optimisticStatuses[sprint.id]
        || (suppressedRunningSprintIds.has(sprint.id) && sprint.status === "running" ? "cancelled" : sprint.status),
    }))
  ), [optimisticStatuses, sprints, suppressedRunningSprintIds]);

  const sortedSprints = useMemo(() => (
    sortSprintsByRecency(displaySprints)
  ), [displaySprints]);

  const showcaseSprints = useMemo(() => {
    return filterShowcaseSprints(sortedSprints);
  }, [sortedSprints]);

  const completedCount = useMemo(() => (
    sortedSprints.filter((sprint) => sprint.status === "completed").length
  ), [sortedSprints]);

  const inWorkCount = useMemo(() => (
    sortedSprints.filter((sprint) => IN_WORK_STATUSES.has(sprint.status)).length
  ), [sortedSprints]);

  const planningConnection = useMemo(() => (
    [...execution.connections]
      .filter((connection) => (
        connection.listenMode
        && ACTIVE_CONNECTION_STATUSES.has(connection.status)
        && (connection.role === "worker" || connection.role === "listener")
      ))
      .sort((left, right) => {
        const roleDelta = (PLANNING_ROLE_PRIORITY[left.role] ?? 99) - (PLANNING_ROLE_PRIORITY[right.role] ?? 99);
        if (roleDelta !== 0) {
          return roleDelta;
        }
        const statusDelta = (CONNECTION_STATUS_PRIORITY[left.status] ?? 99) - (CONNECTION_STATUS_PRIORITY[right.status] ?? 99);
        if (statusDelta !== 0) {
          return statusDelta;
        }
        return compareString(left.displayName, right.displayName);
      })[0] || null
  ), [execution.connections]);

  const planningRoute = useMemo(() => {
    if (workerMode?.executionMode === "VIRTUAL") {
      return {
        available: true,
        label: VIRTUAL_PROVIDER_LABELS[workerMode.virtualWorkerProvider] || "Virtual Worker",
      };
    }

    if (planningConnection) {
      return {
        available: true,
        label: planningConnection.displayName,
      };
    }

    return {
      available: false,
      label: null,
    };
  }, [planningConnection, workerMode]);

  const tableSprints = useMemo(() => {
    const ordered = [...sortedSprints].sort((left, right) => {
      switch (tableSort.key) {
        case "showcasePinned":
          return Number(right.showcasePinned) - Number(left.showcasePinned);
        case "sprintKey":
          if (left.number !== null && right.number !== null && left.number !== right.number) {
            return left.number - right.number;
          }
          return compareString(formatSprintKey(left), formatSprintKey(right));
        case "name":
          return compareString(left.name, right.name);
        case "status":
          return STATUS_ORDER[left.status] - STATUS_ORDER[right.status];
        case "tasksCount":
          return left.tasksCount - right.tasksCount;
        case "completion":
          return left.completion - right.completion;
        case "createdAt":
        default:
          return left.createdAt.localeCompare(right.createdAt);
      }
    });

    if (tableSort.direction === "desc") {
      ordered.reverse();
    }
    return ordered;
  }, [sortedSprints, tableSort]);

  const runSprintAction = async (
    actionId: string,
    sprintId: string,
    operation: () => Promise<void>,
    options: {
      optimisticStatus?: SprintStatus;
      waitForActiveRun?: boolean;
    } = {},
  ) => {
    setPendingActionIds((current) => new Set(current).add(actionId));
    if (options.optimisticStatus) {
      setOptimisticStatuses((current) => ({ ...current, [sprintId]: options.optimisticStatus! }));
    }
    try {
      await operation();
      if (options.optimisticStatus === "cancelled") {
        setSuppressedRunningSprintIds((current) => new Set(current).add(sprintId));
      }
      if (options.waitForActiveRun && selectedProject) {
        for (let attempt = 0; attempt < 8; attempt += 1) {
          const snapshot = await fetchProjectExecution(selectedProject.id);
          if (snapshot.sprintRuns.some((run) => run.sprintId === sprintId && (run.status === "running" || run.status === "queued"))) {
            break;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }
      }
      await Promise.all([refresh(), refreshExecution()]);
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[sprintId];
        return next;
      });
    } catch (error) {
      setOptimisticStatuses((current) => {
        const next = { ...current };
        delete next[sprintId];
        return next;
      });
      await Promise.all([refresh(), refreshExecution()]);
      window.alert(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
  };

  const handleSprintToggle = (sprintId: string) => {
    if (!selectedProject) {
      return;
    }
    const activeRun = activeRunsBySprintId.get(sprintId);
    if (activeRun) {
      const stopActionId = `sprint-stop:${activeRun.id}`;
      void runSprintAction(stopActionId, sprintId, async () => {
        await cancelSprintRun(activeRun.id);
      }, { optimisticStatus: "cancelled" });
      return;
    }

    const startActionId = `sprint-start:${sprintId}`;
    if (pendingActionIds.has(startActionId)) {
      return;
    }
    setSuppressedRunningSprintIds((current) => {
      if (!current.has(sprintId)) {
        return current;
      }
      const next = new Set(current);
      next.delete(sprintId);
      return next;
    });
    void runSprintAction(startActionId, sprintId, async () => {
      await orchestrateSprint(selectedProject.id, sprintId);
    }, { waitForActiveRun: true });
  };

  const handleTableSort = (key: SprintTableSortKey) => {
    setTableSort((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        key,
        direction: key === "name" || key === "status" || key === "showcasePinned" || key === "sprintKey" ? "asc" : "desc",
      };
    });
  };

  const animateLatestCell = () => {
    requestAnimationFrame(() => {
      if (!bubblesRef.current) {
        return;
      }
      const newCell = bubblesRef.current.firstElementChild;
      if (!newCell) {
        return;
      }
      gsap.fromTo(
        newCell,
        { scale: 0.88, opacity: 0, y: 18 },
        { scale: 1, opacity: 1, y: 0, duration: 0.8, ease: "elastic.out(1, 0.65)" },
      );
    });
  };

  const virtualProviders = useMemo(() => (
    Object.entries(VIRTUAL_PROVIDER_LABELS).map(([id, label]) => ({ id, label }))
  ), []);

  const handleSubmitSprint = async (payload: {
    name: string;
    goal: string;
    originalPrompt: string | null;
    submitMode: SprintSubmitMode;
    routeOverride: PlanningRouteOption | null;
    modelOverride: string | null;
  }): Promise<void> => {
    if (!selectedProject) {
      return;
    }

    const overrides = payload.routeOverride || payload.modelOverride ? {
      workerId: payload.routeOverride?.type === 'connected' ? payload.routeOverride.id : undefined,
      virtualModel: payload.routeOverride?.type === 'virtual' ? (payload.modelOverride || undefined) : undefined,
    } : undefined;

    if (editingSprint) {
      await updateSprint(editingSprint.id, {
        name: payload.name,
        goal: payload.goal,
        originalPrompt: payload.originalPrompt,
      });

      if (payload.submitMode === "plan_only" || payload.submitMode === "replan") {
        await planSprint(selectedProject.id, editingSprint.id, { 
          autoStart: false, 
          replan: payload.submitMode === "replan",
          overrides,
        });
      } else if (payload.submitMode === "plan_and_start") {
        await planSprint(selectedProject.id, editingSprint.id, { 
          autoStart: true,
          replan: false,
          overrides,
        });
      }

      await refresh();
      setEditingSprint(null);
      return;
    }

    const created = await createSprint(selectedProject.id, {
      name: payload.name,
      goal: payload.goal,
      originalPrompt: payload.originalPrompt,
      number: nextSprintNumber,
      status: "idle",
      showcasePinned: true,
      startDate: null,
      endDate: null,
    });

    if (payload.submitMode === "plan_only") {
      await planSprint(selectedProject.id, created.id, { autoStart: false, overrides });
    } else if (payload.submitMode === "plan_and_start") {
      await planSprint(selectedProject.id, created.id, { autoStart: true, overrides });
    }

    await Promise.all([refresh(), refreshExecution()]);
    animateLatestCell();
  };

  const handleImprovePrompt = async (draft: ImprovePromptInput): Promise<string> => {
    if (!selectedProject) {
      throw new Error("Select a project before using Plan ahead with AI.");
    }
    const response = await improveSprintPrompt(selectedProject.id, draft);
    return response.goal;
  };

  const handleDeleteSprint = async (sprintId: string) => {
    await deleteSprint(sprintId);
    await Promise.all([refresh(), refreshExecution()]);
  };

  const handleToggleShowcase = async (sprint: Sprint) => {
    if (sprint.status === "completed") {
      return;
    }
    const actionId = `sprint-showcase:${sprint.id}`;
    if (pendingActionIds.has(actionId)) {
      return;
    }
    setPendingActionIds((current) => new Set(current).add(actionId));
    try {
      await updateSprint(sprint.id, {
        showcasePinned: !sprint.showcasePinned,
      });
      await refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
  };

  const handleOpenExport = async (sprintId: string, sprintName: string) => {
    if (!selectedProject) {
      return;
    }
    const bundle = await exportSprintMarkdown(selectedProject.id, sprintId);
    setExportState({
      sprintLabel: sprintName,
      sprintMarkdown: bundle.sprint.markdown,
      tasksMarkdown: buildTaskBundle(bundle.tasks),
    });
  };

  const handleImportSprint = async (payload: { sprintMarkdown: string; tasksMarkdown: string }) => {
    if (!selectedProject) {
      return;
    }
    await importSprintMarkdown(selectedProject.id, {
      sprintMarkdown: payload.sprintMarkdown,
      tasks: parseTaskBundle(payload.tasksMarkdown),
    });
    await refresh();
  };

  const renderSortIndicator = (key: SprintTableSortKey) => {
    if (tableSort.key !== key) {
      return <ArrowUpDown className="h-3 w-3 text-slate-300 dark:text-slate-600" strokeWidth={2.2} />;
    }
    return tableSort.direction === "asc"
      ? <ArrowUp className="h-3 w-3 text-signal-500" strokeWidth={2.2} />
      : <ArrowDown className="h-3 w-3 text-signal-500" strokeWidth={2.2} />;
  };

  const openRowActionsMenu = (event: MouseEvent, sprintId: string) => {
    event.stopPropagation();
    const trigger = event.currentTarget as HTMLElement;
    const rect = trigger.getBoundingClientRect();
    const estimatedMenuHeight = 228;
    const openUp = rect.bottom + estimatedMenuHeight > window.innerHeight - 16;

    setRowMenu((current) => (
      current?.sprintId === sprintId
        ? null
        : {
          sprintId,
          top: openUp ? rect.top - 8 : rect.bottom + 8,
          left: rect.right,
          openUp,
        }
    ));
  };

  const activeRowMenuSprint = rowMenu
    ? tableSprints.find((sprint) => sprint.id === rowMenu.sprintId) || null
    : null;

  return (
    <>
      <div className="relative z-10 mx-auto flex max-w-[1920px] flex-col gap-20 px-8 py-24 md:px-20">
        <div ref={headerRef} className="flex flex-wrap items-end justify-between gap-8">
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-2.5 font-mono text-xs font-bold uppercase tracking-[0.15em] text-signal-500">
              <Target className="h-4 w-4" strokeWidth={2.5} />
              Iteration Cycles
            </div>
            <h1 className="font-display text-5xl font-black leading-[0.92] tracking-tighter text-slate-900 dark:text-white md:text-7xl">
              Active <br />
              <span className="text-signal-500">Sprints.</span>
            </h1>
            <p className="mt-2 max-w-2xl text-lg font-medium leading-relaxed text-slate-500 dark:text-slate-500">
              {selectedProject
                ? `Define the sprint once for ${selectedProject.name}. The Planning agent can improve the prompt, plan subtasks, and launch the sprint without manual task entry.`
                : "Select a project to manage sprint structure."}
            </p>
            {selectedProject && (
              <div className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] ${
                planningRoute.available
                  ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 dark:text-signal-300"
                  : "border-status-red/20 bg-status-red/10 text-status-red"
              }`}>
                <Radio className="h-3.5 w-3.5" strokeWidth={2.1} />
                {planningRoute.available ? `Planning via ${planningRoute.label}` : "No planning worker available"}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { label: "Total", value: sortedSprints.length, icon: Target },
              { label: "Completed", value: completedCount, icon: CheckCircle2 },
              { label: "In Work", value: inWorkCount, icon: Activity },
            ].map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="inline-flex items-center gap-3 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300"
              >
                <Icon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2} />
                {label} <span className="font-mono text-slate-700 dark:text-white">{value}</span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              disabled={!selectedProject}
              className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:text-white"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.2} />
              Import Markdown
            </button>
            <button
              type="button"
              onClick={() => {
                if (editingSprint || showCreateComposer) {
                  setEditingSprint(null);
                  setShowCreateComposer(false);
                  return;
                }
                setShowCreateComposer(true);
              }}
              disabled={!selectedProject}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[10px] font-bold uppercase tracking-[0.12em] transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                showCreateComposer
                  ? "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                  : "bg-signal-500 text-void-900 hover:-translate-y-px hover:bg-signal-400"
              }`}
            >
              {(showCreateComposer || editingSprint) ? <X className="h-3.5 w-3.5" strokeWidth={2.3} /> : <Plus className="h-3.5 w-3.5" strokeWidth={2.3} />}
              {(showCreateComposer || editingSprint) ? "Close Composer" : "New Sprint"}
            </button>
          </div>
        </div>

        {selectedProject ? (
          <>
            <div ref={createStageRef} className="relative overflow-hidden">
              <div
                className={`transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showCreateComposer || editingSprint
                    ? "pointer-events-none max-h-0 overflow-hidden -translate-y-8 scale-[0.985] opacity-0 blur-[10px]"
                    : "max-h-[240rem] overflow-visible translate-y-0 scale-100 opacity-100 blur-0"
                }`}
              >
                <div ref={bubblesRef} className="flex flex-wrap justify-center gap-10 py-6 xl:gap-12">
                  {showcaseSprints.map((sprint, index) => {
                    const activeRun = activeRunsBySprintId.get(sprint.id);
                    const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
                    return (
                      <SprintBubble
                        key={sprint.id}
                        sprint={sprint}
                        isEven={index % 2 === 0}
                        accentColor={ACCENT_CYCLE[index % ACCENT_CYCLE.length]}
                        primaryBusy={pendingActionIds.has(pendingActionId)}
                        humanIntervention={interventionBySprintId.get(sprint.id) || null}
                        onPrimaryAction={() => { handleSprintToggle(sprint.id); }}
                        onEdit={() => {
                          setEditingSprint(sprint);
                          setShowCreateComposer(false);
                        }}
                        onDelete={() => { void handleDeleteSprint(sprint.id); }}
                        onExport={() => { void handleOpenExport(sprint.id, sprint.name); }}
                        onOverrides={() => { setOverrideSprint(sprint); }}
                        onToggleShowcase={() => { void handleToggleShowcase(sprint); }}
                      />
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => {
                      setEditingSprint(null);
                      setShowCreateComposer(true);
                    }}
                    disabled={!selectedProject}
                    className="group relative flex h-72 w-72 shrink-0 cursor-pointer items-center justify-center perspective-1000 lg:h-80 lg:w-80"
                  >
                    <div
                      className="absolute inset-0 animate-organic border-2 border-dashed border-signal-500/25 transition-all duration-500 group-hover:border-signal-500/60"
                      style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
                    />
                    <div
                      className="absolute inset-0 animate-organic-reverse bg-signal-500/0 transition-all duration-500 group-hover:bg-signal-500/[0.04]"
                      style={{ borderRadius: "40% 60% 70% 30% / 40% 50% 60% 50%" }}
                    />
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-dashed border-signal-500/30 transition-all duration-400 group-hover:border-signal-500 group-hover:bg-signal-500/10">
                        <Plus className="h-6 w-6 text-signal-500/40 transition-all duration-400 group-hover:rotate-90 group-hover:scale-110 group-hover:text-signal-500" />
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300 transition-colors duration-300 group-hover:text-signal-500 dark:text-slate-600">
                          New Sprint
                        </span>
                        <span className="font-mono text-[9px] text-slate-200 transition-colors duration-300 group-hover:text-slate-400 dark:text-slate-700">
                          {nextId.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>
              </div>

              <div
                className={`overflow-hidden transition-all duration-700 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                  showCreateComposer || editingSprint
                    ? "mt-0 max-h-[220rem] translate-y-0 scale-100 opacity-100 blur-0"
                    : "pointer-events-none max-h-0 translate-y-10 scale-[0.985] opacity-0 blur-[10px]"
                }`}
              >
                <div className="relative">
                  <div className="pointer-events-none absolute inset-0 -z-10 rounded-[2.2rem] bg-[radial-gradient(circle_at_top,rgba(0,224,160,0.08),transparent_46%)] dark:bg-[radial-gradient(circle_at_top,rgba(0,224,160,0.12),transparent_46%)]" />
                  <SprintComposer
                    nextId={nextId}
                    initialSprint={editingSprint}
                    connections={execution.connections}
                    virtualProviders={virtualProviders}
                    onClose={() => {
                      setShowCreateComposer(false);
                      setEditingSprint(null);
                    }}
                    onImprovePrompt={handleImprovePrompt}
                    onSubmit={(payload) => handleSubmitSprint(payload)}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[2.2rem] border border-black/[0.06] bg-white/70 shadow-[0_12px_36px_rgba(15,23,42,0.05)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/62 dark:shadow-[0_14px_40px_rgba(0,0,0,0.22)]">
              <div className="flex flex-wrap items-center justify-between gap-6 border-b border-black/[0.06] px-6 py-5 dark:border-white/[0.06]">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ember-500">
                    <Heart className="h-3.5 w-3.5" strokeWidth={2.3} />
                    Sprint Ledger
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                    All sprints, fully sortable.
                  </h2>
                  <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                    The showcase above reflects the sprints marked with the heart. New sprints are showcased by default, and completed ones drop out automatically.
                  </p>
                </div>
                <div className="text-xs font-mono text-slate-400">{tableSprints.length} total</div>
              </div>

              {tableSprints.length === 0 ? (
                <div className="px-6 py-8 text-sm text-slate-400">
                  No sprints exist yet. Create one above and it will appear in the showcase and in the ledger below.
                </div>
              ) : (
                <div className="overflow-x-auto px-4 pb-5">
                  <table className="min-w-full border-separate [border-spacing:0_0.55rem] text-left">
                    <thead>
                      <tr className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("showcasePinned")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Showcase
                            {renderSortIndicator("showcasePinned")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("sprintKey")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Sprint ID
                            {renderSortIndicator("sprintKey")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("name")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Sprint
                            {renderSortIndicator("name")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("status")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Status
                            {renderSortIndicator("status")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("tasksCount")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Tasks
                            {renderSortIndicator("tasksCount")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("completion")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Completion
                            {renderSortIndicator("completion")}
                          </button>
                        </th>
                        <th className="px-4 py-2">
                          <button
                            type="button"
                            onClick={() => handleTableSort("createdAt")}
                            className="inline-flex items-center gap-2 transition-colors hover:text-slate-700 dark:hover:text-slate-200"
                          >
                            Created
                            {renderSortIndicator("createdAt")}
                          </button>
                        </th>
                        <th className="px-4 py-2 text-right">Controls</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableSprints.map((sprint) => {
                        const activeRun = activeRunsBySprintId.get(sprint.id);
                        const humanIntervention = interventionBySprintId.get(sprint.id) || null;
                        const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
                        const pinActionId = `sprint-showcase:${sprint.id}`;
                        const isCompleted = sprint.status === "completed";
                        const cellClass = `border-y border-black/[0.05] bg-white/82 px-4 py-3 align-top dark:border-white/[0.05] dark:bg-white/[0.035] ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""}`;
                        return (
                          <tr key={sprint.id} className="group">
                            <td className={`${cellClass} rounded-l-[1.4rem] border-l`}>
                              <button
                                type="button"
                                onClick={() => { void handleToggleShowcase(sprint); }}
                                disabled={pendingActionIds.has(pinActionId) || sprint.status === "completed"}
                                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                                  sprint.showcasePinned
                                    ? "border-status-red/20 bg-status-red/10 text-status-red"
                                    : "border-black/[0.06] bg-black/[0.03] text-slate-400 hover:text-status-red dark:border-white/[0.06] dark:bg-white/[0.03]"
                                } disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
                              </button>
                            </td>
                            <td className={`${cellClass} min-w-[8rem]`}>
                              <div className="font-mono text-sm font-bold text-slate-700 dark:text-white">{formatSprintKey(sprint)}</div>
                              <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                {shortenId(sprint.id)}
                              </div>
                            </td>
                            <td className={`${cellClass} min-w-[22rem]`}>
                              <div className={`font-display text-lg font-black tracking-tight ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-slate-900 dark:text-white"}`}>{sprint.name}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                <span>Updated {formatMetaDate(sprint.updatedAt)}</span>
                                <span>·</span>
                                <span>{formatTableDate(sprint.createdAt)}</span>
                              </div>
                              {humanIntervention && (
                                <div className="mt-3">
                                  <HumanInterventionBadge summary={humanIntervention} label="Needs you" compact align="left" />
                                </div>
                              )}
                              {sprint.goal ? (
                                <p className={`mt-2 max-w-xl text-sm leading-relaxed ${isCompleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
                                  {sprint.goal}
                                </p>
                              ) : null}
                            </td>
                            <td className={cellClass}>
                              <div className="flex flex-col items-start gap-2">
                                <span className={`inline-flex rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_BADGE_TONES[sprint.status]}`}>
                                  {STATUS_LABELS[sprint.status]}
                                </span>
                                {humanIntervention && (
                                  <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                                    <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />
                                    Intervention
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className={cellClass}>
                              <div className="font-mono text-lg font-bold text-slate-700 dark:text-white">{sprint.tasksCount}</div>
                              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">planned tasks</div>
                            </td>
                            <td className={`${cellClass} min-w-[11rem]`}>
                              <div className="flex items-center gap-3">
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
                                  <div
                                    className="h-full rounded-full bg-signal-500 transition-[width]"
                                    style={{ width: `${sprint.completion}%` }}
                                  />
                                </div>
                                <span className="font-mono text-sm font-bold text-slate-700 dark:text-white">{sprint.completion}%</span>
                              </div>
                            </td>
                            <td className={cellClass}>
                              <div className="font-medium text-slate-700 dark:text-slate-200">{formatTableDate(sprint.createdAt)}</div>
                              <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">created</div>
                            </td>
                            <td className={`${cellClass} rounded-r-[1.4rem] border-r`}>
                              <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => { handleSprintToggle(sprint.id); }}
                                  disabled={pendingActionIds.has(pendingActionId)}
                                  className={`inline-flex h-10 min-w-[5.5rem] items-center justify-center gap-2 rounded-full border px-4 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
                                    activeRun
                                      ? "border-status-red/20 bg-status-red/[0.1] text-status-red hover:bg-status-red/[0.14]"
                                      : "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
                                  } disabled:cursor-not-allowed disabled:opacity-50`}
                                >
                                  {activeRun ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
                                  {activeRun ? "Stop" : "Start"}
                                </button>
                                <a
                                  href={`/tasks?sprint=${encodeURIComponent(sprint.id)}`}
                                  className="inline-flex h-10 min-w-[4.8rem] items-center justify-center gap-2 rounded-full border border-black/[0.06] bg-white/80 px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                                >
                                  Open
                                  <Maximize2 className="h-3.5 w-3.5" />
                                </a>
                                <button
                                  type="button"
                                  onClick={(event) => openRowActionsMenu(event, sprint.id)}
                                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
                                >
                                  <MoreVertical className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-[1.75rem] border border-black/[0.06] bg-white/70 px-6 py-8 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-void-800/55 dark:text-slate-400">
            Projects scope the sprint gallery. Select a project from the top navigation before creating or planning sprints.
          </div>
        )}
      </div>

      {rowMenu && activeRowMenuSprint && (
        <div
          className="fixed z-[220]"
          style={{
            top: `${rowMenu.top}px`,
            left: `${rowMenu.left}px`,
            transform: rowMenu.openUp ? "translate(-100%, -100%)" : "translateX(-100%)",
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="min-w-[11.5rem] rounded-[1.2rem] border border-black/[0.08] bg-white p-2 shadow-[0_18px_38px_rgba(15,23,42,0.18)] ring-1 ring-black/[0.03] dark:border-white/[0.08] dark:bg-void-800 dark:ring-white/[0.03]">
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                setEditingSprint(activeRowMenuSprint);
                setShowCreateComposer(false);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={2.1} />
              Edit
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleOpenExport(activeRowMenuSprint.id, activeRowMenuSprint.name);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Download className="h-3.5 w-3.5" strokeWidth={2.1} />
              Export
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleToggleShowcase(activeRowMenuSprint);
              }}
              disabled={activeRowMenuSprint.status === "completed"}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Heart className="h-3.5 w-3.5" fill={activeRowMenuSprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
              {activeRowMenuSprint.showcasePinned ? "Remove" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                setOverrideSprint(activeRowMenuSprint);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2.1} />
              Overrides
            </button>
            <button
              type="button"
              onClick={() => {
                setRowMenu(null);
                void handleDeleteSprint(activeRowMenuSprint.id);
              }}
              className="flex w-full items-center gap-2 rounded-[0.9rem] px-3 py-2 text-left text-xs font-medium text-status-red transition-colors hover:bg-status-red/10"
            >
              <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
              Delete
            </button>
          </div>
        </div>
      )}

      {showImportModal && (
        <SprintMarkdownModal
          mode="import"
          onClose={() => setShowImportModal(false)}
          onImport={handleImportSprint}
        />
      )}

      {exportState && (
        <SprintMarkdownModal
          mode="export"
          sprintLabel={exportState.sprintLabel}
          sprintMarkdown={exportState.sprintMarkdown}
          tasksMarkdown={exportState.tasksMarkdown}
          onClose={() => setExportState(null)}
        />
      )}

      {overrideSprint && selectedProject && (
        <SprintSettingsOverrideModal
          projectId={selectedProject.id}
          sprint={overrideSprint}
          onClose={() => setOverrideSprint(null)}
          onSaved={async () => {
            await Promise.all([refresh(), refreshExecution()]);
          }}
        />
      )}
    </>
  );
};
