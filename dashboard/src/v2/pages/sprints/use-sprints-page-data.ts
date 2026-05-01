import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { 
  AgentPreset, 
  CreateTaskInput, 
  ImprovePromptInput, 
  Sprint, 
  SprintStatus, 
  Task, 
  VirtualWorkerProvider 
} from "../../types.js";
import { useProjectData } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import { useExecutions } from "../../../hooks/useExecutions.js";
import {
  createSprint,
  createTask,
  updateSprintShowcase,
  deleteSprint,
  exportSprintMarkdown,
  fetchProjectExecution,
  fetchProjectStats,
  fetchTasks,
  importSprintMarkdown,
  improveSprintPrompt,
  planSprint,
  updateSprint,
  cancelPlanningRequest,
} from "../../lib/project-api.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";
import { buildTaskBundle, parseTaskBundle } from "../../lib/markdown-transfer.js";
import { toTaskViewModel } from "../../lib/view-models.js";
import { derivePlanningETA } from "../../lib/planning-telemetry.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { cancelSprintRun, orchestrateSprint } from "../../../lib/api/dashboard-api.js";
import { getSprintHumanInterventionBySprintId } from "../../../lib/execution-intervention.js";
import { filterShowcaseSprints, sortSprintsByRecency } from "../../lib/sprint-gallery.js";
import { toPlanningOverrides, type SprintSubmitMode, type PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { useActionFeedback } from "../../hooks/use-action-feedback.js";
import {
  fetchQuicksprintTemplates,
  executeQuicksprint,
  createCustomQuicksprintTemplate,
  updateCustomQuicksprintTemplate,
  deleteCustomQuicksprintTemplate,
} from "../../lib/quicksprint-api.js";

const ACTIVE_CONNECTION_STATUSES = new Set(["connected", "listening", "idle"]);
const IN_WORK_STATUSES = new Set<SprintStatus>(["running", "paused"]);
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

const compareString = (left: string, right: string): number => (
  left.localeCompare(right, undefined, { sensitivity: "base" })
);

export function useSprintsPageData() {
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
  const [addTaskForSprint, setAddTaskForSprint] = useState<Sprint | null>(null);
  const [addTaskSprintTasks, setAddTaskSprintTasks] = useState<Task[]>([]);
  const [workerMode, setWorkerMode] = useState<null | {
    executionMode: "VIRTUAL";
    virtualWorkerProvider: string;
  }>(null);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [showQuicksprint, setShowQuicksprint] = useState(false);
  const [quicksprintTemplates, setQuicksprintTemplates] = useState<QuicksprintTemplateRecord[]>([]);
  const [quicksprintLoading, setQuicksprintLoading] = useState(false);
  const [planningEta, setPlanningEta] = useState(180000);

  const { feedback, setError, clearFeedback } = useActionFeedback();

  const { selectedProject } = useProjectData();
  const { data: sprints, refetch: refresh, loading: sprintsLoading } = useSprints(selectedProject?.id || null);
  const { data: execution, refetch: refreshExecution, loading: executionLoading } = useExecutions(selectedProject?.id || null);

  useEffect(() => {
    if (!selectedProject) {
      setAgentPresets([]);
      return;
    }
    void fetchAgentPresets(selectedProject.id)
      .then(setAgentPresets)
      .catch((error) => {
        console.error("Failed to fetch agent presets", error);
        setAgentPresets([]);
      });
  }, [selectedProject?.id]);

  const planningPresets = useMemo(() => {
    return agentPresets.filter(p => 
      p.labels.some(label => label.trim().toLowerCase() === "planning")
    );
  }, [agentPresets]);

  useEffect(() => {
    if (!selectedProject) {
      setPlanningEta(180000);
      return;
    }
    let cancelled = false;
    void fetchProjectStats(selectedProject.id, "all")
      .then((stats) => {
        if (!cancelled) setPlanningEta(derivePlanningETA(stats));
      })
      .catch((error) => {
        console.error("Failed to fetch project stats for ETA", error);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  useEffect(() => {
    let cancelled = false;

    if (!selectedProject || !showQuicksprint) {
      return () => {
        cancelled = true;
      };
    }

    setQuicksprintLoading(true);
    void fetchQuicksprintTemplates(selectedProject.id)
      .then((templates) => {
        if (!cancelled) {
          setQuicksprintTemplates(templates);
          setQuicksprintLoading(false);
        }
      })
      .catch((error) => {
        console.error("Failed to fetch quicksprint templates", error);
        if (!cancelled) {
          setQuicksprintLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id, showQuicksprint]);

  const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

  useEffect(() => {
    if (!selectedProject || !effectiveSettings) {
      setWorkerMode(null);
      return;
    }
    setWorkerMode({
      executionMode: effectiveSettings.settings.workers.executionMode,
      virtualWorkerProvider: effectiveSettings.settings.workers.virtualWorkerProvider,
    });
  }, [selectedProject?.id, effectiveSettings]);

  const nextSprintNumber = useMemo(() => (
    sprints.reduce((maxNumber: number, sprint: Sprint) => Math.max(maxNumber, sprint.number || 0), 0) + 1
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
    sprints.map((sprint: Sprint) => ({
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

  const runSprintAction = useCallback(async (
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
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
  }, [refresh, refreshExecution, selectedProject]);

  const handleMarkCompleted = useCallback(async (sprintId: string) => {
    const actionId = `sprint-mark-completed:${sprintId}`;
    if (pendingActionIds.has(actionId)) {
      return;
    }
    setPendingActionIds((current) => new Set(current).add(actionId));
    try {
      await updateSprint(sprintId, { status: "completed" });
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
  }, [pendingActionIds, refresh, setError]);

  const handleBulkToggleShowcase = useCallback(async (sprintIds: string[], state: boolean) => {
    const availableIds = sprintIds.filter((id) => !pendingActionIds.has(`sprint-showcase:${id}`));
    if (availableIds.length === 0) return;

    setPendingActionIds((current) => {
      const next = new Set(current);
      for (const id of availableIds) next.add(`sprint-showcase:${id}`);
      return next;
    });

    try {
      await Promise.all(
        availableIds.map((id) => updateSprintShowcase(id, state))
      );
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        for (const id of availableIds) next.delete(`sprint-showcase:${id}`);
        return next;
      });
    }
  }, [pendingActionIds, refresh, setError]);

  const handleSprintToggle = useCallback((sprintId: string) => {
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
  }, [activeRunsBySprintId, pendingActionIds, runSprintAction, selectedProject]);

  const handleSubmitSprint = useCallback(async (payload: {
    name: string;
    goal: string;
    originalPrompt: string | null;
    submitMode: SprintSubmitMode;
    routeOverride: PlanningRouteOption | null;
    modelOverride: string | null;
    planningAgentPresetId: string | null;
    clientRequestId?: string;
    signal?: AbortSignal;
  }): Promise<void> => {
    if (!selectedProject) {
      return;
    }

    const overrides = toPlanningOverrides(payload.routeOverride, payload.modelOverride, payload.planningAgentPresetId);

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
          clientRequestId: payload.clientRequestId,
          planningAgentPresetId: payload.planningAgentPresetId || undefined,
          overrides,
        }, payload.signal);
      } else if (payload.submitMode === "plan_and_start") {
        await planSprint(selectedProject.id, editingSprint.id, {
          autoStart: true,
          replan: false,
          clientRequestId: payload.clientRequestId,
          planningAgentPresetId: payload.planningAgentPresetId || undefined,
          overrides,
        }, payload.signal);
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
      await planSprint(selectedProject.id, created.id, {
        autoStart: false,
        clientRequestId: payload.clientRequestId,
        planningAgentPresetId: payload.planningAgentPresetId || undefined,
        overrides,
      }, payload.signal);
    } else if (payload.submitMode === "plan_and_start") {
      await planSprint(selectedProject.id, created.id, {
        autoStart: true,
        clientRequestId: payload.clientRequestId,
        planningAgentPresetId: payload.planningAgentPresetId || undefined,
        overrides,
      }, payload.signal);
    }

    await Promise.all([refresh(), refreshExecution()]);
  }, [editingSprint, nextSprintNumber, refresh, refreshExecution, selectedProject]);

  const handleImprovePrompt = useCallback(async (draft: ImprovePromptInput, signal?: AbortSignal): Promise<string> => {
    if (!selectedProject) {
      throw new Error("Select a project before using Plan ahead with AI.");
    }
    const response = await improveSprintPrompt(selectedProject.id, draft, signal);
    return response.goal;
  }, [selectedProject]);

  const handleCancelPlanningRequest = useCallback(async (clientRequestId: string): Promise<void> => {
    await cancelPlanningRequest(clientRequestId);
  }, []);

  const handleOpenAppendTasks = useCallback(async (sprint: Sprint) => {
    if (!selectedProject) return;
    try {
      const taskRecords = await fetchTasks(selectedProject.id, sprint.id);
      const sprintsById = new Map<string, Sprint>(sprints.map((s: Sprint) => [s.id, s]));
      const tasks = taskRecords.map((t) => toTaskViewModel(t, new Map(), sprintsById));
      setAddTaskSprintTasks(tasks);
      setAddTaskForSprint(sprint);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [selectedProject, sprints, setError]);

  const handleAppendTask = useCallback(async (draft: {
    sprintId: string;
    title: string;
    description: string;
    promptMarkdown: string;
    status: string;
    priority: string;
    executorType: string;
    dependsOnTaskIds: string[];
  }) => {
    if (!selectedProject) return;
    await createTask(selectedProject.id, draft as CreateTaskInput);
    await refresh();
    // Refresh the task list for the modal so new task appears in dependencies
    if (addTaskForSprint) {
      const taskRecords = await fetchTasks(selectedProject.id, addTaskForSprint.id);
      const sprintsById = new Map<string, Sprint>(sprints.map((s: Sprint) => [s.id, s]));
      setAddTaskSprintTasks(taskRecords.map((t) => toTaskViewModel(t, new Map(), sprintsById)));
    }
  }, [addTaskForSprint, refresh, selectedProject, sprints]);

  const handleDeleteSprint = useCallback(async (sprintId: string) => {
    await deleteSprint(sprintId);
    await Promise.all([refresh(), refreshExecution()]);
  }, [refresh, refreshExecution]);

  const handleToggleShowcase = useCallback(async (sprint: Sprint) => {
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
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current);
        next.delete(actionId);
        return next;
      });
    }
  }, [pendingActionIds, refresh]);

  const handleOpenExport = useCallback(async (sprintId: string, sprintName: string) => {
    if (!selectedProject) {
      return;
    }
    const bundle = await exportSprintMarkdown(selectedProject.id, sprintId);
    setExportState({
      sprintLabel: sprintName,
      sprintMarkdown: bundle.sprint.markdown,
      tasksMarkdown: buildTaskBundle(bundle.tasks),
    });
  }, [selectedProject]);

  const handleImportSprint = useCallback(async (payload: { sprintMarkdown: string; tasksMarkdown: string }) => {
    if (!selectedProject) {
      return;
    }
    await importSprintMarkdown(selectedProject.id, {
      sprintMarkdown: payload.sprintMarkdown,
      tasks: parseTaskBundle(payload.tasksMarkdown),
    });
    await refresh();
  }, [refresh, selectedProject]);


  const handleQuicksprintExecute = useCallback(async (templateId: string, taskCount: number, submitMode: string, additionalPrompt?: string, routeOverride?: PlanningRouteOption | null, modelOverride?: string | null) => {
    if (!selectedProject) return;
    try {
      await executeQuicksprint(selectedProject.id, {
        templateId,
        taskCount,
        submitMode: submitMode as "plan_only" | "plan_and_start",
        additionalPrompt,
        planningOverrides: toPlanningOverrides(routeOverride ?? null, modelOverride ?? null),
      });
      setShowQuicksprint(false);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    }
  }, [selectedProject, refresh, setError]);

  const reloadQuicksprintTemplates = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const templates = await fetchQuicksprintTemplates(selectedProject.id);
      setQuicksprintTemplates(templates);
    } catch (error) {
      console.error("Failed to reload quicksprint templates", error);
    }
  }, [selectedProject]);

  const handleCreateQuicksprintTemplate = useCallback(async (data: {
    name: string; description: string; icon: string; category: string; categoryColor?: string;
    agentInstructionMarkdown: string; defaultTaskCount: number; agentPresetId?: string;
  }) => {
    if (!selectedProject) return;
    await createCustomQuicksprintTemplate(selectedProject.id, data);
    await reloadQuicksprintTemplates();
  }, [selectedProject, reloadQuicksprintTemplates]);

  const handleUpdateQuicksprintTemplate = useCallback(async (templateId: string, data: {
    name: string; description: string; icon: string; category: string; categoryColor?: string;
    agentInstructionMarkdown: string; defaultTaskCount: number; agentPresetId?: string;
  }) => {
    if (!selectedProject) return;
    await updateCustomQuicksprintTemplate(selectedProject.id, templateId, data);
    await reloadQuicksprintTemplates();
  }, [selectedProject, reloadQuicksprintTemplates]);

  const handleDeleteQuicksprintTemplate = useCallback(async (templateId: string) => {
    if (!selectedProject) return;
    await deleteCustomQuicksprintTemplate(selectedProject.id, templateId);
    await reloadQuicksprintTemplates();
  }, [selectedProject, reloadQuicksprintTemplates]);

  const virtualProviders = useMemo(() => (
    Object.entries(VIRTUAL_PROVIDER_LABELS).map(([id, label]) => ({
      id: id as VirtualWorkerProvider,
      label,
    }))
  ), []);

  return {
    selectedProject,
    sprints,
    sortedSprints,
    showcaseSprints,
    execution,
    loading: sprintsLoading || executionLoading,
    nextId,
    planningRoute,
    completedCount,
    inWorkCount,
    pendingActionIds,
    activeRunsBySprintId,
    interventionBySprintId,
    rowMenu, setRowMenu,
    showCreateComposer, setShowCreateComposer,
    editingSprint, setEditingSprint,
    showImportModal, setShowImportModal,
    exportState, setExportState,
    overrideSprint, setOverrideSprint,
    addTaskForSprint, setAddTaskForSprint,
    addTaskSprintTasks,
    virtualProviders,
    planningEta,
    planningPresets,
    showQuicksprint, setShowQuicksprint,
    quicksprintTemplates,
    quicksprintLoading,
    agentPresets,
    handleQuicksprintExecute,
    handleCreateQuicksprintTemplate,
    handleUpdateQuicksprintTemplate,
    handleDeleteQuicksprintTemplate,
    feedback,
    clearFeedback,
    refreshSprints: refresh,
    refreshExecution,
    handleSprintToggle,
    handleMarkCompleted,
    handleSubmitSprint,
    handleImprovePrompt,
    handleCancelPlanningRequest,
    handleOpenAppendTasks,
    handleAppendTask,
    handleDeleteSprint,
    handleToggleShowcase,
    handleBulkToggleShowcase,
    handleOpenExport,
    handleImportSprint,
  };
}
