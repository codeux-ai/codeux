import { useCallback, useMemo } from "preact/hooks";
import type {
  CreateTaskInput,
  ImprovePromptInput,
  Sprint,
  SprintImportedTaskInput,
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
  updateSprintBranch,
  markSprintCompleted,
  markSprintQaPassed,
  cancelPlanningRequest,
  addImportedTasksToSprint,
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
  type SprintSchedulePayload,
} from "../../lib/sprint-composer-state.js";
import {
  executeQuicksprint,
  createCustomQuicksprintTemplate,
  updateCustomQuicksprintTemplate,
  deleteCustomQuicksprintTemplate,
} from "../../lib/quicksprint-api.js";
import { createSchedulerEntry } from "../../lib/scheduler-api.js";
import { SprintPageActionRunner } from "../../lib/sprint-page-action-runner.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../lib/settings.js";
import { buildProjectCreationSettingsOverride } from "../../../lib/settings-updaters.js";

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
  setSuccess: (message: string) => void;
  setExportState: (state: any) => void;
  addTaskForSprint: Sprint | null;
  setAddTaskSprintTasks: (tasks: any[]) => void;
  setAddTaskForSprint: (sprint: Sprint | null) => void;
  reloadQuicksprintTemplates: () => Promise<void>;
  createProject: any;
}

