import { EntityNotFoundError, ValidationError } from "../repositories/repository-utils.js";
import { NodeFlowRepository } from "../repositories/node-flow-repository.js";
import { normalizeNodeFlowGraph, validateNodeFlowGraph } from "../domain/node-flows/node-flow-validation.js";
import { listNodeDefinitions, resolveNodeDefinition } from "../domain/node-flows/node-definition-registry.js";
import type { CredentialBroker } from "./credentials/credential-broker.js";
import type { CustomNodeManifest, CustomNodeRecord } from "../contracts/custom-node-types.js";
import type { CustomNodeRepository } from "../repositories/custom-node-repository.js";
import type { CustomNodeProjectService } from "./custom-nodes/custom-node-project-service.js";
import type { CustomNodeBuildService } from "./custom-nodes/custom-node-build-service.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowGraph,
  NodeFlowGraphPatchOperation,
  NodeFlowCredentialRequestResult,
  NodeFlowJsonObject,
  NodeFlowListResponse,
  NodeFlowNodeRunListResponse,
  NodeFlowRecord,
  NodeFlowDraftReview,
  NodeFlowConcurrencyConflict,
  NodeFlowRequiredCredential,
  PatchNodeFlowDraftInput,
  NodeFlowRunListResponse,
  NodeFlowRunRecord,
  NodeFlowRunSummaryResponse,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
  RunNodeFlowOptions,
  UpdateNodeFlowInput,
} from "../contracts/node-flow-types.js";
import type { NodeFlowRuntimeService } from "./node-flow-runtime-service.js";

export class NodeFlowService {
  constructor(
    private readonly repository: NodeFlowRepository = new NodeFlowRepository(),
    private readonly runtimeService?: NodeFlowRuntimeService,
    private readonly credentialBroker?: CredentialBroker,
    private readonly customNodeAuthoring?: {
      repository: CustomNodeRepository;
      projectService: CustomNodeProjectService;
      buildService: CustomNodeBuildService;
      resolveProjectRoot(projectId: string): string;
    },
  ) {}

  catalog(): { nodes: Array<Record<string, unknown>> } {
    return { nodes: listNodeDefinitions().map((definition) => definitionSummary(definition)) };
  }

  nodeDefinition(type: string, version?: number): Record<string, unknown> | null {
    const definition = version === undefined
      ? [...listNodeDefinitions()].filter((item) => item.type === type).sort((a, b) => b.version - a.version)[0] ?? null
      : resolveNodeDefinition(type, version);
    return definition ? definitionSummary(definition, true) : null;
  }

  list(projectId: string): NodeFlowListResponse {
    return { flows: this.repository.listFlows(projectId) };
  }

  get(flowId: string): NodeFlowRecord | null {
    return this.repository.getFlow(flowId);
  }

  resolveFlowProjectId(flowId: string): string | null {
    return this.repository.getFlow(flowId)?.projectId ?? null;
  }

  resolveRunProjectId(runId: string): string | null {
    return this.repository.getRun(runId)?.projectId ?? null;
  }

  async create(projectId: string, input: CreateNodeFlowInput): Promise<NodeFlowRecord> {
    const title = normalizeRequiredText(input.title, "Node flow title");
    const description = normalizeOptionalText(input.description);
    const { graph } = normalizeNodeFlowGraph(input.graph);
    const review = await this.reviewDraft({
      id: input.id?.trim() || "pending-node-flow",
      projectId,
      title,
      description,
      graph,
      version: 1,
      createdAt: "",
      updatedAt: "",
    });
    if (!review.valid) throw new ValidationError("Node flow credential policy must pass review before publication.");
    return this.repository.createFlow(projectId, {
      id: input.id,
      title,
      description,
      graph,
    });
  }

  async createDraft(projectId: string, input: CreateNodeFlowInput): Promise<NodeFlowDraftReview> {
    const title = normalizeRequiredText(input.title, "Node flow title");
    const description = normalizeOptionalText(input.description);
    const { graph } = normalizeNodeFlowGraph(input.graph);
    const flow = this.repository.createFlow(projectId, { id: input.id, title, description, graph }, { publish: false });
    return await this.reviewDraft(flow);
  }

