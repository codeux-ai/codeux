import { useCallback } from "preact/hooks";
import type {
  CreateTaskInput,
  ImprovePromptInput,
  Sprint,
  SprintLinkedIssueInput,
  SprintStatus,
} from "../../types.js";
import type { AddProjectModalSubmission } from "../../components/ui/AddProjectModal.js";
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
import {
  buildTaskBundle,
  mergePromptWithLinkedIssues,
  parseTaskBundle,
} from "../../lib/markdown-transfer.js";
import { toTaskViewModel } from "../../lib/view-models.js";
import {
  cancelSprintRun,
  orchestrateSprint,
  pauseSprintRun,
  resumeSprintRun,
} from "../../../lib/api/dashboard-api.js";
import {
  toPlanningOverrides,
  type SprintSubmitMode,
  type PlanningRouteOption,
} from "../../lib/sprint-composer-state.js";
import {
  executeQuicksprint,
  createCustomQuicksprintTemplate,
  updateCustomQuicksprintTemplate,
  deleteCustomQuicksprintTemplate,
} from "../../lib/quicksprint-api.js";

export interface SprintsPageActionsDeps {
  selectedProject: any;
  sprints: Sprint[];
  sprintKeyPrefix: string;
  activeRunsBySprintId: Map<string, { id: string; status: string }>;
  pauseResumeRunsBySprintId: Map<string, { id: string; status: string }>;
  pendingActionIds: Set<string>;
  setPendingActionIds: (updater: (current: Set<string>) => Set<string>) => void;
  setOptimisticStatuses: (
    updater: (
      current: Record<string, SprintStatus>,
    ) => Record<string, SprintStatus>,
  ) => void;
  setSuppressedRunningSprintIds: (
    updater: (current: Set<string>) => Set<string>,
  ) => void;
  refresh: () => Promise<any>;
  refreshExecution: () => Promise<any>;
  refreshPlanningEta: (projectId: string) => Promise<void>;
  inFlightStartIds: { current: Set<string> };
  editingSprint: Sprint | null;
  setEditingSprint: (sprint: Sprint | null) => void;
  reserveNextSprintNumber: () => number;
  releaseSprintNumberReservation: (reservedNumber: number) => void;
  setError: (error: string) => void;
  setExportState: (state: any) => void;
  addTaskForSprint: Sprint | null;
  setAddTaskSprintTasks: (tasks: any[]) => void;
  setAddTaskForSprint: (sprint: Sprint | null) => void;
  reloadQuicksprintTemplates: () => Promise<void>;
  createProject: any;
}

