import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, RepositoryError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";
import type { ProviderId } from "../contracts/app-types.js";
import type {
  AttachNodeWorkflowAgentInput,
  CreateNodeWorkflowInput,
  CreateNodeWorkflowRunInput,
  CreateNodeWorkflowStepRunInput,
  JsonObject,
  JsonValue,
  NodeWorkflowAgentAttachmentRecord,
  NodeWorkflowEdgeRecord,
  NodeWorkflowNodeRecord,
  NodeWorkflowRecord,
  NodeWorkflowRunRecord,
  NodeWorkflowRunStatus,
  NodeWorkflowRunTrigger,
  NodeWorkflowStatus,
  NodeWorkflowStepRunRecord,
  NodeWorkflowStepRunStatus,
  NodeWorkflowWidgetDefinition,
  NodeWorkflowWidgetFieldType,
  NodeWorkflowWidgetValues,
  UpdateNodeWorkflowAgentAttachmentInput,
  UpdateNodeWorkflowInput,
  UpdateNodeWorkflowRunInput,
  UpdateNodeWorkflowStepRunInput,
} from "../contracts/node-workflow-types.js";

const WORKFLOW_STATUSES = new Set<NodeWorkflowStatus>(["draft", "active", "archived"]);
const RUN_STATUSES = new Set<NodeWorkflowRunStatus>(["queued", "running", "completed", "failed", "cancelled"]);
const RUN_TRIGGERS = new Set<NodeWorkflowRunTrigger>(["manual", "scheduler", "api", "mcp", "system"]);
const STEP_RUN_STATUSES = new Set<NodeWorkflowStepRunStatus>(["queued", "running", "completed", "failed", "skipped", "cancelled"]);
const WIDGET_TYPES = new Set<NodeWorkflowWidgetFieldType>([
  "text",
  "textarea",
  "number",
  "boolean",
  "select",
  "multiselect",
  "secret",
  "url",
  "json",
  "code",
  "key_value_list",
  "file_path",
  "directory_path",
  "path",
]);
const PROVIDERS = new Set<ProviderId>(["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "mockup-cli"]);

interface NodeWorkflowRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  status: NodeWorkflowStatus;
  version: number | string | null;
  widget_definitions_json: string;
  widget_values_json: string;
  nodes_json: string;
  edges_json: string;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeWorkflowAgentAttachmentRow {
  id: string;
  project_id: string;
  workflow_id: string;
  node_id: string | null;
  agent_preset_id: string | null;
  provider: ProviderId | null;
  role: string;
  label: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

interface NodeWorkflowRunRow {
  id: string;
  project_id: string;
  workflow_id: string;
  status: NodeWorkflowRunStatus;
  trigger_type: NodeWorkflowRunTrigger;
  input_json: string;
  output_json: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeWorkflowStepRunRow {
  id: string;
  project_id: string;
  workflow_id: string;
  workflow_run_id: string;
  node_id: string;
  status: NodeWorkflowStepRunStatus;
  attempt: number | string | null;
  agent_attachment_id: string | null;
  agent_preset_id: string | null;
  provider: ProviderId | null;
  input_json: string;
  output_json: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export class NodeWorkflowRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listWorkflows(projectId: string): NodeWorkflowRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_workflows
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC, name ASC
    `).all(projectId) as unknown as NodeWorkflowRow[];
    return rows.map((row) => this.mapWorkflowRow(row));
  }

  getWorkflow(projectId: string, workflowId: string): NodeWorkflowRecord | null {
    this.requireProject(projectId);
    const row = this.db.prepare(`
      SELECT *
      FROM node_workflows
      WHERE project_id = ? AND id = ?
    `).get(projectId, workflowId) as NodeWorkflowRow | undefined;
    return row ? this.mapWorkflowRow(row) : null;
  }

  createWorkflow(projectId: string, input: CreateNodeWorkflowInput): NodeWorkflowRecord {
    this.requireProject(projectId);
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const payload = this.normalizeWorkflowInput({
      id,
      projectId,
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "draft",
      version: input.version ?? 1,
      widgetDefinitions: input.widgetDefinitions ?? [],
      widgetValues: input.widgetValues ?? {},
      nodes: input.nodes,
      edges: input.edges ?? [],
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    });

    this.db.prepare(`
      INSERT INTO node_workflows (
        id, project_id, name, description, status, version, widget_definitions_json,
        widget_values_json, nodes_json, edges_json, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      payload.id,
      payload.projectId,
      payload.name,
      payload.description,
      payload.status,
      payload.version,
      JSON.stringify(payload.widgetDefinitions),
      JSON.stringify(payload.widgetValues),
      JSON.stringify(payload.nodes),
      JSON.stringify(payload.edges),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      now,
      now,
    );

    return this.requireWorkflow(projectId, id);
  }

  updateWorkflow(projectId: string, workflowId: string, input: UpdateNodeWorkflowInput): NodeWorkflowRecord {
    const current = this.requireWorkflow(projectId, workflowId);
    const now = new Date().toISOString();
    const payload = this.normalizeWorkflowInput({
      ...current,
      name: input.name ?? current.name,
      description: input.description ?? current.description,
      status: input.status ?? current.status,
      version: input.version ?? current.version,
      widgetDefinitions: input.widgetDefinitions ?? current.widgetDefinitions,
      widgetValues: input.widgetValues ?? current.widgetValues,
      nodes: input.nodes ?? current.nodes,
      edges: input.edges ?? current.edges,
      metadata: input.metadata === undefined ? current.metadata : input.metadata ?? undefined,
      updatedAt: now,
    });

    this.db.prepare(`
      UPDATE node_workflows
      SET name = ?, description = ?, status = ?, version = ?, widget_definitions_json = ?,
          widget_values_json = ?, nodes_json = ?, edges_json = ?, metadata_json = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(
      payload.name,
      payload.description,
      payload.status,
      payload.version,
      JSON.stringify(payload.widgetDefinitions),
      JSON.stringify(payload.widgetValues),
      JSON.stringify(payload.nodes),
      JSON.stringify(payload.edges),
      payload.metadata ? JSON.stringify(payload.metadata) : null,
      now,
      projectId,
      workflowId,
    );

    return this.requireWorkflow(projectId, workflowId);
  }

  deleteWorkflow(projectId: string, workflowId: string): boolean {
    this.requireProject(projectId);
    const result = this.db.transaction(() => {
      const deleteResult = this.db.prepare(`
        DELETE FROM node_workflows
        WHERE project_id = ? AND id = ?
      `).run(projectId, workflowId);
      if (deleteResult.changes === 0) {
        return false;
      }

      const orphanCounts = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM node_workflow_runs WHERE workflow_id = ?) AS runs,
          (SELECT COUNT(*) FROM node_workflow_run_steps WHERE workflow_id = ?) AS steps,
          (SELECT COUNT(*) FROM node_workflow_agent_attachments WHERE workflow_id = ?) AS attachments
      `).get(workflowId, workflowId, workflowId) as { runs: number; steps: number; attachments: number };
      if (orphanCounts.runs > 0 || orphanCounts.steps > 0 || orphanCounts.attachments > 0) {
        throw new RepositoryError(`Deleting node workflow ${workflowId} left orphaned workflow rows`);
      }
      return true;
    });

    return result;
  }

  listAgentAttachments(projectId: string, workflowId: string): NodeWorkflowAgentAttachmentRecord[] {
    this.requireWorkflow(projectId, workflowId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_workflow_agent_attachments
      WHERE project_id = ? AND workflow_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(projectId, workflowId) as unknown as NodeWorkflowAgentAttachmentRow[];
    return rows.map((row) => this.mapAgentAttachmentRow(row));
  }

  attachAgent(projectId: string, workflowId: string, input: AttachNodeWorkflowAgentInput): NodeWorkflowAgentAttachmentRecord {
    const workflow = this.requireWorkflow(projectId, workflowId);
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const nodeId = this.normalizeOptionalNodeId(workflow, input.nodeId);
    const agentPresetId = this.normalizeAgentPresetId(projectId, input.agentPresetId);
    const provider = this.normalizeProvider(input.provider);
    const role = input.role?.trim() || "specialist";
    const label = input.label?.trim() || "";
    const config = this.requireJsonObject(input.config ?? {}, "attachment config");

    this.db.prepare(`
      INSERT INTO node_workflow_agent_attachments (
        id, project_id, workflow_id, node_id, agent_preset_id, provider, role, label, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      workflowId,
      nodeId,
      agentPresetId,
      provider,
      role,
      label,
      JSON.stringify(config),
      now,
      now,
    );

    return this.requireAgentAttachment(projectId, id);
  }

  updateAgentAttachment(projectId: string, attachmentId: string, input: UpdateNodeWorkflowAgentAttachmentInput): NodeWorkflowAgentAttachmentRecord {
    const current = this.requireAgentAttachment(projectId, attachmentId);
    const workflow = this.requireWorkflow(projectId, current.workflowId);
    const now = new Date().toISOString();
    const nextNodeId = input.nodeId === undefined ? current.nodeId : this.normalizeOptionalNodeId(workflow, input.nodeId);
    const nextAgentPresetId = input.agentPresetId === undefined ? current.agentPresetId : this.normalizeAgentPresetId(projectId, input.agentPresetId);
    const nextProvider = input.provider === undefined ? current.provider ?? null : this.normalizeProvider(input.provider);
    const nextRole = input.role?.trim() || current.role;
    const nextLabel = input.label === undefined ? current.label : input.label.trim();
    const nextConfig = input.config === undefined ? current.config : this.requireJsonObject(input.config, "attachment config");

    this.db.prepare(`
      UPDATE node_workflow_agent_attachments
      SET node_id = ?, agent_preset_id = ?, provider = ?, role = ?, label = ?, config_json = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(
      nextNodeId,
      nextAgentPresetId,
      nextProvider,
      nextRole,
      nextLabel,
      JSON.stringify(nextConfig),
      now,
      projectId,
      attachmentId,
    );

    return this.requireAgentAttachment(projectId, attachmentId);
  }

  detachAgent(projectId: string, attachmentId: string): boolean {
    this.requireProject(projectId);
    const result = this.db.prepare(`
      DELETE FROM node_workflow_agent_attachments
      WHERE project_id = ? AND id = ?
    `).run(projectId, attachmentId);
    return result.changes > 0;
  }

  createRun(projectId: string, workflowId: string, input: CreateNodeWorkflowRunInput = {}): NodeWorkflowRunRecord {
    this.requireWorkflow(projectId, workflowId);
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const status = this.normalizeRunStatus(input.status ?? "queued");
    const trigger = this.normalizeRunTrigger(input.trigger ?? "manual");
    const runInput = this.requireJsonObject(input.input ?? {}, "run input");
    const output = input.output === undefined ? null : this.normalizeNullableJsonObject(input.output, "run output");

    this.db.prepare(`
      INSERT INTO node_workflow_runs (
        id, project_id, workflow_id, status, trigger_type, input_json, output_json, error_message,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      workflowId,
      status,
      trigger,
      JSON.stringify(runInput),
      output ? JSON.stringify(output) : null,
      this.normalizeNullableString(input.errorMessage),
      input.startedAt ?? null,
      input.finishedAt ?? null,
      now,
      now,
    );

    return this.requireRun(projectId, id);
  }

  updateRun(projectId: string, runId: string, input: UpdateNodeWorkflowRunInput): NodeWorkflowRunRecord {
    const current = this.requireRun(projectId, runId);
    const now = new Date().toISOString();
    const status = input.status === undefined ? current.status : this.normalizeRunStatus(input.status);
    const trigger = input.trigger === undefined ? current.trigger : this.normalizeRunTrigger(input.trigger);
    const runInput = input.input === undefined ? current.input : this.requireJsonObject(input.input, "run input");
    const output = input.output === undefined ? current.output : this.normalizeNullableJsonObject(input.output, "run output");

    this.db.prepare(`
      UPDATE node_workflow_runs
      SET status = ?, trigger_type = ?, input_json = ?, output_json = ?, error_message = ?,
          started_at = ?, finished_at = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(
      status,
      trigger,
      JSON.stringify(runInput),
      output ? JSON.stringify(output) : null,
      input.errorMessage === undefined ? current.errorMessage : this.normalizeNullableString(input.errorMessage),
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      now,
      projectId,
      runId,
    );

    return this.requireRun(projectId, runId);
  }

  listRuns(projectId: string, workflowId: string, limit = 50): NodeWorkflowRunRecord[] {
    this.requireWorkflow(projectId, workflowId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_workflow_runs
      WHERE project_id = ? AND workflow_id = ?
      ORDER BY COALESCE(started_at, created_at) DESC, created_at DESC
      LIMIT ?
    `).all(projectId, workflowId, this.normalizeLimit(limit)) as unknown as NodeWorkflowRunRow[];
    return rows.map((row) => this.mapRunRow(row));
  }

  createStepRun(projectId: string, workflowRunId: string, input: CreateNodeWorkflowStepRunInput): NodeWorkflowStepRunRecord {
    const run = this.requireRun(projectId, workflowRunId);
    const workflow = this.requireWorkflow(projectId, run.workflowId);
    if (!workflow.nodes.some((node) => node.id === input.nodeId)) {
      throw new ValidationError(`Node workflow step references unknown node id: ${input.nodeId}`);
    }
    const id = input.id?.trim() || randomUUID();
    const now = new Date().toISOString();
    const status = this.normalizeStepRunStatus(input.status ?? "queued");
    const attempt = this.normalizeAttempt(input.attempt ?? 1);
    const agentAttachmentId = this.normalizeAgentAttachmentId(projectId, run.workflowId, input.agentAttachmentId);
    const agentPresetId = this.normalizeAgentPresetId(projectId, input.agentPresetId);
    const provider = this.normalizeProvider(input.provider);
    const stepInput = this.requireJsonObject(input.input ?? {}, "step input");
    const output = input.output === undefined ? null : this.normalizeNullableJsonObject(input.output, "step output");

    this.db.prepare(`
      INSERT INTO node_workflow_run_steps (
        id, project_id, workflow_id, workflow_run_id, node_id, status, attempt, agent_attachment_id,
        agent_preset_id, provider, input_json, output_json, error_message, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      run.workflowId,
      workflowRunId,
      input.nodeId,
      status,
      attempt,
      agentAttachmentId,
      agentPresetId,
      provider,
      JSON.stringify(stepInput),
      output ? JSON.stringify(output) : null,
      this.normalizeNullableString(input.errorMessage),
      input.startedAt ?? null,
      input.finishedAt ?? null,
      now,
      now,
    );

    return this.requireStepRun(projectId, id);
  }

  updateStepRun(projectId: string, stepRunId: string, input: UpdateNodeWorkflowStepRunInput): NodeWorkflowStepRunRecord {
    const current = this.requireStepRun(projectId, stepRunId);
    const status = input.status === undefined ? current.status : this.normalizeStepRunStatus(input.status);
    const attempt = input.attempt === undefined ? current.attempt : this.normalizeAttempt(input.attempt);
    const agentAttachmentId = input.agentAttachmentId === undefined
      ? current.agentAttachmentId
      : this.normalizeAgentAttachmentId(projectId, current.workflowId, input.agentAttachmentId);
    const agentPresetId = input.agentPresetId === undefined ? current.agentPresetId : this.normalizeAgentPresetId(projectId, input.agentPresetId);
    const provider = input.provider === undefined ? current.provider : this.normalizeProvider(input.provider);
    const stepInput = input.input === undefined ? current.input : this.requireJsonObject(input.input, "step input");
    const output = input.output === undefined ? current.output : this.normalizeNullableJsonObject(input.output, "step output");
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE node_workflow_run_steps
      SET status = ?, attempt = ?, agent_attachment_id = ?, agent_preset_id = ?, provider = ?,
          input_json = ?, output_json = ?, error_message = ?, started_at = ?, finished_at = ?, updated_at = ?
      WHERE project_id = ? AND id = ?
    `).run(
      status,
      attempt,
      agentAttachmentId,
      agentPresetId,
      provider,
      JSON.stringify(stepInput),
      output ? JSON.stringify(output) : null,
      input.errorMessage === undefined ? current.errorMessage : this.normalizeNullableString(input.errorMessage),
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      now,
      projectId,
      stepRunId,
    );

    return this.requireStepRun(projectId, stepRunId);
  }

  listStepRuns(projectId: string, workflowRunId: string): NodeWorkflowStepRunRecord[] {
    this.requireRun(projectId, workflowRunId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_workflow_run_steps
      WHERE project_id = ? AND workflow_run_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(projectId, workflowRunId) as unknown as NodeWorkflowStepRunRow[];
    return rows.map((row) => this.mapStepRunRow(row));
  }

  private requireProject(projectId: string): void {
    requireRecord(this.db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId), "Project", projectId);
  }

  private requireWorkflow(projectId: string, workflowId: string): NodeWorkflowRecord {
    return requireRecord(this.getWorkflow(projectId, workflowId), "Node workflow", workflowId);
  }

  private requireAgentAttachment(projectId: string, attachmentId: string): NodeWorkflowAgentAttachmentRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM node_workflow_agent_attachments
      WHERE project_id = ? AND id = ?
    `).get(projectId, attachmentId) as NodeWorkflowAgentAttachmentRow | undefined;
    return row ? this.mapAgentAttachmentRow(row) : raiseNotFound("Node workflow agent attachment", attachmentId);
  }

  private requireRun(projectId: string, runId: string): NodeWorkflowRunRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM node_workflow_runs
      WHERE project_id = ? AND id = ?
    `).get(projectId, runId) as NodeWorkflowRunRow | undefined;
    return row ? this.mapRunRow(row) : raiseNotFound("Node workflow run", runId);
  }

  private requireStepRun(projectId: string, stepRunId: string): NodeWorkflowStepRunRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM node_workflow_run_steps
      WHERE project_id = ? AND id = ?
    `).get(projectId, stepRunId) as NodeWorkflowStepRunRow | undefined;
    return row ? this.mapStepRunRow(row) : raiseNotFound("Node workflow step run", stepRunId);
  }

  private normalizeWorkflowInput(record: NodeWorkflowRecord): NodeWorkflowRecord {
    const name = record.name.trim();
    if (!name) {
      throw new ValidationError("Node workflow name is required");
    }
    if (!WORKFLOW_STATUSES.has(record.status)) {
      throw new ValidationError(`Unsupported node workflow status: ${record.status}`);
    }
    const version = Math.max(1, Math.trunc(record.version));
    const widgetDefinitions = this.normalizeWidgetDefinitions(record.widgetDefinitions, "workflow");
    const widgetValues = this.requireWidgetValues(record.widgetValues, "workflow widget values");
    this.validateWidgetValues(widgetDefinitions, widgetValues, "workflow");
    const nodes = record.nodes.map((node) => this.normalizeNode(node));
    const edges = record.edges.map((edge) => this.normalizeEdge(edge));
    this.validateWorkflowGraph(nodes, edges);
    const metadata = record.metadata === undefined ? undefined : this.requireJsonObject(record.metadata, "workflow metadata");

    return {
      ...record,
      name,
      description: record.description.trim(),
      version,
      widgetDefinitions,
      widgetValues,
      nodes,
      edges,
      metadata,
    };
  }

  private normalizeNode(node: NodeWorkflowNodeRecord): NodeWorkflowNodeRecord {
    const id = node.id.trim();
    if (!id) {
      throw new ValidationError("Node workflow node id is required");
    }
    const type = node.type.trim();
    if (!type) {
      throw new ValidationError(`Node workflow node ${id} type is required`);
    }
    const title = node.title.trim();
    if (!title) {
      throw new ValidationError(`Node workflow node ${id} title is required`);
    }
    const widgetDefinitions = this.normalizeWidgetDefinitions(node.widgetDefinitions ?? [], `node ${id}`);
    const widgetValues = this.requireWidgetValues(node.widgetValues ?? {}, `node ${id} widget values`);
    this.validateWidgetValues(widgetDefinitions, widgetValues, `node ${id}`);
    if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) {
      throw new ValidationError(`Node workflow node ${id} position must use finite numbers`);
    }

    return {
      ...node,
      id,
      type,
      title,
      description: node.description?.trim() || undefined,
      widgetDefinitions,
      widgetValues,
      metadata: node.metadata === undefined ? undefined : this.requireJsonObject(node.metadata, `node ${id} metadata`),
    };
  }

  private normalizeEdge(edge: NodeWorkflowEdgeRecord): NodeWorkflowEdgeRecord {
    const id = edge.id.trim();
    if (!id) {
      throw new ValidationError("Node workflow edge id is required");
    }
    return {
      ...edge,
      id,
      sourceNodeId: edge.sourceNodeId.trim(),
      targetNodeId: edge.targetNodeId.trim(),
      label: edge.label?.trim() || undefined,
      condition: edge.condition === undefined ? undefined : this.requireJsonObject(edge.condition, `edge ${id} condition`),
      metadata: edge.metadata === undefined ? undefined : this.requireJsonObject(edge.metadata, `edge ${id} metadata`),
    };
  }

  private validateWorkflowGraph(nodes: NodeWorkflowNodeRecord[], edges: NodeWorkflowEdgeRecord[]): void {
    const nodeIds = new Set<string>();
    for (const node of nodes) {
      if (nodeIds.has(node.id)) {
        throw new ValidationError(`Node workflow contains duplicate node id: ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    const edgeIds = new Set<string>();
    for (const edge of edges) {
      if (edgeIds.has(edge.id)) {
        throw new ValidationError(`Node workflow contains duplicate edge id: ${edge.id}`);
      }
      edgeIds.add(edge.id);
      if (!nodeIds.has(edge.sourceNodeId)) {
        throw new ValidationError(`Node workflow edge ${edge.id} references unknown source node: ${edge.sourceNodeId}`);
      }
      if (!nodeIds.has(edge.targetNodeId)) {
        throw new ValidationError(`Node workflow edge ${edge.id} references unknown target node: ${edge.targetNodeId}`);
      }
    }

    this.validateAcyclicGraph(nodes.map((node) => node.id), edges);
  }

  private validateAcyclicGraph(nodeIds: string[], edges: NodeWorkflowEdgeRecord[]): void {
    const outgoing = new Map<string, string[]>();
    for (const nodeId of nodeIds) {
      outgoing.set(nodeId, []);
    }
    for (const edge of edges) {
      outgoing.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) {
        return;
      }
      if (visiting.has(nodeId)) {
        throw new ValidationError("Node workflow graph must be acyclic for execution");
      }
      visiting.add(nodeId);
      for (const next of outgoing.get(nodeId) ?? []) {
        visit(next);
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
    };

    for (const nodeId of nodeIds) {
      visit(nodeId);
    }
  }

  private normalizeWidgetDefinitions(definitions: NodeWorkflowWidgetDefinition[], scope: string): NodeWorkflowWidgetDefinition[] {
    if (!Array.isArray(definitions)) {
      throw new ValidationError(`Node workflow ${scope} widget definitions must be an array`);
    }
    const seen = new Set<string>();
    return definitions.map((definition) => {
      const key = definition.key?.trim();
      if (!key) {
        throw new ValidationError(`Node workflow ${scope} widget definition key is required`);
      }
      if (seen.has(key)) {
        throw new ValidationError(`Node workflow ${scope} contains duplicate widget key: ${key}`);
      }
      seen.add(key);
      if (!WIDGET_TYPES.has(definition.type)) {
        throw new ValidationError(`Node workflow ${scope} widget ${key} has unsupported type: ${definition.type}`);
      }
      const label = definition.label?.trim();
      if (!label) {
        throw new ValidationError(`Node workflow ${scope} widget ${key} label is required`);
      }
      if (definition.options) {
        const optionValues = new Set<string>();
        for (const option of definition.options) {
          const value = option.value.trim();
          if (!value) {
            throw new ValidationError(`Node workflow ${scope} widget ${key} option value is required`);
          }
          if (optionValues.has(value)) {
            throw new ValidationError(`Node workflow ${scope} widget ${key} contains duplicate option value: ${value}`);
          }
          optionValues.add(value);
        }
      }
      if (definition.defaultValue !== undefined) {
        this.validateWidgetValue(definition, definition.defaultValue, `${scope} widget ${key} default`);
      }

      return {
        ...definition,
        key,
        label,
        description: definition.description?.trim() || undefined,
      };
    });
  }

  private validateWidgetValues(definitions: NodeWorkflowWidgetDefinition[], values: NodeWorkflowWidgetValues, scope: string): void {
    for (const definition of definitions) {
      const hasValue = Object.prototype.hasOwnProperty.call(values, definition.key);
      const value = values[definition.key];
      if (!hasValue) {
        if (definition.required && definition.defaultValue === undefined) {
          throw new ValidationError(`Node workflow ${scope} widget ${definition.key} is required`);
        }
        continue;
      }
      if (definition.required && this.isEmptyWidgetValue(value)) {
        throw new ValidationError(`Node workflow ${scope} widget ${definition.key} is required`);
      }
      if (!this.isEmptyWidgetValue(value)) {
        this.validateWidgetValue(definition, value, `${scope} widget ${definition.key}`);
      }
    }
  }

  private validateWidgetValue(definition: NodeWorkflowWidgetDefinition, value: JsonValue, label: string): void {
    switch (definition.type) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ValidationError(`Node workflow ${label} must be a finite number`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          throw new ValidationError(`Node workflow ${label} must be a boolean`);
        }
        break;
      case "select":
        if (typeof value !== "string") {
          throw new ValidationError(`Node workflow ${label} must be a string option value`);
        }
        this.validateOptionValue(definition, value, label);
        break;
      case "multiselect":
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
          throw new ValidationError(`Node workflow ${label} must be an array of string option values`);
        }
        for (const entry of value) {
          this.validateOptionValue(definition, entry, label);
        }
        break;
      case "json":
        break;
      case "key_value_list":
        if (!Array.isArray(value) || !value.every((entry) => isJsonObject(entry) && typeof entry.key === "string" && typeof entry.value === "string")) {
          throw new ValidationError(`Node workflow ${label} must be a key-value list`);
        }
        break;
      case "url":
        if (typeof value !== "string") {
          throw new ValidationError(`Node workflow ${label} must be a URL string`);
        }
        try {
          new URL(value);
        } catch {
          throw new ValidationError(`Node workflow ${label} must be a valid URL`);
        }
        break;
      default:
        if (typeof value !== "string") {
          throw new ValidationError(`Node workflow ${label} must be a string`);
        }
        break;
    }
  }

  private validateOptionValue(definition: NodeWorkflowWidgetDefinition, value: string, label: string): void {
    const options = definition.options ?? [];
    if (options.length === 0) {
      return;
    }
    if (!options.some((option) => option.value === value)) {
      throw new ValidationError(`Node workflow ${label} has unsupported option value: ${value}`);
    }
  }

  private isEmptyWidgetValue(value: JsonValue | undefined): boolean {
    return value === undefined
      || value === null
      || value === ""
      || (Array.isArray(value) && value.length === 0);
  }

  private mapWorkflowRow(row: NodeWorkflowRow): NodeWorkflowRecord {
    try {
      const record: NodeWorkflowRecord = {
        id: row.id,
        projectId: row.project_id,
        name: row.name,
        description: row.description ?? "",
        status: row.status,
        version: toNumber(row.version) || 1,
        widgetDefinitions: this.parseJsonArray<NodeWorkflowWidgetDefinition>(row.widget_definitions_json, row.id, "widget_definitions_json"),
        widgetValues: this.parseJsonObject(row.widget_values_json, row.id, "widget_values_json"),
        nodes: this.parseJsonArray<NodeWorkflowNodeRecord>(row.nodes_json, row.id, "nodes_json"),
        edges: this.parseJsonArray<NodeWorkflowEdgeRecord>(row.edges_json, row.id, "edges_json"),
        metadata: row.metadata_json ? this.parseJsonObject(row.metadata_json, row.id, "metadata_json") : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      return this.normalizeWorkflowInput(record);
    } catch (error) {
      if (error instanceof RepositoryError && !(error instanceof ValidationError)) {
        throw error;
      }
      throw new RepositoryError(`Node workflow ${row.id} has invalid persisted payload`, error);
    }
  }

  private mapAgentAttachmentRow(row: NodeWorkflowAgentAttachmentRow): NodeWorkflowAgentAttachmentRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      workflowId: row.workflow_id,
      nodeId: row.node_id,
      agentPresetId: row.agent_preset_id,
      provider: row.provider,
      role: row.role,
      label: row.label,
      config: this.parseJsonObject(row.config_json, row.id, "config_json"),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRunRow(row: NodeWorkflowRunRow): NodeWorkflowRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      workflowId: row.workflow_id,
      status: row.status,
      trigger: row.trigger_type,
      input: this.parseJsonObject(row.input_json, row.id, "input_json"),
      output: row.output_json ? this.parseJsonObject(row.output_json, row.id, "output_json") : null,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapStepRunRow(row: NodeWorkflowStepRunRow): NodeWorkflowStepRunRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      workflowId: row.workflow_id,
      workflowRunId: row.workflow_run_id,
      nodeId: row.node_id,
      status: row.status,
      attempt: toNumber(row.attempt) || 1,
      agentAttachmentId: row.agent_attachment_id,
      agentPresetId: row.agent_preset_id,
      provider: row.provider,
      input: this.parseJsonObject(row.input_json, row.id, "input_json"),
      output: row.output_json ? this.parseJsonObject(row.output_json, row.id, "output_json") : null,
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private parseJsonArray<T>(value: string, rowId: string, fieldName: string): T[] {
    const parsed = this.parseJson(value, rowId, fieldName);
    if (!Array.isArray(parsed)) {
      throw new RepositoryError(`Node workflow row ${rowId} field ${fieldName} must contain a JSON array`);
    }
    return parsed as T[];
  }

  private parseJsonObject(value: string, rowId: string, fieldName: string): JsonObject {
    const parsed = this.parseJson(value, rowId, fieldName);
    if (!isJsonObject(parsed)) {
      throw new RepositoryError(`Node workflow row ${rowId} field ${fieldName} must contain a JSON object`);
    }
    return parsed;
  }

  private parseJson(value: string, rowId: string, fieldName: string): JsonValue {
    try {
      return JSON.parse(value) as JsonValue;
    } catch (error) {
      throw new RepositoryError(`Node workflow row ${rowId} field ${fieldName} contains invalid JSON`, error);
    }
  }

  private requireWidgetValues(value: NodeWorkflowWidgetValues, label: string): NodeWorkflowWidgetValues {
    return this.requireJsonObject(value, label) as NodeWorkflowWidgetValues;
  }

  private requireJsonObject(value: JsonValue | undefined, label: string): JsonObject {
    if (!isJsonObject(value)) {
      throw new ValidationError(`Node workflow ${label} must be a JSON object`);
    }
    return value;
  }

  private normalizeNullableJsonObject(value: JsonObject | null, label: string): JsonObject | null {
    if (value === null) {
      return null;
    }
    return this.requireJsonObject(value, label);
  }

  private normalizeOptionalNodeId(workflow: NodeWorkflowRecord, nodeId: string | null | undefined): string | null {
    const normalized = nodeId?.trim() || null;
    if (!normalized) {
      return null;
    }
    if (!workflow.nodes.some((node) => node.id === normalized)) {
      throw new ValidationError(`Node workflow attachment references unknown node id: ${normalized}`);
    }
    return normalized;
  }

  private normalizeAgentPresetId(projectId: string, agentPresetId: string | null | undefined): string | null {
    const normalized = agentPresetId?.trim() || null;
    if (!normalized) {
      return null;
    }
    requireRecord(
      this.db.prepare("SELECT id FROM agent_presets WHERE project_id = ? AND id = ?").get(projectId, normalized),
      "Agent preset",
      normalized,
    );
    return normalized;
  }

  private normalizeAgentAttachmentId(projectId: string, workflowId: string, attachmentId: string | null | undefined): string | null {
    const normalized = attachmentId?.trim() || null;
    if (!normalized) {
      return null;
    }
    requireRecord(
      this.db.prepare("SELECT id FROM node_workflow_agent_attachments WHERE project_id = ? AND workflow_id = ? AND id = ?").get(projectId, workflowId, normalized),
      "Node workflow agent attachment",
      normalized,
    );
    return normalized;
  }

  private normalizeProvider(provider: ProviderId | null | undefined): ProviderId | null {
    if (provider === undefined || provider === null) {
      return null;
    }
    if (!PROVIDERS.has(provider)) {
      throw new ValidationError(`Unsupported node workflow provider: ${provider}`);
    }
    return provider;
  }

  private normalizeRunStatus(status: NodeWorkflowRunStatus): NodeWorkflowRunStatus {
    if (!RUN_STATUSES.has(status)) {
      throw new ValidationError(`Unsupported node workflow run status: ${status}`);
    }
    return status;
  }

  private normalizeRunTrigger(trigger: NodeWorkflowRunTrigger): NodeWorkflowRunTrigger {
    if (!RUN_TRIGGERS.has(trigger)) {
      throw new ValidationError(`Unsupported node workflow run trigger: ${trigger}`);
    }
    return trigger;
  }

  private normalizeStepRunStatus(status: NodeWorkflowStepRunStatus): NodeWorkflowStepRunStatus {
    if (!STEP_RUN_STATUSES.has(status)) {
      throw new ValidationError(`Unsupported node workflow step run status: ${status}`);
    }
    return status;
  }

  private normalizeAttempt(value: number): number {
    const normalized = Math.trunc(value);
    if (!Number.isFinite(normalized) || normalized < 1) {
      throw new ValidationError("Node workflow step run attempt must be a positive integer");
    }
    return normalized;
  }

  private normalizeLimit(value: number): number {
    if (!Number.isFinite(value)) {
      return 50;
    }
    return Math.max(1, Math.min(200, Math.trunc(value)));
  }

  private normalizeNullableString(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }
}

function isJsonObject(value: JsonValue | unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function raiseNotFound(entityType: string, id: string): never {
  throw new EntityNotFoundError(`${entityType} not found: ${id}`);
}