  async patchDraft(flowId: string, input: PatchNodeFlowDraftInput): Promise<{ draft?: NodeFlowDraftReview; conflict?: NodeFlowConcurrencyConflict }> {
    const current = this.requireOwnedFlow(flowId, input.projectId);
    if (current.version !== input.draftRevision) {
      return { conflict: {
        code: "draft_revision_conflict",
        flowId,
        expectedDraftRevision: input.draftRevision,
        actualDraftRevision: current.version,
        message: "The draft changed after it was read; reload the summary and reapply the patch.",
      } };
    }
    if (!input.graph && !input.operations?.length && input.title === undefined && input.description === undefined) {
      throw new ValidationError("A graph patch, title, or description is required.");
    }
    const graph = input.graph ?? applyGraphPatch(current.graph, input.operations ?? []);
    const validation = validateNodeFlowGraph(graph);
    if (!validation.valid || !validation.graph) {
      return { draft: await this.reviewDraft({ ...current, graph }, validation) };
    }
    const updated = this.repository.updateFlow(flowId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      graph: validation.graph,
    }, { publish: false });
    return { draft: await this.reviewDraft(updated, validation) };
  }

  async validateDraft(projectId: string, flowId: string): Promise<NodeFlowDraftReview> {
    return await this.reviewDraft(this.requireOwnedFlow(flowId, projectId));
  }

  async inspectBindings(projectId: string, flowId: string): Promise<Pick<NodeFlowDraftReview, "requiredCredentials" | "requestedCapabilities" | "policyFindings">> {
    const review = await this.reviewDraft(this.requireOwnedFlow(flowId, projectId));
    return {
      requiredCredentials: review.requiredCredentials,
      requestedCapabilities: review.requestedCapabilities,
      policyFindings: review.policyFindings,
    };
  }

  async requestCredential(projectId: string, flowId: string, nodeId: string, slot: string): Promise<NodeFlowCredentialRequestResult> {
    const review = await this.reviewDraft(this.requireOwnedFlow(flowId, projectId));
    const requirement = review.requiredCredentials.find((item) => item.nodeId === nodeId && item.slot === slot);
    if (!requirement) throw new ValidationError(`Credential slot is not declared: ${nodeId}.${slot}`);
    return {
      ...requirement,
      requestStatus: requirement.status === "bound" ? "already_bound" : "requested",
      persistence: "none",
      bindingChanged: false,
    };
  }

  async createCustomNode(projectId: string, input: { nodeId: string; name: string; description?: string; sourceRevision: string; createdBy: string }): Promise<CustomNodeRecord> {
    const authoring = this.requireCustomNodeAuthoring();
    const generated = await authoring.projectService.generate({
      projectRoot: authoring.resolveProjectRoot(projectId), nodeId: input.nodeId, name: input.name, description: input.description,
    });
    return authoring.repository.createDraft(projectId, {
      manifest: generated.manifest, sourceRevision: normalizeRequiredText(input.sourceRevision, "sourceRevision"), createdBy: normalizeRequiredText(input.createdBy, "createdBy"),
    });
  }

  async updateCustomNode(projectId: string, nodeId: string, manifest: CustomNodeManifest, sourceRevision: string): Promise<CustomNodeRecord> {
    const authoring = this.requireCustomNodeAuthoring();
    const current = authoring.repository.getNode(nodeId);
    if (!current || current.projectId !== projectId) throw new EntityNotFoundError(`Custom node not found: ${nodeId}`);
    await authoring.projectService.writeManifest(authoring.resolveProjectRoot(projectId), nodeId, manifest);
    return authoring.repository.updateDraft(nodeId, manifest, sourceRevision);
  }

  async validateCustomNode(projectId: string, nodeId: string, actor: string, invocationId: string, correlationId: string): Promise<Record<string, unknown>> {
    const authoring = this.requireCustomNodeAuthoring();
    const current = authoring.repository.getNode(nodeId);
    if (!current || current.projectId !== projectId) throw new EntityNotFoundError(`Custom node not found: ${nodeId}`);
    const result = await authoring.buildService.validateAndBuild({ projectRoot: authoring.resolveProjectRoot(projectId), nodeId, creator: actor, invocationId, correlationId });
    return { nodeId, status: result.report.valid ? "passed" : "failed", validationIssues: result.report.issues, checks: result.report.checks, requestedCapabilities: current.manifest.capabilities, requiredCredentials: current.manifest.credentials };
  }

  async dryRun(projectId: string, flowId: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    normalizeJsonObject(input, "input");
    const review = await this.reviewDraft(this.requireOwnedFlow(flowId, projectId));
    const missingCredentials = review.requiredCredentials.filter((item) => item.status === "denied" || (item.required && item.status === "missing"));
    return {
      status: review.valid && missingCredentials.length === 0 ? "ready" : "blocked",
      draftRevision: review.draftRevision,
      validationIssues: review.validationIssues,
      policyFindings: review.policyFindings,
      requiredCredentials: review.requiredCredentials,
      requestedCapabilities: review.requestedCapabilities,
      sideEffectDiffs: review.sideEffectDiffs,
      result: { executed: false, inputKeys: Object.keys(input).sort(), output: null },
    };
  }

  async publishDraft(projectId: string, flowId: string, draftRevision: number, publishedBy: string): Promise<NodeFlowDraftReview> {
    const flow = this.requireOwnedFlow(flowId, projectId);
    if (flow.version !== draftRevision) throw new ValidationError(`Draft revision conflict: expected ${draftRevision}, actual ${flow.version}.`);
    const review = await this.reviewDraft(flow);
    if (!review.valid) throw new ValidationError("Only a valid draft can be published.");
    if (review.requiredCredentials.some((item) => item.status === "denied" || (item.required && item.status === "missing"))) {
      throw new ValidationError("All required credentials must be bound before publication.");
    }
    this.repository.publishVersion(flowId, draftRevision, undefined, normalizeRequiredText(publishedBy, "publishedBy"));
    return await this.reviewDraft(flow);
  }

  compareVersions(projectId: string, flowId: string, fromVersion: number, toVersion: number): Record<string, unknown> {
    this.requireOwnedFlow(flowId, projectId);
    const from = this.repository.getVersion(flowId, fromVersion);
    const to = this.repository.getVersion(flowId, toVersion);
    if (!from || !to) throw new EntityNotFoundError("One or both node flow versions were not found.");
    return {
      flowId, fromVersion, toVersion,
      nodeCount: { from: from.graph.nodes.length, to: to.graph.nodes.length },
      edgeCount: { from: from.graph.edges.length, to: to.graph.edges.length },
      addedNodeIds: to.graph.nodes.map((node) => node.id).filter((id) => !from.graph.nodes.some((node) => node.id === id)),
      removedNodeIds: from.graph.nodes.map((node) => node.id).filter((id) => !to.graph.nodes.some((node) => node.id === id)),
      sideEffectDiffs: reviewSideEffects(to.graph).filter((item) => !reviewSideEffects(from.graph).some((before) => before.nodeId === item.nodeId && before.sideEffect === item.sideEffect)),
    };
  }

  async rollback(projectId: string, flowId: string, version: number, draftRevision: number): Promise<NodeFlowDraftReview> {
    const current = this.requireOwnedFlow(flowId, projectId);
    if (current.version !== draftRevision) throw new ValidationError(`Draft revision conflict: expected ${draftRevision}, actual ${current.version}.`);
    const target = this.repository.getVersion(flowId, version);
    if (!target) throw new EntityNotFoundError(`Node flow version not found: ${flowId}@${version}`);
    return await this.reviewDraft(this.repository.updateFlow(flowId, {
      title: target.title, description: target.description, graph: target.graph,
    }, { publish: false }));
  }

  cancelRun(projectId: string, runId: string): NodeFlowRunRecord {
    const run = this.requireOwnedRun(runId, projectId);
    if (["succeeded", "failed", "cancelled"].includes(run.status)) throw new ValidationError(`Run ${runId} is already terminal.`);
    return this.runtimeService?.requestCancellation(runId) ?? this.repository.requestCancellation(runId);
  }

  async retryRun(projectId: string, runId: string): Promise<NodeFlowRunSummaryResponse> {
    const run = this.requireOwnedRun(runId, projectId);
    if (!["failed", "cancelled", "attention_required"].includes(run.status)) throw new ValidationError("Only failed, cancelled, or attention-required runs can be retried.");
    return await this.runFlow(projectId, run.flowId, run.input ?? {}, {
      triggerType: "retry",
      triggerPayload: { retriedRunId: run.id },
      versionSelection: { mode: "pinned", version: run.version },
    });
  }

  async resumeApproval(projectId: string, runId: string, approvalId: string): Promise<NodeFlowRunSummaryResponse> {
    const run = this.requireOwnedRun(runId, projectId);
    if (!this.runtimeService) throw new ValidationError("Node flow runtime is not configured.");
    const result = await this.runtimeService.resumeApproval(projectId, approvalId, run.id);
    return result;
  }

  async update(flowId: string, input: UpdateNodeFlowInput): Promise<NodeFlowRecord> {
    const current = this.repository.getFlow(flowId);
    if (!current) throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
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
    const review = await this.reviewDraft({
      ...current,
      title: update.title ?? current.title,
      description: update.description ?? current.description,
      graph: update.graph ?? current.graph,
      version: current.version + 1,
    });
    if (!review.valid) throw new ValidationError("Node flow credential policy must pass review before publication.");
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

  listNodeAttempts(runId: string) {
    return { attempts: this.repository.listNodeAttempts(runId) };
  }

  async runFlow(
    projectId: string,
    flowId: string,
    input: Record<string, unknown> | undefined,
    options?: RunNodeFlowOptions,
  ): Promise<NodeFlowRunSummaryResponse> {
    if (!this.runtimeService) {
      throw new ValidationError("Node flow runtime is not configured.");
    }
    return await this.runtimeService.runFlow(
      normalizeRequiredText(projectId, "projectId"),
      normalizeRequiredText(flowId, "flowId"),
      normalizeJsonObject(input ?? {}, "input"),
      options,
    );
  }

  private requireOwnedFlow(flowId: string, projectId: string): NodeFlowRecord {
    const flow = this.repository.getFlow(flowId);
    if (!flow) throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
    if (flow.projectId !== projectId) throw new ValidationError("Node flow does not belong to the requested project.");
    return flow;
  }

  private requireOwnedRun(runId: string, projectId: string): NodeFlowRunRecord {
    const run = this.repository.getRun(runId);
    if (!run) throw new EntityNotFoundError(`Node flow run not found: ${runId}`);
    if (run.projectId !== projectId) throw new ValidationError("Node flow run does not belong to the requested project.");
    return run;
  }

  private async reviewDraft(flow: NodeFlowRecord, validation = validateNodeFlowGraph(flow.graph)): Promise<NodeFlowDraftReview> {
    const credentialRequirements = flow.graph.nodes.flatMap((node) => {
      const definition = node.definition ? resolveNodeDefinition(node.definition.type, node.definition.version) : undefined;
      return (definition?.credentials ?? []).map((slot) => ({ node, slot }));
    });
    const requiredCredentials: NodeFlowRequiredCredential[] = await Promise.all(credentialRequirements.map(async ({ node, slot }) => {
      const credentialId = node.credentialBindings?.find((binding) => binding.slot === slot.slot)?.credentialId ?? null;
      const policy = {
        nodeId: node.id,
        slot: slot.slot,
        allowedKinds: [...slot.allowedKinds],
        requiredCapabilities: [...slot.requiredCapabilities],
        required: slot.required,
        credentialId,
      };
      if (!credentialId) {
        return {
          ...policy,
          status: "missing" as const,
          backendReady: null,
          configured: null,
          active: null,
          projectAccess: null,
          kindAllowed: null,
          capabilitiesAllowed: null,
          missingCapabilities: [...slot.requiredCapabilities],
          compatibilityIssues: [],
        };
      }
      if (!this.credentialBroker) {
        return {
          ...policy,
          status: "denied" as const,
          backendReady: false,
          configured: null,
          active: null,
          projectAccess: null,
          kindAllowed: null,
          capabilitiesAllowed: null,
          missingCapabilities: [...slot.requiredCapabilities],
          compatibilityIssues: ["backend_unavailable" as const],
        };
      }
      const assessment = await this.credentialBroker.assessCompatibility(credentialId, {
        projectId: flow.projectId,
        allowedKinds: slot.allowedKinds,
        requiredCapabilities: slot.requiredCapabilities,
      });
      return {
        ...policy,
        status: assessment.compatible ? "bound" as const : "denied" as const,
        backendReady: assessment.backendReady,
        configured: assessment.configured,
        active: assessment.active,
        projectAccess: assessment.projectAccess,
        kindAllowed: assessment.kindAllowed,
        capabilitiesAllowed: assessment.capabilitiesAllowed,
        missingCapabilities: [...assessment.missingCapabilities],
        compatibilityIssues: [...assessment.issues],
      };
    }));
    const requestedCapabilities = [...new Set(flow.graph.nodes.flatMap((node) => node.capabilities ?? []))].sort();
    const policyFindings = reviewPolicy(flow.graph, requiredCredentials);
    return {
      flowId: flow.id, projectId: flow.projectId, name: flow.title, description: flow.description,
      draftRevision: flow.version, nodeCount: flow.graph.nodes.length, edgeCount: flow.graph.edges.length,
      valid: validation.valid && !policyFindings.some((finding) => finding.severity === "error"),
      validationIssues: validation.errors, policyFindings, requiredCredentials, requestedCapabilities,
      sideEffectDiffs: reviewSideEffects(flow.graph),
      publishedVersion: this.repository.getPublication(flow.id)?.version ?? null,
    };
  }

  private requireCustomNodeAuthoring(): NonNullable<NodeFlowService["customNodeAuthoring"]> {
    if (!this.customNodeAuthoring) throw new ValidationError("Custom-node authoring is not configured.");
    return this.customNodeAuthoring;
  }
}

