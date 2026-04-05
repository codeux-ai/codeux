import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";

export const handleTelemetryActions = async (
  args: ManageSprintOsArgs,
  executionRepository: ExecutionRepository
): Promise<ManagementResponseEnvelope> => {
  const { action, payload } = args;

  try {
    switch (action) {
      case "get_project_execution_snapshot": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        if (!projectId) {
          throw new Error("Missing required 'projectId' for get_project_execution_snapshot");
        }
        const snapshot = await executionRepository.getProjectExecutionSnapshot(projectId);
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: snapshot,
          },
        };
      }
      case "get_project_stats_snapshot": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        if (!projectId) {
          throw new Error("Missing required 'projectId' for get_project_stats_snapshot");
        }
        const snapshot = await executionRepository.getProjectStatsSnapshot(projectId);
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: snapshot,
          },
        };
      }
      case "list_sprint_runs": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        if (!projectId || !sprintId) {
          throw new Error("Missing required 'projectId' or 'sprintId' for list_sprint_runs");
        }
        const runs = await executionRepository.listSprintRuns(projectId, sprintId);
        // keep response compact
        const compactRuns = runs.map((run) => ({
          id: run.id,
          sprintId: run.sprintId,
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        }));
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: compactRuns,
          },
        };
      }
      case "list_task_dispatches": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
        if (!projectId || !sprintId || !taskId) {
          throw new Error("Missing required 'projectId', 'sprintId', or 'taskId' for list_task_dispatches");
        }
        const dispatches = await executionRepository.listTaskDispatches({ projectId, sprintId, taskId });
        const compactDispatches = dispatches.map((d) => ({
          id: d.id,
          taskId: d.taskId,
          status: d.status,
          assignedWorkerId: null, // assignedWorkerId doesn't exist on TaskDispatchRecord
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        }));
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: compactDispatches,
          },
        };
      }
      case "list_execution_invocations": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
        const type = typeof payload.type === "string" ? payload.type : undefined;

        if (!projectId) {
          throw new Error("Missing required 'projectId' for list_execution_invocations");
        }

        const invocations = await executionRepository.listExecutionInvocations({ projectId, taskRunId: taskId });
        const compactInvocations = invocations.map((i) => ({
          id: i.id,
          type: i.type,
          status: i.status,
          provider: i.provider,
          messageCount: i.messageCount,
          lastMessageAt: i.lastMessageAt,
          createdAt: i.createdAt,
        }));
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: compactInvocations,
          },
        };
      }
      case "list_execution_invocation_messages": {
        const invocationId = typeof payload.invocationId === "string" ? payload.invocationId : undefined;
        if (!invocationId) {
          throw new Error("Missing required 'invocationId' for list_execution_invocation_messages");
        }
        const messages = await executionRepository.listExecutionInvocationMessages(invocationId);
        const compactMessages = messages.map((m) => ({
          id: m.id,
          invocationId: m.invocationId,
          role: m.role,
          hasToolCalls: false, // toolCalls is not a property
          createdAt: m.createdAt,
        }));
        return {
          result: {
            status: "success",
            domain: "telemetry",
            action,
            data: compactMessages,
          },
        };
      }
      default:
        throw new Error(`Unknown telemetry action: ${action}`);
    }
  } catch (error) {
    throw new Error(`Telemetry action '${action}' failed: ${(error as Error).message}`);
  }
};
