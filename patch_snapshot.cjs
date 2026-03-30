const fs = require('fs');
const file = 'src/app/live/project-live-snapshot.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  'import type { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";',
  'import type { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";\nimport type { Logger } from "../../shared/logging/logger.js";'
);

code = code.replace(
  '  getGitStatus: () => Promise<GitTrackingStatus>;\n}',
  '  getGitStatus: () => Promise<GitTrackingStatus>;\n  logger: Logger;\n}'
);

const newLogic = `
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

  const listSprintsResult = deps.projectManagementRepository.listSprints(projectId);
  const selectedSprintId = listSprintsResult.selectedSprintId ?? null;
  const status = deps.projectRuntimeRepository.getProjectStatus(projectId, selectedSprintId);
  const execution = deps.getProjectExecutionSnapshot(projectId);

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

  let gitStatus: GitTrackingStatus | null = null;
  let gitStatusError: string | null = null;
  try {
    gitStatus = await deps.getGitStatus();
  } catch (error) {
    gitStatusError = error instanceof Error
      ? error.message
      : "Unable to load git/ci/pr tracking.";
  }

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
    payloadSizeBytes: Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
  });

  return snapshot;
}
`;

code = code.replace(/export async function getProjectLiveSnapshot\([\s\S]*?^}/m, newLogic.trim());

fs.writeFileSync(file, code);
console.log('patched');