interface ImportedTaskSubmissionCallbacks {
  onPending?: (count: number) => void;
  onSuccess?: (count: number) => void;
  onError?: (message: string) => void;
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
  setSuccess,
  setExportState,
  addTaskForSprint,
  setAddTaskSprintTasks,
  setAddTaskForSprint,
  reloadQuicksprintTemplates,
  createProject,
}: SprintsPageActionsDeps) {
  const checkActiveRun = useCallback(
    async (sprintId: string) => {
      if (!selectedProject) return false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const snapshot = await fetchProjectExecution(selectedProject.id);
        if (
          snapshot.sprintRuns.some(
            (run: any) =>
              run.sprintId === sprintId &&
              (run.status === "running" || run.status === "queued"),
          )
        ) {
          return true;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 250));
      }
      return false;
    },
    [selectedProject],
  );

  const actionRunner = useMemo(
    () =>
      new SprintPageActionRunner({
        pendingActionIds,
        setPendingActionIds,
        setOptimisticStatuses,
        setSuppressedRunningSprintIds,
        refresh,
        refreshExecution,
        setError,
        checkActiveRun,
      }),
    [
      pendingActionIds,
      setPendingActionIds,
      setOptimisticStatuses,
      setSuppressedRunningSprintIds,
      refresh,
      refreshExecution,
      setError,
      checkActiveRun,
    ],
  );

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
      await actionRunner.runAction(actionId, sprintId, operation, {
        ...options,
        rethrow: true,
      });
    },
    [actionRunner],
  );

  const handleMarkCompleted = useCallback(
    async (sprintId: string) => {
      await actionRunner.runAction(
        `sprint-mark-completed:${sprintId}`,
        sprintId,
        async () => {
          await markSprintCompleted(sprintId);
        },
        { optimisticStatus: "completed" },
      );
    },
    [actionRunner],
  );

  const handleMarkQaPassed = useCallback(
    async (sprintId: string) => {
      await actionRunner.runAction(
        `sprint-mark-qa-passed:${sprintId}`,
        sprintId,
        async () => {
          await markSprintQaPassed(sprintId);
        },
      );
    },
    [actionRunner],
  );

  const handleBulkToggleShowcase = useCallback(
    async (sprintIds: string[], state: boolean) => {
      const actionIds = sprintIds.map((id) => `sprint-showcase:${id}`);
      await actionRunner.runAction(actionIds, null, async (availableIds) => {
        const idsToUpdate = availableIds.map((actionId) =>
          actionId.replace("sprint-showcase:", ""),
        );
        await Promise.all(
          idsToUpdate.map((id) => updateSprintShowcase(id, state)),
        );
      });
    },
    [actionRunner],
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
      importedTasks?: SprintImportedTaskInput[];
      importedTaskCallbacks?: ImportedTaskSubmissionCallbacks;
      schedule?: SprintSchedulePayload;
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
      const importedTasks = payload.importedTasks || [];
      const importedTaskCallbacks = payload.importedTaskCallbacks;
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
        const updated = await updateSprint(editingSprint.id, {
          name: payload.name,
          goal,
          originalPrompt: payload.originalPrompt,
          linkedIssues,
          ...(numberOverride !== undefined ? { number: numberOverride } : {}),
          ...(slugOverride !== undefined ? { slug: slugOverride } : {}),
        });

        if (importedTasks.length > 0) {
          importedTaskCallbacks?.onPending?.(importedTasks.length);
          try {
            await addImportedTasksToSprint(selectedProject.id, editingSprint.id, importedTasks);
            importedTaskCallbacks?.onSuccess?.(importedTasks.length);
          } catch (error) {
            importedTaskCallbacks?.onError?.(error instanceof Error ? error.message : String(error));
            throw error;
          }
        }

        if (payload.submitMode === "schedule") {
          if (!payload.schedule) {
            throw new Error("Choose when this sprint should be scheduled.");
          }
          await createSchedulerEntry(selectedProject.id, {
            title: `Start ${updated.name}`,
            targetType: "sprint",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            ...payload.schedule,
            sprintTarget: { sprintId: updated.id },
          });
          await refresh();
          setEditingSprint(null);
          return;
        }

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

        if (importedTasks.length > 0) {
          importedTaskCallbacks?.onPending?.(importedTasks.length);
          try {
            await addImportedTasksToSprint(selectedProject.id, created.id, importedTasks);
            importedTaskCallbacks?.onSuccess?.(importedTasks.length);
          } catch (error) {
            importedTaskCallbacks?.onError?.(error instanceof Error ? error.message : String(error));
            throw error;
          }
        }

        if (payload.submitMode === "schedule") {
          if (!payload.schedule) {
            throw new Error("Choose when this sprint should be scheduled.");
          }
          await createSchedulerEntry(selectedProject.id, {
            title: `Start ${created.name}`,
            targetType: "sprint",
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
            ...payload.schedule,
            sprintTarget: { sprintId: created.id },
          });
          await Promise.all([refresh(), refreshExecution()]);
          return;
        }

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
      await actionRunner.runAction(
        `sprint-showcase:${sprint.id}`,
        sprint.id,
        async () => {
          await updateSprint(sprint.id, {
            showcasePinned: !sprint.showcasePinned,
          });
        },
      );
    },
    [actionRunner],
  );

  const handleUpdateBranch = useCallback(
    async (sprint: Sprint) => {
      if (!selectedProject) return;
      let resultMessage: string | null = null;
      await actionRunner.runAction(
        `sprint-update-branch:${sprint.id}`,
        sprint.id,
        async () => {
          const result = await updateSprintBranch(selectedProject.id, sprint.id);
          resultMessage = result.status === "advanced"
            ? `Updated ${result.featureBranch} to the latest ${result.defaultBranch}.`
            : `${result.featureBranch} is already current with ${result.defaultBranch}.`;
        },
      );
      if (resultMessage) {
        setSuccess(resultMessage);
      }
    },
    [actionRunner, selectedProject, setSuccess],
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
      options?: { shouldHandleResult?: () => boolean; noTaskLimit?: boolean },
    ) => {
      if (!selectedProject) return;
      const reservedNumber = reserveNextSprintNumber();
      try {
        await executeQuicksprint(
          selectedProject.id,
          {
            templateId,
            taskCount,
            noTaskLimit: options?.noTaskLimit ?? false,
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

  const handleQuicksprintSchedule = useCallback(
    async (input: {
      templateId: string;
      taskCount: number;
      noTaskLimit: boolean;
      submitMode: "plan_only" | "plan_and_start";
      additionalPrompt?: string;
      routeOverride?: PlanningRouteOption | null;
      modelOverride?: string | null;
      schedule: SprintSchedulePayload;
      title?: string;
    }): Promise<void> => {
      if (!selectedProject) return;
      await createSchedulerEntry(selectedProject.id, {
        title: input.title || "Scheduled quicksprint",
        targetType: "quicksprint",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ...input.schedule,
        quicksprintTarget: {
          templateId: input.templateId,
          taskCount: input.taskCount,
          noTaskLimit: input.noTaskLimit,
          submitMode: input.submitMode,
          additionalPrompt: input.additionalPrompt?.trim() || undefined,
          planningOverrides: toPlanningOverrides(
            input.routeOverride ?? null,
            input.modelOverride ?? null,
          ),
        },
      });
      await refresh();
    },
    [refresh, selectedProject],
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
        const isLocalProject = project.initMode === "new-local";
        await createProject({
          name: project.name,
          sourceType: isLocalProject ? "local" : "git",
          sourceRef: isLocalProject ? (project.path || project.name) : (project.repoSlug || project.name),
          initMode: project.initMode,
          remoteProvider: project.remoteProvider,
          isPrivate: project.isPrivate,
          settingsOverrides: buildProjectCreationSettingsOverride({
            ...(isLocalProject ? { githubMode: "LOCAL" as const } : {}),
            selectedTechstackId: project.selectedTechstackId ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId,
            applicationKind: project.applicationKind ?? null,
          }),
        });
        return;
      }

      await createProject({
        name: project.name,
        sourceType: project.type,
        sourceRef: project.path,
        cloneDir: project.cloneDir,
        ...(project.type === "local" ? { settingsOverrides: buildProjectCreationSettingsOverride({ githubMode: "LOCAL" }) } : {}),
      });
    },
    [createProject],
  );

  return {
    handleSprintToggle,
    handleSprintPauseResume,
    handleMarkCompleted,
    handleMarkQaPassed,
    handleSubmitSprint,
    handleImprovePrompt,
    handleCancelPlanningRequest,
    handleOpenAppendTasks,
    handleAppendTask,
    handleDeleteSprint,
    handleToggleShowcase,
    handleUpdateBranch,
    handleBulkToggleShowcase,
    handleOpenExport,
    handleImportSprint,
    handleQuicksprintExecute,
    handleQuicksprintSchedule,
    handleCreateQuicksprintTemplate,
    handleUpdateQuicksprintTemplate,
    handleDeleteQuicksprintTemplate,
    handleAddProject,
  };
}