function definitionSummary(definition: ReturnType<typeof listNodeDefinitions>[number], includeSchema = false): Record<string, unknown> {
  if (includeSchema) {
    return {
      type: definition.type,
      version: definition.version,
      executable: definition.executable,
      executionKind: definition.executionKind,
      configurationSchema: definition.configurationSchema,
      ui: definition.ui,
      ports: definition.ports,
      credentials: definition.credentials,
      capabilities: definition.capabilities,
      sideEffect: definition.sideEffect,
      defaultPolicy: definition.defaultPolicy,
      documentation: definition.documentation,
      deprecation: definition.deprecation,
    };
  }
  return {
    type: definition.type, version: definition.version, executable: definition.executable,
    executionKind: definition.executionKind, label: definition.ui.label, description: definition.ui.description,
    category: definition.ui.category, credentials: definition.credentials, capabilities: definition.capabilities,
    sideEffect: definition.sideEffect, ports: definition.ports,
  };
}

function applyGraphPatch(graph: NodeFlowGraph, operations: NodeFlowGraphPatchOperation[]): NodeFlowGraph {
  let next: NodeFlowGraph = { ...graph, nodes: [...graph.nodes], edges: [...graph.edges] };
  for (const operation of operations) {
    if (operation.op === "upsert_node") next.nodes = [...next.nodes.filter((node) => node.id !== operation.node.id), operation.node];
    else if (operation.op === "remove_node") {
      next.nodes = next.nodes.filter((node) => node.id !== operation.nodeId);
      next.edges = next.edges.filter((edge) => edge.fromNodeId !== operation.nodeId && edge.toNodeId !== operation.nodeId);
    } else if (operation.op === "upsert_edge") {
      const edgeKey = operation.edge.id ?? `${operation.edge.fromNodeId}:${operation.edge.toNodeId}:${operation.edge.fromHandle ?? ""}:${operation.edge.toHandle ?? ""}`;
      next.edges = [...next.edges.filter((edge) => (edge.id ?? `${edge.fromNodeId}:${edge.toNodeId}:${edge.fromHandle ?? ""}:${edge.toHandle ?? ""}`) !== edgeKey), operation.edge];
    } else if (operation.op === "remove_edge") next.edges = next.edges.filter((edge) => operation.edgeId ? edge.id !== operation.edgeId : !(edge.fromNodeId === operation.fromNodeId && edge.toNodeId === operation.toNodeId));
    else if (operation.op === "set_input_schema") next = { ...next, inputSchema: operation.inputSchema ?? undefined };
    else if (operation.op === "set_metadata") next = { ...next, metadata: operation.metadata ?? undefined };
  }
  return next;
}

