import { useSprintsPageModals } from "./use-sprints-page-modals.js";
import { useSprintsPageActions } from "./use-sprints-page-actions.js";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";
import type {
  AgentPreset,
  Sprint,
  SprintStatus,
  VirtualWorkerProvider,
} from "../../types.js";
import type { AddProjectModalSubmission } from "../../components/ui/AddProjectModal.js";
import type { SystemSettings } from "../../../types.js";
import { fetchSystemSettings } from "../../lib/settings-api.js";
import {
  getDefaultModelOptionLabel,
  getDefaultRouteOptionLabel,
  getProviderDisplayMetadata,
  getVirtualProviderDisplayMetadata,
} from "../../lib/settings-view-models.js";
import { useProjectData } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import { useExecutions } from "../../../hooks/useExecutions.js";
import { fetchProjectExecution } from "../../lib/project-api.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";

import { fetchSprintComposerEta } from "../../lib/api/sprint-composer-client.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";

import { getSprintHumanInterventionBySprintId } from "../../../lib/execution-intervention.js";
import {
  filterShowcaseSprints,
  sortSprintsByRecency,
} from "../../lib/sprint-gallery.js";

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
  countInWorkSprints,
  countSprintsByStatus,
} from "./sprints-page-view-models.js";

const DEFAULT_PLANNING_ETA_MS = 180000;

type AddProjectDraft = AddProjectModalSubmission;

