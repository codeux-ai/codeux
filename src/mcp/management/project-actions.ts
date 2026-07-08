import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ManagementResponseEnvelope, ManagementApproval } from "../../contracts/internal-management-types.js";
import type { CreateProjectInput, ProjectSetupRequestInput, UpdateProjectInput } from "../../contracts/project-management-types.js";
import type { ProjectSetupService } from "../../services/project-setup-service.js";

export type ProjectCreateHandler = (input: CreateProjectInput) => Promise<unknown> | unknown;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function normalizeProjectSetupPayload(payload: Record<string, unknown>): ProjectSetupRequestInput {
  const nestedSetup = asRecord(payload.setup);
  const source = nestedSetup ?? payload;
  const options = asRecord(source.options);
  const normalized: ProjectSetupRequestInput = {};
  if (typeof source.enabled === "boolean") {
    normalized.enabled = source.enabled;
  }
  if (typeof source.clientRequestId === "string") {
    normalized.clientRequestId = source.clientRequestId;
  }
  if (options) {
    normalized.options = options as ProjectSetupRequestInput["options"];
  }
  return normalized;
}

export function handleProjectAction(
  action: string,
  payload: Record<string, unknown>,
  repository: ProjectManagementRepository,
  domain: string,
  approval?: ManagementApproval,
  projectSetupService?: ProjectSetupService,
  createProject?: ProjectCreateHandler,
): Promise<ManagementResponseEnvelope> | ManagementResponseEnvelope {
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
      const create = createProject ?? ((projectInput: CreateProjectInput) => repository.createProject(projectInput));
      const result = create(input);
      if (result instanceof Promise) {
        return result.then((created) => ({ result: created }));
      }
      return { result };
    }
    case "setup": {
      const projectId = payload.projectId as string;
      if (!projectId) {
        throw new Error("Missing projectId in payload");
      }
      if (!projectSetupService) {
        throw new Error("Project setup service is not enabled.");
      }
      return projectSetupService
        .setupProject(projectId, normalizeProjectSetupPayload(payload))
        .then((result) => ({ result }));
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
