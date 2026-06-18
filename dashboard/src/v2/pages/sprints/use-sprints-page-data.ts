import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { 
  AgentPreset, 
  CreateTaskInput, 
  ImprovePromptInput, 
  Sprint, 
  SprintLinkedIssueInput,
  SprintStatus, 
  Task, 
  VirtualWorkerProvider
} from "../../types.js";
import type { AddProjectModalSubmission } from "../../components/ui/AddProjectModal.js";
import type { SystemSettings } from "../../../types.js";
import { fetchSystemSettings } from "../../lib/settings-api.js";
import { getSystemIntegrationProviders } from "../../lib/settings-view-models.js";
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
  fetchTasks,
  importSprintMarkdown,
  improveSprintPrompt,
  planSprint,
  updateSprint,
  cancelPlanningRequest,
} from "../../lib/project-api.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";
import { buildTaskBundle, mergePromptWithLinkedIssues, parseTaskBundle } from "../../lib/markdown-transfer.js";
import { toTaskViewModel } from "../../lib/view-models.js";
import { fetchSprintComposerEta } from "../../lib/api/sprint-composer-client.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { cancelSprintRun, orchestrateSprint, pauseSprintRun, resumeSprintRun } from "../../../lib/api/dashboard-api.js";
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
import {
  buildActualActiveRunsMap,
  buildActiveRunsMap,
  buildDisplaySprints,
  buildPauseResumeRunsMap,
  buildPlanningConnection,
  buildPlanningRoute,
  buildShowcaseSprints,
  buildSortedSprints,
  buildVirtualProviders,
  countInWorkSprints,
  countSprintsByStatus,
} from "./sprints-page-view-models.js";

const DEFAULT_PLANNING_ETA_MS = 180000;

type AddProjectDraft = AddProjectModalSubmission;