export function useSprintsPageData() {
  const {
    showCreateComposer,
    setShowCreateComposer,
    editingSprint,
    setEditingSprint,
    showImportModal,
    setShowImportModal,
    exportState,
    setExportState,
    overrideSprint,
    setOverrideSprint,
    addTaskForSprint,
    setAddTaskForSprint,
    addTaskSprintTasks,
    setAddTaskSprintTasks,
    showQuicksprint,
    setShowQuicksprint,
  } = useSprintsPageModals();

  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(
    new Set(),
  );
  const [optimisticStatuses, setOptimisticStatuses] = useState<
    Record<string, SprintStatus>
  >({});
  const [suppressedRunningSprintIds, setSuppressedRunningSprintIds] = useState<
    Set<string>
  >(new Set());

  const [workerMode, setWorkerMode] = useState<null | {
    executionMode: "VIRTUAL";
    virtualWorkerProvider: string;
  }>(null);
  const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
  const [systemSettings, setSystemSettings] = useState<SystemSettings | null>(
    null,
  );

  useEffect(() => {
    fetchSystemSettings()
      .then(setSystemSettings)
      .catch(() => {});
  }, []);

  const [quicksprintTemplates, setQuicksprintTemplates] = useState<
    QuicksprintTemplateRecord[]
  >([]);
  const [quicksprintLoading, setQuicksprintLoading] = useState(false);
  const [planningEta, setPlanningEta] = useState(DEFAULT_PLANNING_ETA_MS);
  const [pendingSprintNumberReservations, setPendingSprintNumberReservations] =
    useState<Set<number>>(new Set());

  const inFlightStartIds = useRef<Set<string>>(new Set());

  const { feedback, setError, clearFeedback } = useActionFeedback();

  const { projects, selectedProject, createProject } = useProjectData();
  const {
    data: sprints,
    refetch: refresh,
    loading: sprintsLoading,
  } = useSprints(selectedProject?.id || null);
  const {
    data: execution,
    refetch: refreshExecution,
    loading: executionLoading,
  } = useExecutions(selectedProject?.id || null);

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

  const refreshPlanningEta = useCallback(
    async (projectId: string): Promise<void> => {
      try {
        const eta = await fetchSprintComposerEta(projectId);
        const estimatedMs =
          Number.isFinite(eta.estimatedMs) && eta.estimatedMs > 0
            ? eta.estimatedMs
            : DEFAULT_PLANNING_ETA_MS;
        setPlanningEta(estimatedMs);
      } catch (error) {
        console.error("Failed to fetch sprint composer ETA", error);
        setPlanningEta(DEFAULT_PLANNING_ETA_MS);
      }
    },
    [],
  );

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

  const { data: effectiveSettings } = useProjectEffectiveSettings(
    selectedProject?.id || null,
  );

  useEffect(() => {
    if (!selectedProject || !effectiveSettings) {
      setWorkerMode(null);
      return;
    }
    setWorkerMode({
      executionMode: effectiveSettings.settings.workers.executionMode,
      virtualWorkerProvider:
        effectiveSettings.settings.workers.virtualWorkerProvider,
    });
  }, [selectedProject?.id, effectiveSettings]);

  const persistedMaxSprintNumber = useMemo(
    () =>
      sprints.reduce(
        (maxNumber: number, sprint: Sprint) =>
          Math.max(maxNumber, sprint.number || 0),
        0,
      ),
    [sprints],
  );
  const nextSprintNumber = useMemo(
    () => persistedMaxSprintNumber + pendingSprintNumberReservations.size + 1,
    [pendingSprintNumberReservations.size, persistedMaxSprintNumber],
  );
  const sprintKeyPrefix =
    effectiveSettings?.settings.git.sprintKeyPrefix || "SPR";
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

  const releaseSprintNumberReservation = useCallback(
    (reservedNumber: number): void => {
      setPendingSprintNumberReservations((current) => {
        if (!current.has(reservedNumber)) {
          return current;
        }
        const next = new Set(current);
        next.delete(reservedNumber);
        return next;
      });
    },
    [],
  );

  const actualActiveRunsBySprintId = useMemo(
    () => buildActualActiveRunsMap(execution.sprintRuns),
    [execution.sprintRuns],
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
    () =>
      buildActiveRunsMap(
        actualActiveRunsBySprintId,
        suppressedRunningSprintIds,
      ),
    [actualActiveRunsBySprintId, suppressedRunningSprintIds],
  );

  const pauseResumeRunsBySprintId = useMemo(
    () => buildPauseResumeRunsMap(execution.sprintRuns),
    [execution.sprintRuns],
  );

  const interventionBySprintId = useMemo(
    () => getSprintHumanInterventionBySprintId(execution),
    [execution],
  );

  const displaySprints = useMemo(
    () =>
      buildDisplaySprints(
        sprints,
        optimisticStatuses,
        suppressedRunningSprintIds,
      ),
    [optimisticStatuses, sprints, suppressedRunningSprintIds],
  );

  const sortedSprints = useMemo(
    () => buildSortedSprints(displaySprints),
    [displaySprints],
  );

  const showcaseSprints = useMemo(
    () => buildShowcaseSprints(sortedSprints),
    [sortedSprints],
  );

  const completedCount = useMemo(
    () => countSprintsByStatus(sortedSprints, "completed"),
    [sortedSprints],
  );

  const inWorkCount = useMemo(
    () => countInWorkSprints(sortedSprints),
    [sortedSprints],
  );

  const planningConnection = useMemo(
    () => buildPlanningConnection(execution.connections),
    [execution.connections],
  );

  const planningRoute = useMemo(
    () => buildPlanningRoute(planningConnection, workerMode),
    [planningConnection, workerMode],
  );

  const reloadQuicksprintTemplates = useCallback(async () => {
    if (!selectedProject) return;
    try {
      const templates = await fetchQuicksprintTemplates(selectedProject.id);
      setQuicksprintTemplates(templates);
    } catch (error) {
      console.error("Failed to reload quicksprint templates", error);
    }
  }, [selectedProject]);

  const actions = useSprintsPageActions({
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
    setShowQuicksprint,
    reloadQuicksprintTemplates,
    createProject,
  });

  const virtualProviders = useMemo(
    () => getVirtualProviderDisplayMetadata(systemSettings),
    [systemSettings],
  );
  const defaultVirtualProvider = useMemo(
    () => workerMode?.virtualWorkerProvider
      ? getProviderDisplayMetadata(
        systemSettings,
        workerMode.virtualWorkerProvider,
        effectiveSettings?.settings.workers.model,
      )
      : null,
    [effectiveSettings?.settings.workers.model, systemSettings, workerMode?.virtualWorkerProvider],
  );
  const defaultRouteOptionLabel = useMemo(
    () => getDefaultRouteOptionLabel(defaultVirtualProvider),
    [defaultVirtualProvider],
  );
  const defaultModelOptionLabel = useMemo(
    () => getDefaultModelOptionLabel(defaultVirtualProvider),
    [defaultVirtualProvider],
  );

  return {
    ...actions,
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
    showCreateComposer,
    setShowCreateComposer,
    editingSprint,
    setEditingSprint,
    showImportModal,
    setShowImportModal,
    exportState,
    setExportState,
    overrideSprint,
    setOverrideSprint,
    addTaskForSprint,
    setAddTaskForSprint,
    addTaskSprintTasks,
    virtualProviders,
    defaultRouteOptionLabel,
    defaultModelOptionLabel,
    defaultRouteIconProviderId: defaultVirtualProvider?.iconProviderId || null,
    planningEta,
    planningPresets,
    agentPresets,
    defaultPlanningAgentPresetId:
      defaultAgentRouting?.planning.agentPresetId || null,
    defaultAgentRoutingMode: defaultAgentRouting?.taskCoding.mode || "MANUAL",
    defaultWorkerAgentPresetId:
      defaultAgentRouting?.taskCoding.agentPresetId || null,
    showQuicksprint,
    setShowQuicksprint,
    quicksprintTemplates,
    quicksprintLoading,

    feedback,
    clearFeedback,
    refreshSprints: refresh,
    refreshExecution,
  };
}