function reviewSideEffects(graph: NodeFlowGraph): NodeFlowDraftReview["sideEffectDiffs"] {
  return graph.nodes.flatMap((node) => {
    const definition = node.definition ? resolveNodeDefinition(node.definition.type, node.definition.version) : undefined;
    const sideEffect = node.sideEffect ?? definition?.sideEffect ?? "none";
    return sideEffect === "none" ? [] : [{ nodeId: node.id, sideEffect, description: `${node.title} may perform a ${sideEffect} side effect.` }];
  });
}

function reviewPolicy(graph: NodeFlowGraph, credentials: NodeFlowDraftReview["requiredCredentials"]): NodeFlowDraftReview["policyFindings"] {
  const compatibilityFinding = {
    backend_unavailable: ["credential_backend_unavailable", "The credential encryption backend is unavailable."],
    backend_insecure: ["credential_backend_insecure", "The credential encryption backend is not secure."],
    not_configured: ["credential_not_configured", "The bound credential is not configured."],
    not_active: ["credential_not_active", "The bound credential is not active."],
    project_access_denied: ["credential_project_access_denied", "The bound credential is not accessible to this project."],
    kind_not_allowed: ["credential_kind_not_allowed", "The bound credential kind is not allowed for this slot."],
    capability_missing: ["credential_capability_missing", "The bound credential does not grant every required capability."],
  } as const;
  const findings: NodeFlowDraftReview["policyFindings"] = credentials.flatMap((item) => {
    if (item.required && item.status === "missing") {
      return [{
        severity: "error" as const,
        code: "missing_credential_binding",
        nodeId: item.nodeId,
        message: `${item.nodeId}.${item.slot} requires a stored credential binding.`,
      }];
    }
    if (item.status !== "denied") return [];
    const issues = item.compatibilityIssues.length > 0 ? item.compatibilityIssues : ["not_configured" as const];
    return issues.map((compatibilityIssue) => ({
      severity: "error" as const,
      code: compatibilityFinding[compatibilityIssue][0],
      nodeId: item.nodeId,
      message: `${item.nodeId}.${item.slot}: ${compatibilityFinding[compatibilityIssue][1]}`,
    }));
  });
  for (const node of graph.nodes) {
    const definition = node.definition ? resolveNodeDefinition(node.definition.type, node.definition.version) : undefined;
    if ((node.sideEffect ?? definition?.sideEffect) === "external") findings.push({ severity: "warning", code: "external_side_effect", nodeId: node.id, message: "External side effects require publication review." });
  }
  return findings;
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

function normalizeJsonObject(value: unknown, label: string): NodeFlowJsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${label} must be a JSON object.`);
  }
  if (!isJsonValue(value)) {
    throw new ValidationError(`${label} must be JSON-serializable.`);
  }
  return value as NodeFlowJsonObject;
}

function isJsonValue(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every((entry) => isJsonValue(entry));
  }
  return typeof value === "object"
    && Object.values(value as Record<string, unknown>).every((entry) => isJsonValue(entry));
}