export function useSprintsPageData() {
  const [showCreateComposer, setShowCreateComposer] = useState(false);
  const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
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
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(null);

  useEffect(() => {
    fetchSystemSettings().then(setSystemSettings).catch(() => {});
  }, []);
  const [showQuicksprint, setShowQuicksprint] = useState(false);
  const [quicksprintTemplates, setQuicksprintTemplates] = useState<QuicksprintTemplateRecord[]>([]);
  const [quicksprintLoading, setQuicksprintLoading] = useState(false);
  const [planningEta, setPlanningEta] = useState(DEFAULT_PLANNING_ETA_MS);
  const [pendingSprintNumberReservations, setPendingSprintNumberReservations] = useState<Set<number>>(new Set());

  const inFlightStartIds = useRef<Set<string>>(new Set());

  const { feedback, setError, clearFeedback } = useActionFeedback();

  const { projects, selectedProject, createProject } = useProjectData();
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

  const planningPresets = useMemo(() => agentPresets, [agentPresets]);

  const refreshPlanningEta = useCallback(async (projectId: string): Promise<void> => {
    try {
      const eta = await fetchSprintComposerEta(projectId);
      const estimatedMs = Number.isFinite(eta.estimatedMs) && eta.estimatedMs > 0
        ? eta.estimatedMs
        : DEFAULT_PLANNING_ETA_MS;
      setPlanningEta(estimatedMs);
    } catch (error) {
      console.error("Failed to fetch sprint composer ETA", error);
      setPlanningEta(DEFAULT_PLANNING_ETA_MS);
    }
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setPlanningEta(DEFAULT_PLANNING_ETA_MS);
      return;
    }
    void refreshPlanningEta(selectedProject.id);
  }, [refreshPlanningEta, selectedProject?.id]);

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

  const persistedMaxSprintNumber = useMemo(() => (
    sprints.reduce((maxNumber: number, sprint: Sprint) => Math.max(maxNumber, sprint.number || 0), 0)
  ), [sprints]);
  const nextSprintNumber = useMemo(() => (
    persistedMaxSprintNumber + pendingSprintNumberReservations.size + 1
  ), [pendingSprintNumberReservations.size, persistedMaxSprintNumber]);
  const sprintKeyPrefix = effectiveSettings?.settings.git.sprintKeyPrefix || "SPR";
  const defaultAgentRouting = effectiveSettings?.settings.agents.routing;
  const nextId = `${sprintKeyPrefix}-${String(nextSprintNumber).padStart(2, "0")}`;

  const reserveNextSprintNumber = useCallback((): number => {
    let reservedNumber = persistedMaxSprintNumber + 1;
    setPendingSprintNumberReservations((current) => {
      reservedNumber = persistedMaxSprintNumber + current.size + 1;
      const next = new Set(current);
      next.add(reservedNumber);
      return next;
    });
    return reservedNumber;
  }, [persistedMaxSprintNumber]);

  const releaseSprintNumberReservation = useCallback((reservedNumber: number): void => {
    setPendingSprintNumberReservations((current) => {
      if (!current.has(reservedNumber)) {
        return current;
      }
      const next = new Set(current);
      next.delete(reservedNumber);
      return next;
    });
  }, []);

  const actualActiveRunsBySprintId = useMemo(
    () => buildActualActiveRunsMap(execution.sprintRuns),
    [execution.sprintRuns]
  );

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

  const activeRunsBySprintId = useMemo(
    () => buildActiveRunsMap(actualActiveRunsBySprintId, suppressedRunningSprintIds),
    [actualActiveRunsBySprintId, suppressedRunningSprintIds]
  );

  const pauseResumeRunsBySprintId = useMemo(
    () => buildPauseResumeRunsMap(execution.sprintRuns),
    [execution.sprintRuns]
  );

  const interventionBySprintId = useMemo(
    () => getSprintHumanInterventionBySprintId(execution),
    [execution],
  );

  const displaySprints = useMemo(
    () => buildDisplaySprints(sprints, optimisticStatuses, suppressedRunningSprintIds),
    [optimisticStatuses, sprints, suppressedRunningSprintIds]
  );

  const sortedSprints = useMemo(
    () => buildSortedSprints(displaySprints),
    [displaySprints]
  );

  const showcaseSprints = useMemo(
    () => buildShowcaseSprints(sortedSprints),
    [sortedSprints]
  );

  const completedCount = useMemo(
    () => countSprintsByStatus(sortedSprints, "completed"),
    [sortedSprints]
  );

  const inWorkCount = useMemo(
    () => countInWorkSprints(sortedSprints),
    [sortedSprints]
  );

  const planningConnection = useMemo(
    () => buildPlanningConnection(execution.connections),
    [execution.connections]
  );

  const planningRoute = useMemo(
    () => buildPlanningRoute(planningConnection, workerMode),
    [planningConnection, workerMode]
  );

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
    if (inFlightStartIds.current.has(startActionId)) return;
    inFlightStartIds.current.add(startActionId);

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
    }, { waitForActiveRun: true }).finally(() => inFlightStartIds.current.delete(startActionId));
  }, [activeRunsBySprintId, pendingActionIds, runSprintAction, selectedProject]);

  const handleSprintPauseResume = useCallback((sprintId: string) => {
    const run = pauseResumeRunsBySprintId.get(sprintId);
    if (!run) {
      return;
    }

    if (run.status === "paused") {
      const actionId = `sprint-resume:${run.id}`;
      if (pendingActionIds.has(actionId)) {
        return;
      }
      void runSprintAction(actionId, sprintId, async () => {
        await resumeSprintRun(run.id);
      }, { waitForActiveRun: true });
      return;
    }

    const actionId = `sprint-pause:${run.id}`;
    if (pendingActionIds.has(actionId)) {
      return;
    }
    void runSprintAction(actionId, sprintId, async () => {
      await pauseSprintRun(run.id);
    }, { optimisticStatus: "paused" });
  }, [pauseResumeRunsBySprintId, pendingActionIds, runSprintAction]);

  const handleSubmitSprint = useCallback(async (payload: {
    name: string;
    goal: string;
    originalPrompt: string | null;
    submitMode: SprintSubmitMode;
    routeOverride: PlanningRouteOption | null;
    modelOverride: string | null;
    planningAgentPresetId: string | null;
    agentRoutingMode: "MANUAL" | "ORCHESTRATOR";
    workerAgentPresetId: string | null;
    linkedIssues?: SprintLinkedIssueInput[];
    clientRequestId?: string;
    sprintKeyOverride?: string;
    signal?: AbortSignal;
  }): Promise<void> => {
    if (!selectedProject) {
      return;
    }

    const overrides = toPlanningOverrides(
      payload.routeOverride,
      payload.modelOverride,
      payload.planningAgentPresetId,
      payload.agentRoutingMode,
      payload.workerAgentPresetId,
    );
    const linkedIssues = payload.linkedIssues || [];
    const goal = mergePromptWithLinkedIssues(payload.goal, linkedIssues);

    let numberOverride: number | null | undefined = undefined;
    let slugOverride: string | undefined = undefined;

    if (payload.sprintKeyOverride) {
      const prefixEscaped = sprintKeyPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = payload.sprintKeyOverride.match(new RegExp(`^${prefixEscaped}-(\\d+)$`, 'i'));
      if (match) {
        numberOverride = parseInt(match[1], 10);
      } else {
        numberOverride = null;
        slugOverride = payload.sprintKeyOverride;
      }
    }

    if (editingSprint) {
      await updateSprint(editingSprint.id, {
        name: payload.name,
        goal,
        originalPrompt: payload.originalPrompt,
        linkedIssues,
        ...(numberOverride !== undefined ? { number: numberOverride } : {}),
        ...(slugOverride !== undefined ? { slug: slugOverride } : {}),
      });

      if (payload.submitMode === "plan_only" || payload.submitMode === "replan") {
        await planSprint(selectedProject.id, editingSprint.id, {
          autoStart: false,
          replan: payload.submitMode === "replan",
          clientRequestId: payload.clientRequestId,
          planningAgentPresetId: payload.planningAgentPresetId || undefined,
          overrides,
        }, payload.signal);
        await refreshPlanningEta(selectedProject.id);
      } else if (payload.submitMode === "plan_and_start") {
        await planSprint(selectedProject.id, editingSprint.id, {
          autoStart: true,
          replan: false,
          clientRequestId: payload.clientRequestId,
          planningAgentPresetId: payload.planningAgentPresetId || undefined,
          overrides,
        }, payload.signal);
        await refreshPlanningEta(selectedProject.id);
      }

      await refresh();
      setEditingSprint(null);
      return;
    }

    const reservedNumber = numberOverride === undefined ? reserveNextSprintNumber() : null;
    try {
      const created = await createSprint(selectedProject.id, {
        name: payload.name,
        goal,
        originalPrompt: payload.originalPrompt,
        linkedIssues,
        number: numberOverride !== undefined ? numberOverride : reservedNumber,
        ...(slugOverride !== undefined ? { slug: slugOverride } : {}),
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
        await refreshPlanningEta(selectedProject.id);
      } else if (payload.submitMode === "plan_and_start") {
        await planSprint(selectedProject.id, created.id, {
          autoStart: true,
          clientRequestId: payload.clientRequestId,
          planningAgentPresetId: payload.planningAgentPresetId || undefined,
          overrides,
        }, payload.signal);
        await refreshPlanningEta(selectedProject.id);
      }

      await Promise.all([refresh(), refreshExecution()]);
    } finally {
      if (reservedNumber !== null) {
        releaseSprintNumberReservation(reservedNumber);
      }
    }
  }, [editingSprint, refresh, refreshExecution, refreshPlanningEta, releaseSprintNumberReservation, reserveNextSprintNumber, selectedProject, sprintKeyPrefix]);

  const handleImprovePrompt = useCallback(async (draft: ImprovePromptInput, signal?: AbortSignal): Promise<string> => {
    if (!selectedProject) {
      throw new Error("Select a project before using Plan ahead with AI.");
    }
    const response = await improveSprintPrompt(selectedProject.id, draft, signal);
    await refreshPlanningEta(selectedProject.id);
    return response.goal;
  }, [refreshPlanningEta, selectedProject]);

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
    const reservedNumber = reserveNextSprintNumber();
    try {
      await executeQuicksprint(selectedProject.id, {
        templateId,
        taskCount,
        submitMode: submitMode as "plan_only" | "plan_and_start",
        additionalPrompt,
        planningOverrides: toPlanningOverrides(routeOverride ?? null, modelOverride ?? null),
      });
      await refreshPlanningEta(selectedProject.id);
      setShowQuicksprint(false);
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      releaseSprintNumberReservation(reservedNumber);
    }
  }, [refresh, refreshPlanningEta, releaseSprintNumberReservation, reserveNextSprintNumber, selectedProject, setError]);

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

  const handleAddProject = useCallback(async (project: AddProjectDraft): Promise<void> => {
    if (project.type === "new_project") {
      await createProject({
        name: project.name,
        sourceType: project.initMode === "new-local" ? "local" : "git",
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

  const virtualProviders = useMemo(
    () => buildVirtualProviders(systemSettings),
    [systemSettings]
  );

  return {
    projects,
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
    pauseResumeRunsBySprintId,
    interventionBySprintId,
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
    agentPresets,
    defaultPlanningAgentPresetId: defaultAgentRouting?.planning.agentPresetId || null,
    defaultAgentRoutingMode: defaultAgentRouting?.taskCoding.mode || "MANUAL",
    defaultWorkerAgentPresetId: defaultAgentRouting?.taskCoding.agentPresetId || null,
    showQuicksprint, setShowQuicksprint,
    quicksprintTemplates,
    quicksprintLoading,
    handleQuicksprintExecute,
    handleCreateQuicksprintTemplate,
    handleUpdateQuicksprintTemplate,
    handleDeleteQuicksprintTemplate,
    feedback,
    clearFeedback,
    refreshSprints: refresh,
    refreshExecution,
    handleSprintToggle,
    handleSprintPauseResume,
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
    handleAddProject,
  };
}
