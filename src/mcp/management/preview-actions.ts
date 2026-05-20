import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { SprintPreviewService } from "../../services/sprint-preview-service.js";
import { buildPreviewUrl } from "../../server/preview-origin.js";

export class PreviewActions {
  constructor(private readonly sprintPreviewService: SprintPreviewService) {}

  async handlePreviewAction(
    args: ManageCodeUxArgs,
    currentHost: string | null
  ): Promise<ManagementResponseEnvelope> {
    const { action, payload, approval } = args;

    try {
      switch (action) {
        case "list_sessions": {
          const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
          if (!projectId) {
            throw new Error("Missing required 'projectId' for list_sessions");
          }
          const sessions = await this.sprintPreviewService.listSessions(projectId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: sessions,
          },
        };
      }
      case "start_session": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        if (!projectId || !sprintId) {
          throw new Error("Missing required 'projectId' or 'sprintId' for start_session");
        }
        const session = await this.sprintPreviewService.startSession(projectId, sprintId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: session,
          },
        };
      }
      case "rebuild_session": {
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
        if (!sessionId) {
          throw new Error("Missing required 'sessionId' for rebuild_session");
        }
        await this.sprintPreviewService.rebuildSession(sessionId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
          },
        };
      }
      case "stop_session": {
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
        if (!sessionId) {
          throw new Error("Missing required 'sessionId' for stop_session");
        }
        await this.sprintPreviewService.stopSession(sessionId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
          },
        };
      }
      case "remove_session": {
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
        if (!sessionId) {
          throw new Error("Missing required 'sessionId' for remove_session");
        }
        if (approval?.confirmed !== true) {
          return {
            approvalRequired: true,
            approvalMessage: `Removing a preview session is destructive. Please review the changes and call this tool again with approval.confirmed set to true.`,
          };
        }
        await this.sprintPreviewService.removeSession(sessionId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
          },
        };
      }
      case "get_script": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        if (!projectId || !sprintId) {
          throw new Error("Missing required 'projectId' or 'sprintId' for get_script");
        }
        const script = await this.sprintPreviewService.getScript(projectId, sprintId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: script,
          },
        };
      }
      case "update_script": {
        const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
        const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;
        const content = typeof payload.content === "string" ? payload.content : undefined;
        if (!projectId || !sprintId || !content) {
          throw new Error("Missing required 'projectId', 'sprintId', or 'content' for update_script");
        }
        const script = await this.sprintPreviewService.saveScript(projectId, sprintId, content);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: script,
          },
        };
      }
      case "get_logs": {
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
        if (!sessionId) {
          throw new Error("Missing required 'sessionId' for get_logs");
        }
        const logs = await this.sprintPreviewService.getLogs(sessionId);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: logs,
          },
        };
      }
      case "get_url": {
        const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
        const path = typeof payload.path === "string" ? payload.path : "/";
        if (!sessionId) {
          throw new Error("Missing required 'sessionId' for get_url");
        }
        const url = buildPreviewUrl(sessionId, path, currentHost);
        return {
          result: {
            status: "success",
            domain: "preview",
            action,
            data: { url },
          },
        };
      }
      default:
        throw new Error(`Unknown preview action: ${action}`);
    }
    } catch (error) {
      throw new Error(`Preview action '${action}' failed: ${(error as Error).message}`);
    }
  }
}
