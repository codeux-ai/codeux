import { runCommandStrict } from "./cli-process-runner.js";
import type { SprintPreviewServiceDeps } from "./sprint-preview-service.js";

export interface DockerContainerSummary {
  id: string;
  name: string | null;
  status: string | null;
  labels: Record<string, string>;
}

export interface SprintPreviewRuntimeSnapshot {
  containers: DockerContainerSummary[];
  activeRunsBySprintId: Set<string>;
}

function normalizeDockerState(rawStatus: string | null | undefined): string | null {
  const normalized = String(rawStatus || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("up ")) {
    return "running";
  }
  if (normalized.startsWith("exited ")) {
    return "exited";
  }
  if (normalized.startsWith("created")) {
    return "created";
  }
  if (normalized.startsWith("restarting")) {
    return "restarting";
  }
  return normalized;
}

export async function buildRuntimeSnapshot(deps: SprintPreviewServiceDeps): Promise<SprintPreviewRuntimeSnapshot> {
  const containers: DockerContainerSummary[] = [];
  try {
    const result = await runCommandStrict(
      "docker",
      [
        "ps",
        "-a",
        "--filter", "label=sprint-os.preview=true",
        "--format",
        "{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Label \"sprint-os.project-id\"}}\t{{.Label \"sprint-os.sprint-id\"}}\t{{.Label \"sprint-os.session-id\"}}",
      ],
      process.cwd(),
    );
    const lines = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const [id, name, rawStatus, projectId, sprintId, sessionId] = line.split("\t");
      containers.push({
        id,
        name: name || null,
        status: normalizeDockerState(rawStatus),
        labels: {
          "sprint-os.project-id": projectId || "",
          "sprint-os.sprint-id": sprintId || "",
          "sprint-os.session-id": sessionId || "",
        },
      });
    }
  } catch {
    // Ignore and proceed with empty list
  }

  const activeRunsBySprintId = new Set<string>();
  const projects = deps.projectManagementRepository.listProjects().projects;
  for (const project of projects) {
    const execution = deps.executionRepository.getProjectExecutionSnapshot(project.id);
    for (const run of execution.sprintRuns) {
      if (run.status === "running") {
        activeRunsBySprintId.add(run.sprintId);
      }
    }
  }

  return { containers, activeRunsBySprintId };
}
