import type { NodeFlowJsonObject, NodeFlowRunSummaryResponse, NodeFlowValueSchema } from "../contracts/node-flow-types.js";
import { ValidationError, EntityNotFoundError } from "../repositories/repository-utils.js";
import type { NodeFlowService } from "./node-flow-service.js";

export interface AttachedNodeFlowCapability {
  flowId: string;
  name: string;
  description: string;
  inputSchema: NodeFlowValueSchema;
  operation: "run_attached_flow";
}

export class NodeFlowAgentSkillService {
  constructor(private readonly nodeFlowService: NodeFlowService) {}

  listCapabilities(projectId: string, agentPresetId: string): AttachedNodeFlowCapability[] {
    return this.nodeFlowService.listAgentSkillsForAgent(projectId, agentPresetId).map((attachment) => {
      const flow = this.nodeFlowService.get(attachment.flowId);
      if (!flow || flow.projectId !== projectId) {
        throw new ValidationError("Attached node flow is outside the agent project.");
      }
      return {
        flowId: flow.id,
        name: attachment.skillName,
        description: attachment.description,
        inputSchema: flow.graph.schemas?.input ?? { type: "object" },
        operation: "run_attached_flow",
      };
    });
  }

  async runAttachedFlow(input: {
    projectId: string;
    flowId: string;
    agentPresetId: string;
    conversationId?: string | null;
    parameters?: NodeFlowJsonObject;
  }): Promise<NodeFlowRunSummaryResponse> {
    const capability = this.listCapabilities(input.projectId, input.agentPresetId)
      .find((item) => item.flowId === input.flowId);
    if (!capability) throw new EntityNotFoundError("Node flow is not attached to the initiating agent.");
    const review = await this.nodeFlowService.validateDraft(input.projectId, input.flowId);
    if (review.publishedVersion === null) throw new ValidationError("Attached node flow has not been published.");
    if (review.requiredCredentials.some((credential) => credential.status !== "bound")) {
      throw new ValidationError("Attached node flow credential policy is not satisfied.");
    }
    return await this.nodeFlowService.runFlow(input.projectId, input.flowId, input.parameters ?? {}, {
      triggerType: "attached_flow",
      triggerPayload: {
        initiatingAgentId: input.agentPresetId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        operation: "run_attached_flow",
      },
      versionSelection: { mode: "latest_published" },
    });
  }
}
