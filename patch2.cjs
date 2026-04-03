const fs = require('fs');
const code = `import type {
  ProjectLiveDashboardSnapshot,
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
} from "../../contracts/app-types.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";
import type { Logger } from "../../shared/logging/logger.js";

export interface ProjectLiveSnapshotDeps {
  projectManagementRepository: ProjectManagementRepository;
  projectRuntimeRepository: ProjectRuntimeRepository;
  getProjectExecutionSnapshot: (projectId: string) => ExecutionDashboardSnapshot;
  getGitStatus: () => Promise<GitTrackingStatus>;
  logger: Logger;
}

/**
 * The unified assembly path for the Live snapshot.
 *
 * Boundary Contract:
 * - SQLite is the absolute source of truth.
 * - The server assembles the snapshot (this module).
 * - Websockets transport committed snapshot changes.
 * - The browser renders the snapshot without reconciling competing sources.
 *
 * Field Ownership & Mutation Triggers:
 * - \\\`projectId\\\`: Owned by \\\`ProjectManagementRepository\\\`. Mutated when a project is selected or created.
 * - \\\`selectedSprintId\\\`: Owned by \\\`ProjectManagementRepository\\\`. Mutated when a sprint is selected or changed.
 * - \\\`status\\\`: Owned by \\\`ProjectRuntimeRepository\\\`. Mutated when task states change, a sprint is run, or orchestration loop updates progress.
 * - \\\`execution\\\`: Owned by \\\`ExecutionRepository\\\` (via \\\`getProjectExecutionSnapshot\\\`). Mutated when sprint runs are dispatched, worker states change, or attention items are created/claimed.
 * - \\\`gitStatus\\\` / \\\`gitStatusError\\\`: Owned by the external git system. Mutated when local branches or upstream changes are detected.
 * - \\\`updatedAt\\\`: Owned by this assembly module. Mutated upon every assembly call to track the snapshot timestamp.
 */
export async function getProjectLiveSnapshot(
  deps: ProjectLiveSnapshotDeps,
  projectIdHint?: string | null,
): Promise<ProjectLiveDashboardSnapshot> {
  const startedAt = Date.now();
  const projectId = typeof projectIdHint === "string" && projectIdHint.trim().length > 0
    ? projectIdHint.trim()
    : deps.projectManagementRepository.getSelectedProjectId();

  if (!projectId) {
    deps.logger.warn("malformed_snapshot_identity", {
      reason: "projectId is missing",
      projectIdHint,
    });
    return {
      projectId: null,
      selectedSprintId: null,
      status: { subtasks: [], timestamp: null },
      execution: {
        projectId: null,
        projectName: null,
        sprintRuns: [],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: null,
      },
      gitStatus: null,
      gitStatusError: null,
      updatedAt: null,
    };
  }

  const tMgmt = Date.now();
  const listSprintsResult = deps.projectManagementRepository.listSprints(projectId);
  const projectMgmtMs = Date.now() - tMgmt;

  const selectedSprintId = listSprintsResult.selectedSprintId ?? null;

  const tGit = Date.now();
  const gitStatusPromise = deps.getGitStatus()
    .then((result) => ({ result, error: null }))
    .catch((error) => ({
      result: null,
      error: error instanceof Error ? error.message : "Unable to load git/ci/pr tracking.",
    }));

  const tRuntime = Date.now();
  const status = deps.projectRuntimeRepository.getProjectStatus(projectId, selectedSprintId);
  const runtimeMs = Date.now() - tRuntime;

  const tExecution = Date.now();
  const execution = deps.getProjectExecutionSnapshot(projectId);
  const executionMs = Date.now() - tExecution;

  const { result: gitStatus, error: gitStatusError } = await gitStatusPromise;
  const gitMs = Date.now() - tGit;

  if (!selectedSprintId && execution.sprintRuns.some(r => r.status === 'running' || r.status === 'queued')) {
    deps.logger.warn("selected_sprint_missing_while_active", {
      projectId,
      activeRunsCount: execution.sprintRuns.filter(r => r.status === 'running' || r.status === 'queued').length,
    });
  }

  if (selectedSprintId && !listSprintsResult.sprints.some(s => s.id === selectedSprintId)) {
    deps.logger.warn("selected_sprint_outside_project", {
      projectId,
      selectedSprintId,
    });
  }

  if (execution.projectId && execution.projectId !== projectId) {
    deps.logger.warn("active_runs_mismatch_snapshot_scope", {
      requestedProjectId: projectId,
      executionProjectId: execution.projectId,
    });
  }

  const executionItemCount =
    execution.sprintRuns.length +
    execution.taskDispatches.length +
    execution.connections.length +
    execution.attentionItems.length +
    execution.recentEvents.length;
  const statusSubtaskCount = status.subtasks.length;

  const snapshot: ProjectLiveDashboardSnapshot = {
    projectId,
    selectedSprintId,
    status,
    execution,
    gitStatus,
    gitStatusError,
    updatedAt: new Date().toISOString(),
  };

  deps.logger.info("project_live_snapshot_assembled", {
    projectId,
    buildTimeMs: Date.now() - startedAt,
    projectMgmtMs,
    runtimeMs,
    executionMs,
    gitMs,
    executionItemCount,
    statusSubtaskCount,
    hasGitStatus: !!gitStatus,
  });

  return snapshot;
}
`;
fs.writeFileSync('src/app/live/project-live-snapshot.ts', code);
