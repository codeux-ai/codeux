import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import { normalizeNodeFlowGraph, validateNodeFlowGraph } from "../domain/node-flows/node-flow-validation.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowGraph,
  NodeFlowListResponse,
  NodeFlowNodeRunListResponse,
  NodeFlowRecord,
  NodeFlowRunListResponse,
  NodeFlowRunRecord,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
  UpdateNodeFlowInput,
} from "../contracts/node-flow-types.js";

export class NodeFlowService {
  constructor(private readonly repository: NodeFlowRepository = new NodeFlowRepository()) {}

  list(projectId: string): NodeFlowListResponse {
    return { flows: this.repository.listFlows(projectId) };
  }

  get(flowId: string): NodeFlowRecord | null {
    return this.repository.getFlow(flowId);
  }

  create(projectId: string, input: CreateNodeFlowInput): NodeFlowRecord {
    const title = normalizeRequiredText(input.title, "Node flow title");
    const description = normalizeOptionalText(input.description);
    const { graph } = normalizeNodeFlowGraph(input.graph);
    return this.repository.createFlow(projectId, {
      id: input.id,
      title,
      description,
      graph,
    });
  }

  update(flowId: string, input: UpdateNodeFlowInput): NodeFlowRecord {
    const update: UpdateNodeFlowInput = {};
    if (input.title !== undefined) {
      update.title = normalizeRequiredText(input.title, "Node flow title");
    }
    if (input.description !== undefined) {
      update.description = normalizeOptionalText(input.description);
    }
    if (input.graph !== undefined) {
      update.graph = normalizeNodeFlowGraph(input.graph).graph;
    }
    return this.repository.updateFlow(flowId, update);
  }

  delete(flowId: string): void {
    this.repository.deleteFlow(flowId);
  }

  validate(graph: NodeFlowGraph): NodeFlowValidationResponse {
    return validateNodeFlowGraph(graph);
  }

  validateFlow(flowId: string, graph?: NodeFlowGraph): NodeFlowValidationResponse {
    const flow = this.repository.getFlow(flowId);
    if (!flow) {
      throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
    }
    return validateNodeFlowGraph(graph ?? flow.graph);
  }

  attachToAgent(flowId: string, input: AttachNodeFlowSkillInput): NodeFlowSkillAttachment {
    return this.repository.attachToAgent(flowId, {
      agentPresetId: normalizeRequiredText(input.agentPresetId, "agentPresetId"),
      skillName: input.skillName === undefined ? undefined : normalizeOptionalText(input.skillName),
      description: input.description === undefined ? undefined : normalizeOptionalText(input.description),
    });
  }

  detachFromAgent(flowId: string, agentPresetId: string): void {
    this.repository.detachFromAgent(flowId, normalizeRequiredText(agentPresetId, "agentPresetId"));
  }

  listAgentSkills(flowId: string): NodeFlowSkillAttachment[] {
    return this.repository.listAgentSkills(flowId);
  }

  listAgentSkillsForAgent(projectId: string, agentPresetId: string): NodeFlowSkillAttachment[] {
    return this.repository.listAgentSkillsForAgent(projectId, agentPresetId);
  }

  listRuns(flowId: string, limit?: number): NodeFlowRunListResponse {
    return { runs: this.repository.listRuns(flowId, limit) };
  }

  getRun(runId: string): NodeFlowRunRecord | null {
    return this.repository.getRun(runId);
  }

  listNodeRuns(runId: string): NodeFlowNodeRunListResponse {
    return { nodeRuns: this.repository.listNodeRuns(runId) };
  }
}

function normalizeRequiredText(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new ValidationError(`${label} is required.`);
  }
  return normalized;
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() || "";
}