export function useSprintsPageActions({
  selectedProject,
  sprints,
  sprintKeyPrefix,
  activeRunsBySprintId,
  pauseResumeRunsBySprintId,
  pendingActionIds,
  setPendingActionIds,
  setOptimisticStatuses,
  setSuppressedRunningSprintIds,
  refresh,
  refreshExecution,
  refreshPlanningEta,
  inFlightStartIds,
  editingSprint,
  setEditingSprint,
  reserveNextSprintNumber,
  releaseSprintNumberReservation,
  setError,
  setExportState,
  addTaskForSprint,
  setAddTaskSprintTasks,
  setAddTaskForSprint,
  reloadQuicksprintTemplates,
  createProject,
}: SprintsPageActionsDeps) {
  const runSprintAction = useCallback(
    async (
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
        setOptimisticStatuses((current) => ({
          ...current,
          [sprintId]: options.optimisticStatus!,
        }));
      }
      try {
        await operation();
        if (options.optimisticStatus === "cancelled") {
          setSuppressedRunningSprintIds((current) =>
            new Set(current).add(sprintId),
          );
        }
        if (options.waitForActiveRun && selectedProject) {
          for (let attempt = 0; attempt < 8; attempt += 1) {
            const snapshot = await fetchProjectExecution(selectedProject.id);
            if (
              snapshot.sprintRuns.some(
                (run: any) =>
                  run.sprintId === sprintId &&
                  (run.status === "running" || run.status === "queued"),
              )
            ) {
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
    },
    [
      refresh,
      refreshExecution,
      selectedProject,
      setOptimisticStatuses,
      setPendingActionIds,
      setSuppressedRunningSprintIds,
      setError,
    ],
  );

  const handleMarkCompleted = useCallback(
    async (sprintId: string) => {
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
    },
    [pendingActionIds, refresh, setError, setPendingActionIds],
  );

  const handleBulkToggleShowcase = useCallback(
    async (sprintIds: string[], state: boolean) => {
      const availableIds = sprintIds.filter(
        (id) => !pendingActionIds.has(`sprint-showcase:${id}`),
      );
      if (availableIds.length === 0) return;

      setPendingActionIds((current) => {
        const next = new Set(current);
        for (const id of availableIds) next.add(`sprint-showcase:${id}`);
        return next;
      });

      try {
        await Promise.all(
          availableIds.map((id) => updateSprintShowcase(id, state)),
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
    },
    [pendingActionIds, refresh, setError, setPendingActionIds],
  );

  const handleSprintToggle = useCallback(
    (sprintId: string) => {
      if (!selectedProject) {
        return;
      }
      const activeRun = activeRunsBySprintId.get(sprintId);
      if (activeRun) {
        const stopActionId = `sprint-stop:${activeRun.id}`;
        void runSprintAction(
          stopActionId,
          sprintId,
          async () => {
            await cancelSprintRun(activeRun.id);
          },
          { optimisticStatus: "cancelled" },
        );
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
      void runSprintAction(
        startActionId,
        sprintId,
        async () => {
          await orchestrateSprint(selectedProject.id, sprintId);
        },
        { waitForActiveRun: true },
      ).finally(() => inFlightStartIds.current.delete(startActionId));
    },
    [
      activeRunsBySprintId,
      pendingActionIds,
      runSprintAction,
      selectedProject,
      setSuppressedRunningSprintIds,
      inFlightStartIds,
    ],
  );

  const handleSprintPauseResume = useCallback(
    (sprintId: string) => {
      const run = pauseResumeRunsBySprintId.get(sprintId);
      if (!run) {
        return;
      }

      if (run.status === "paused") {
        const actionId = `sprint-resume:${run.id}`;
        if (pendingActionIds.has(actionId)) {
          return;
        }
        void runSprintAction(
          actionId,
          sprintId,
          async () => {
            await resumeSprintRun(run.id);
          },
          { waitForActiveRun: true },
        );
        return;
      }

      const actionId = `sprint-pause:${run.id}`;
      if (pendingActionIds.has(actionId)) {
        return;
      }
      void runSprintAction(
        actionId,
        sprintId,
        async () => {
          await pauseSprintRun(run.id);
        },
        { optimisticStatus: "paused" },
      );
    },
    [pauseResumeRunsBySprintId, pendingActionIds, runSprintAction],
  );

  const handleSubmitSprint = useCallback(
    async (payload: {
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
        const prefixEscaped = sprintKeyPrefix.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&",
        );
        const match = payload.sprintKeyOverride.match(
          new RegExp(`^${prefixEscaped}-(\\d+)$`, "i"),
        );
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

        if (
          payload.submitMode === "plan_only" ||
          payload.submitMode === "replan"
        ) {
          await planSprint(
            selectedProject.id,
            editingSprint.id,
            {
              autoStart: false,
              replan: payload.submitMode === "replan",
              clientRequestId: payload.clientRequestId,
              planningAgentPresetId: payload.planningAgentPresetId || undefined,
              overrides,
            },
            payload.signal,
          );
          await refreshPlanningEta(selectedProject.id);
        } else if (payload.submitMode === "plan_and_start") {
          await planSprint(
            selectedProject.id,
            editingSprint.id,
            {
              autoStart: true,
              replan: false,
              clientRequestId: payload.clientRequestId,
              planningAgentPresetId: payload.planningAgentPresetId || undefined,
              overrides,
            },
            payload.signal,
          );
          await refreshPlanningEta(selectedProject.id);
        }

        await refresh();
        setEditingSprint(null);
        return;
      }

      const reservedNumber =
        numberOverride === undefined ? reserveNextSprintNumber() : null;
      try {
        const created = await createSprint(selectedProject.id, {
          name: payload.name,
          goal,
          originalPrompt: payload.originalPrompt,
          linkedIssues,
          number:
            numberOverride !== undefined ? numberOverride : reservedNumber,
          ...(slugOverride !== undefined ? { slug: slugOverride } : {}),
          status: "idle",
          showcasePinned: true,
          startDate: null,
          endDate: null,
        });

        if (payload.submitMode === "plan_only") {
          await planSprint(
            selectedProject.id,
            created.id,
            {
              autoStart: false,
              clientRequestId: payload.clientRequestId,
              planningAgentPresetId: payload.planningAgentPresetId || undefined,
              overrides,
            },
            payload.signal,
          );
          await refreshPlanningEta(selectedProject.id);
        } else if (payload.submitMode === "plan_and_start") {
          await planSprint(
            selectedProject.id,
            created.id,
            {
              autoStart: true,
              clientRequestId: payload.clientRequestId,
              planningAgentPresetId: payload.planningAgentPresetId || undefined,
              overrides,
            },
            payload.signal,
          );
          await refreshPlanningEta(selectedProject.id);
        }

        await Promise.all([refresh(), refreshExecution()]);
      } finally {
        if (reservedNumber !== null) {
          releaseSprintNumberReservation(reservedNumber);
        }
      }
    },
    [
      editingSprint,
      refresh,
      refreshExecution,
      refreshPlanningEta,
      releaseSprintNumberReservation,
      reserveNextSprintNumber,
      selectedProject,
      sprintKeyPrefix,
      setEditingSprint,
    ],
  );

  const handleImprovePrompt = useCallback(
    async (
      draft: ImprovePromptInput,
      signal?: AbortSignal,
    ): Promise<string> => {
      if (!selectedProject) {
        throw new Error("Select a project before using Plan ahead with AI.");
      }
      const response = await improveSprintPrompt(
        selectedProject.id,
        draft,
        signal,
      );
      await refreshPlanningEta(selectedProject.id);
      return response.goal;
    },
    [refreshPlanningEta, selectedProject],
  );

  const handleCancelPlanningRequest = useCallback(
    async (clientRequestId: string): Promise<void> => {
      await cancelPlanningRequest(clientRequestId);
    },
    [],
  );

  const handleOpenAppendTasks = useCallback(
    async (sprint: Sprint) => {
      if (!selectedProject) return;
      try {
        const taskRecords = await fetchTasks(selectedProject.id, sprint.id);
        const sprintsById = new Map<string, Sprint>(
          sprints.map((s: Sprint) => [s.id, s]),
        );
        const tasks = taskRecords.map((t: any) =>
          toTaskViewModel(t, new Map(), sprintsById),
        );
        setAddTaskSprintTasks(tasks);
        setAddTaskForSprint(sprint);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    [
      selectedProject,
      sprints,
      setError,
      setAddTaskSprintTasks,
      setAddTaskForSprint,
    ],
  );

  const handleAppendTask = useCallback(
    async (draft: {
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
      if (addTaskForSprint) {
        const taskRecords = await fetchTasks(
          selectedProject.id,
          addTaskForSprint.id,
        );
        const sprintsById = new Map<string, Sprint>(
          sprints.map((s: Sprint) => [s.id, s]),
        );
        setAddTaskSprintTasks(
          taskRecords.map((t: any) =>
            toTaskViewModel(t, new Map(), sprintsById),
          ),
        );
      }
    },
    [
      addTaskForSprint,
      refresh,
      selectedProject,
      sprints,
      setAddTaskSprintTasks,
    ],
  );

  const handleDeleteSprint = useCallback(
    async (sprintId: string) => {
      await deleteSprint(sprintId);
      await Promise.all([refresh(), refreshExecution()]);
    },
    [refresh, refreshExecution],
  );

  const handleToggleShowcase = useCallback(
    async (sprint: Sprint) => {
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
    },
    [pendingActionIds, refresh, setPendingActionIds, setError],
  );

  const handleOpenExport = useCallback(
    async (sprintId: string, sprintName: string) => {
      if (!selectedProject) {
        return;
      }
      const bundle = await exportSprintMarkdown(selectedProject.id, sprintId);
      setExportState({
        sprintLabel: sprintName,
        sprintMarkdown: bundle.sprint.markdown,
        tasksMarkdown: buildTaskBundle(bundle.tasks),
      });
    },
    [selectedProject, setExportState],
  );

  const handleImportSprint = useCallback(
    async (payload: { sprintMarkdown: string; tasksMarkdown: string }) => {
      if (!selectedProject) {
        return;
      }
      await importSprintMarkdown(selectedProject.id, {
        sprintMarkdown: payload.sprintMarkdown,
        tasks: parseTaskBundle(payload.tasksMarkdown),
      });
      await refresh();
    },
    [refresh, selectedProject],
  );

  const handleQuicksprintExecute = useCallback(
    async (
      templateId: string,
      taskCount: number,
      submitMode: string,
      additionalPrompt?: string,
      routeOverride?: PlanningRouteOption | null,
      modelOverride?: string | null,
      signal?: AbortSignal,
      options?: { shouldHandleResult?: () => boolean },
    ) => {
      if (!selectedProject) return;
      const reservedNumber = reserveNextSprintNumber();
      try {
        await executeQuicksprint(
          selectedProject.id,
          {
            templateId,
            taskCount,
            submitMode: submitMode as "plan_only" | "plan_and_start",
            additionalPrompt,
            planningOverrides: toPlanningOverrides(
              routeOverride ?? null,
              modelOverride ?? null,
            ),
          },
          signal,
        );
        await Promise.all([refreshPlanningEta(selectedProject.id), refresh()]);
      } catch (error) {
        if (options?.shouldHandleResult?.() ?? true) {
          setError(error instanceof Error ? error.message : String(error));
        }
        throw error;
      } finally {
        releaseSprintNumberReservation(reservedNumber);
      }
    },
    [
      refresh,
      refreshPlanningEta,
      releaseSprintNumberReservation,
      reserveNextSprintNumber,
      selectedProject,
      setError,
    ],
  );

  const handleCreateQuicksprintTemplate = useCallback(
    async (data: {
      name: string;
      description: string;
      icon: string;
      category: string;
      categoryColor?: string;
      agentInstructionMarkdown: string;
      defaultTaskCount: number;
      agentPresetId?: string;
    }) => {
      if (!selectedProject) return;
      await createCustomQuicksprintTemplate(selectedProject.id, data);
      await reloadQuicksprintTemplates();
    },
    [selectedProject, reloadQuicksprintTemplates],
  );

  const handleUpdateQuicksprintTemplate = useCallback(
    async (
      templateId: string,
      data: {
        name: string;
        description: string;
        icon: string;
        category: string;
        categoryColor?: string;
        agentInstructionMarkdown: string;
        defaultTaskCount: number;
        agentPresetId?: string;
      },
    ) => {
      if (!selectedProject) return;
      await updateCustomQuicksprintTemplate(
        selectedProject.id,
        templateId,
        data,
      );
      await reloadQuicksprintTemplates();
    },
    [selectedProject, reloadQuicksprintTemplates],
  );

  const handleDeleteQuicksprintTemplate = useCallback(
    async (templateId: string) => {
      if (!selectedProject) return;
      await deleteCustomQuicksprintTemplate(selectedProject.id, templateId);
      await reloadQuicksprintTemplates();
    },
    [selectedProject, reloadQuicksprintTemplates],
  );

  const handleAddProject = useCallback(
    async (project: AddProjectModalSubmission): Promise<void> => {
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
    },
    [createProject],
  );

  return {
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
    handleQuicksprintExecute,
    handleCreateQuicksprintTemplate,
    handleUpdateQuicksprintTemplate,
    handleDeleteQuicksprintTemplate,
    handleAddProject,
  };
}
