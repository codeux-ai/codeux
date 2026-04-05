import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ManagementResponseEnvelope, ManagementApproval } from "../../contracts/internal-management-types.js";
import type { CreateProjectInput, UpdateProjectInput } from "../../contracts/project-management-types.js";

export function handleProjectAction(
  action: string,
  payload: Record<string, unknown>,
  repository: ProjectManagementRepository,
  domain: string,
  approval?: ManagementApproval
): ManagementResponseEnvelope {
  switch (action) {
    case "list": {
      const result = repository.listProjects();
      return { result };
    }
    case "get": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      const result = repository.getProject(projectId);
      return { result };
    }
    case "create": {
      const input = payload as unknown as CreateProjectInput;
      const result = repository.createProject(input);
      return { result };
    }
    case "update": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      const input = payload as unknown as UpdateProjectInput;
      const result = repository.updateProject(projectId, input);
      return { result };
    }
    case "select": {
      const projectId = payload.projectId as string | null;
      const result = repository.setSelectedProjectId(projectId);
      return { result: { selectedProjectId: result } };
    }
    case "delete": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      if (approval?.confirmed !== true) {
        return {
          approvalRequired: true,
          approvalMessage: `The action 'delete' is destructive and requires explicit approval. Please review the changes and call this tool again with approval.confirmed set to true.`,
        };
      }
      repository.deleteProject(projectId);
      return { result: { status: "success", deletedProjectId: projectId } };
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
