import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowNodeRunInput,
  CreateNodeFlowInput,
  CreateNodeFlowRunInput,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNodeRunRecord,
  NodeFlowNodeAttemptRecord,
  NodeFlowPublicationRecord,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowSkillAttachment,
  NodeFlowVersionRecord,
  UpdateNodeFlowNodeRunInput,
  UpdateNodeFlowInput,
  UpdateNodeFlowRunInput,
} from "../contracts/node-flow-types.js";
import { DEFAULT_NODE_FLOW_EXECUTION_POLICY } from "../contracts/node-flow-execution-policy-types.js";
import type { NodeFlowExecutionPolicySnapshot, NodeFlowFailureClassification } from "../contracts/node-flow-execution-policy-types.js";
import { migrateNodeFlowGraph } from "../domain/node-flows/node-flow-migrators.js";

interface NodeFlowRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  graph_json: string;
  version: number | string;
  created_at: string;
  updated_at: string;
}

interface NodeFlowVersionRow {
  id: string;
  flow_id: string;
  project_id: string;
  version: number | string;
  title: string;
  description: string | null;
  graph_json: string;
  created_at: string;
}

interface NodeFlowSkillAttachmentRow {
  flow_id: string;
  project_id: string;
  agent_preset_id: string;
  skill_name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeFlowRunRow {
  id: string;
  flow_id: string;
  project_id: string;
  version: number | string;
  publication_id: string | null;
  policy_json: string;
  status: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  cancel_requested_at: string | null;
  execution_invocation_id: string | null;
  trigger_type: string;
  trigger_payload_json: string | null;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeFlowPublicationRow {
  id: string; flow_id: string; project_id: string; version: number | string;
  graph_json: string; policy_json: string; published_by: string; created_at: string;
}

interface NodeFlowAttemptRow {
  id: string; run_id: string; node_run_id: string; node_id: string; attempt_number: number | string;
  logical_item: string;
  status: string; executor_id: string; invocation_id: string | null; artifact_digest: string | null;
  input_json: string | null; output_json: string | null; credential_ids_json: string;
  failure_classification: string | null; retry_decision: string | null; error_message: string | null;
  started_at: string; finished_at: string | null; created_at: string;
}

interface NodeFlowNodeRunRow {
  id: string;
  run_id: string;
  flow_id: string;
  project_id: string;
  node_id: string;
  logical_item: string;
  status: string;
  execution_invocation_id: string | null;
  input_json: string | null;
  output_json: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export class NodeFlowRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  listFlows(projectId: string): NodeFlowRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flows
      WHERE project_id = ?
      ORDER BY updated_at DESC, created_at DESC, title ASC
    `).all(projectId) as unknown as NodeFlowRow[];
    return rows.map((row) => this.mapFlowRow(row));
  }

  getFlow(flowId: string): NodeFlowRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM node_flows
      WHERE id = ?
    `).get(flowId) as NodeFlowRow | undefined;
    return row ? this.mapFlowRow(row) : null;
  }

  createFlow(projectId: string, input: CreateNodeFlowInput, options: { publish?: boolean; publishedBy?: string } = {}): NodeFlowRecord {
    this.requireProject(projectId);
    const now = new Date().toISOString();
    const id = input.id?.trim() || randomUUID();
    const title = this.requireTitle(input.title);
    const description = input.description?.trim() || "";
    const graphJson = this.serializeJson(input.graph);

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO node_flows (id, project_id, title, description, graph_json, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `).run(id, projectId, title, description, graphJson, now, now);
      this.insertVersion({
        flowId: id,
        projectId,
        version: 1,
        title,
        description,
        graphJson,
        createdAt: now,
      });
      if (options.publish !== false) {
        this.insertPublication(id, projectId, 1, graphJson, DEFAULT_NODE_FLOW_EXECUTION_POLICY, options.publishedBy ?? "system");
      }
    });

    const created = this.requireFlow(id);
    this.publishProjectStructureRefresh(projectId);
    return created;
  }

  updateFlow(flowId: string, input: UpdateNodeFlowInput, options: { publish?: boolean; publishedBy?: string } = {}): NodeFlowRecord {
    const current = this.requireFlow(flowId);
    const now = new Date().toISOString();
    const title = input.title === undefined ? current.title : this.requireTitle(input.title);
    const description = input.description === undefined ? current.description : input.description.trim();
    const graph = input.graph === undefined ? current.graph : input.graph;
    const graphJson = this.serializeJson(graph);
    const nextVersion = current.version + 1;

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE node_flows
        SET title = ?, description = ?, graph_json = ?, version = ?, updated_at = ?
        WHERE id = ?
      `).run(title, description, graphJson, nextVersion, now, flowId);
      this.insertVersion({
        flowId,
        projectId: current.projectId,
        version: nextVersion,
        title,
        description,
        graphJson,
        createdAt: now,
      });
      if (options.publish !== false) {
        this.insertPublication(flowId, current.projectId, nextVersion, graphJson, DEFAULT_NODE_FLOW_EXECUTION_POLICY, options.publishedBy ?? "system");
      }
    });

    const updated = this.requireFlow(flowId);
    this.publishProjectStructureRefresh(updated.projectId);
    return updated;
  }

  deleteFlow(flowId: string): void {
    const current = this.requireFlow(flowId);
    this.db.prepare(`DELETE FROM node_flows WHERE id = ?`).run(flowId);
    this.publishProjectStructureRefresh(current.projectId);
  }

  listVersions(flowId: string): NodeFlowVersionRecord[] {
    const flow = this.requireFlow(flowId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flow_versions
      WHERE flow_id = ?
      ORDER BY version DESC
    `).all(flow.id) as unknown as NodeFlowVersionRow[];
    return rows.map((row) => this.mapVersionRow(row));
  }

  getVersion(flowId: string, version: number): NodeFlowVersionRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM node_flow_versions
      WHERE flow_id = ?
        AND version = ?
    `).get(flowId, Math.max(1, Math.floor(version))) as NodeFlowVersionRow | undefined;
    return row ? this.mapVersionRow(row) : null;
  }

  listPublications(flowId: string): NodeFlowPublicationRecord[] {
    this.requireFlow(flowId);
    return (this.db.prepare(`SELECT * FROM node_flow_publications WHERE flow_id = ? ORDER BY version DESC`).all(flowId) as unknown as NodeFlowPublicationRow[])
      .map((row) => this.mapPublicationRow(row));
  }

  getPublication(flowId: string, version?: number): NodeFlowPublicationRecord | null {
    const row = version === undefined
      ? this.db.prepare(`SELECT * FROM node_flow_publications WHERE flow_id = ? ORDER BY version DESC LIMIT 1`).get(flowId)
      : this.db.prepare(`SELECT * FROM node_flow_publications WHERE flow_id = ? AND version = ?`).get(flowId, Math.floor(version));
    return row ? this.mapPublicationRow(row as NodeFlowPublicationRow) : null;
  }

  publishVersion(flowId: string, version: number, policy: NodeFlowExecutionPolicySnapshot = DEFAULT_NODE_FLOW_EXECUTION_POLICY, publishedBy = "system"): NodeFlowPublicationRecord {
    const snapshot = this.getVersion(flowId, version);
    if (!snapshot) throw new EntityNotFoundError(`Node flow version not found: ${flowId}@${version}`);
    this.insertPublication(flowId, snapshot.projectId, snapshot.version, this.serializeJson(snapshot.graph), policy, publishedBy);
    return requireRecord(this.getPublication(flowId, version), "Node flow publication", `${flowId}@${version}`);
  }

  attachToAgent(flowId: string, input: AttachNodeFlowSkillInput): NodeFlowSkillAttachment {
    const flow = this.requireFlow(flowId);
    const agentPresetId = input.agentPresetId?.trim();
    if (!agentPresetId) {
      throw new ValidationError("agentPresetId is required.");
    }
    this.requireAgent(flow.projectId, agentPresetId);
    const now = new Date().toISOString();
    const skillName = input.skillName?.trim() || flow.title;
    const description = input.description?.trim() || flow.description;

    this.db.prepare(`
      INSERT INTO node_flow_agent_skills (
        flow_id, project_id, agent_preset_id, skill_name, description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ${this.db.dialect.upsert(["flow_id", "agent_preset_id"], ["skill_name", "description", "updated_at"])}
    `).run(flow.id, flow.projectId, agentPresetId, skillName, description, now, now);
    const attachment = requireRecord(
      this.getAttachment(flow.id, agentPresetId),
      "Node flow agent skill attachment",
      `${flow.id}:${agentPresetId}`,
    );
    this.publishProjectStructureRefresh(flow.projectId);
    return attachment;
  }

  detachFromAgent(flowId: string, agentPresetId: string): void {
    const flow = this.requireFlow(flowId);
    const normalizedAgentPresetId = agentPresetId.trim();
    if (!normalizedAgentPresetId) {
      throw new ValidationError("agentPresetId is required.");
    }
    this.requireAgent(flow.projectId, normalizedAgentPresetId);
    this.db.prepare(`
      DELETE FROM node_flow_agent_skills
      WHERE flow_id = ?
        AND project_id = ?
        AND agent_preset_id = ?
    `).run(flow.id, flow.projectId, normalizedAgentPresetId);
    this.publishProjectStructureRefresh(flow.projectId);
  }

  listAgentSkills(flowId: string): NodeFlowSkillAttachment[] {
    const flow = this.requireFlow(flowId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flow_agent_skills
      WHERE flow_id = ?
        AND project_id = ?
      ORDER BY created_at ASC, agent_preset_id ASC
    `).all(flow.id, flow.projectId) as unknown as NodeFlowSkillAttachmentRow[];
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  listAgentSkillsForAgent(projectId: string, agentPresetId: string): NodeFlowSkillAttachment[] {
    this.requireAgent(projectId, agentPresetId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flow_agent_skills
      WHERE project_id = ?
        AND agent_preset_id = ?
      ORDER BY created_at ASC, flow_id ASC
    `).all(projectId, agentPresetId) as unknown as NodeFlowSkillAttachmentRow[];
    return rows.map((row) => this.mapAttachmentRow(row));
  }

  listRuns(flowId: string, limit = 50): NodeFlowRunRecord[] {
    const flow = this.requireFlow(flowId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flow_runs
      WHERE flow_id = ?
        AND project_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(flow.id, flow.projectId, Math.max(1, Math.min(250, Math.floor(limit)))) as unknown as NodeFlowRunRow[];
    return rows.map((row) => this.mapRunRow(row));
  }

  getRun(runId: string): NodeFlowRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM node_flow_runs
      WHERE id = ?
    `).get(runId) as NodeFlowRunRow | undefined;
    return row ? this.mapRunRow(row) : null;
  }

  listNodeRuns(runId: string): NodeFlowNodeRunRecord[] {
    const run = requireRecord(this.getRun(runId), "Node flow run", runId);
    const rows = this.db.prepare(`
      SELECT *
      FROM node_flow_node_runs
      WHERE run_id = ?
        AND project_id = ?
      ORDER BY created_at ASC, rowid ASC
    `).all(run.id, run.projectId) as unknown as NodeFlowNodeRunRow[];
    return rows.map((row) => this.mapNodeRunRow(row));
  }

  createRun(input: CreateNodeFlowRunInput): NodeFlowRunRecord {
    const flow = this.requireFlow(input.flowId);
    if (flow.projectId !== input.projectId) {
      throw new ValidationError("Node flow run projectId must match the flow project.");
    }
    this.requireProject(input.projectId);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO node_flow_runs (
        id, flow_id, project_id, version, publication_id, policy_json, status, execution_invocation_id, trigger_type,
        trigger_payload_json, input_json, output_json, error_message, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.flowId,
      input.projectId,
      Math.max(1, Math.floor(input.version)),
      input.publicationId ?? null,
      this.serializeJson(input.policy ?? DEFAULT_NODE_FLOW_EXECUTION_POLICY),
      input.status || "running",
      input.executionInvocationId ?? null,
      input.triggerType?.trim() || "manual",
      input.triggerPayload ? this.serializeJson(input.triggerPayload) : null,
      input.input ? this.serializeJson(input.input) : null,
      input.output ? this.serializeJson(input.output) : null,
      input.errorMessage ?? null,
      input.startedAt ?? now,
      input.finishedAt ?? null,
      now,
      now,
    );
    return requireRecord(this.getRun(id), "Node flow run", id);
  }

  updateRun(runId: string, input: UpdateNodeFlowRunInput): NodeFlowRunRecord {
    const current = requireRecord(this.getRun(runId), "Node flow run", runId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE node_flow_runs
      SET status = ?,
          execution_invocation_id = ?,
          output_json = ?,
          error_message = ?,
          started_at = ?,
          finished_at = ?, lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, cancel_requested_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.status ?? current.status,
      input.executionInvocationId === undefined ? current.executionInvocationId : input.executionInvocationId,
      input.output === undefined ? this.serializeNullableJson(current.output) : this.serializeNullableJson(input.output),
      input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      input.leaseOwner === undefined ? current.leaseOwner : input.leaseOwner,
      input.leaseExpiresAt === undefined ? current.leaseExpiresAt : input.leaseExpiresAt,
      input.heartbeatAt === undefined ? current.heartbeatAt : input.heartbeatAt,
      input.cancelRequestedAt === undefined ? current.cancelRequestedAt : input.cancelRequestedAt,
      now,
      runId,
    );
    return requireRecord(this.getRun(runId), "Node flow run", runId);
  }

  claimQueuedRun(runId: string, executorId: string, leaseDurationMs: number, now = new Date()): NodeFlowRunRecord | null {
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const result = this.db.prepare(`UPDATE node_flow_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ? AND status IN ('queued','retry_waiting') AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`)
      .run(executorId, expiresAt, now.toISOString(), now.toISOString(), now.toISOString(), runId, now.toISOString());
    return result.changes > 0 ? this.getRun(runId) : null;
  }

  claimApprovalWaitingRun(runId: string, executorId: string, leaseDurationMs: number, now = new Date()): NodeFlowRunRecord | null {
    const expiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const result = this.db.prepare(`UPDATE node_flow_runs SET status = 'running', lease_owner = ?, lease_expires_at = ?, heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'approval_waiting' AND cancel_requested_at IS NULL`)
      .run(executorId, expiresAt, now.toISOString(), now.toISOString(), runId);
    return result.changes > 0 ? this.getRun(runId) : null;
  }

  heartbeatRun(runId: string, executorId: string, leaseDurationMs: number, now = new Date()): boolean {
    const result = this.db.prepare(`UPDATE node_flow_runs SET heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND lease_owner = ?`)
      .run(now.toISOString(), new Date(now.getTime() + leaseDurationMs).toISOString(), now.toISOString(), runId, executorId);
    return result.changes > 0;
  }

  countActiveRuns(projectId?: string): number {
    const row = projectId
      ? this.db.prepare(`SELECT COUNT(*) AS count FROM node_flow_runs WHERE project_id = ? AND status = 'running'`).get(projectId)
      : this.db.prepare(`SELECT COUNT(*) AS count FROM node_flow_runs WHERE status = 'running'`).get();
    return toNumber((row as { count: number | string }).count);
  }

  listRecoverableRuns(nowIso = new Date().toISOString()): NodeFlowRunRecord[] {
    return (this.db.prepare(`SELECT * FROM node_flow_runs WHERE status IN ('queued','retry_waiting','approval_waiting') OR (status = 'running' AND lease_expires_at <= ?) ORDER BY created_at ASC`).all(nowIso) as unknown as NodeFlowRunRow[]).map((row) => this.mapRunRow(row));
  }

  requestCancellation(runId: string): NodeFlowRunRecord {
    return this.updateRun(runId, { cancelRequestedAt: new Date().toISOString() });
  }

  createNodeAttempt(input: Omit<NodeFlowNodeAttemptRecord, "id" | "createdAt">): NodeFlowNodeAttemptRecord {
    const id = randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO node_flow_node_attempts (id, run_id, node_run_id, node_id, logical_item, attempt_number, status, executor_id, invocation_id, artifact_digest, input_json, output_json, credential_ids_json, failure_classification, retry_decision, error_message, started_at, finished_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, input.runId, input.nodeRunId, input.nodeId, input.logicalItem?.trim() || "default", input.attemptNumber, input.status, input.executorId, input.invocationId, input.artifactDigest, this.serializeNullableJson(input.input), this.serializeNullableJson(input.output), JSON.stringify(input.credentialIds), input.failureClassification, input.retryDecision, input.errorMessage, input.startedAt, input.finishedAt, now);
    return requireRecord(this.getNodeAttempt(id), "Node flow node attempt", id);
  }

  updateNodeAttempt(id: string, input: Partial<Pick<NodeFlowNodeAttemptRecord, "status" | "invocationId" | "artifactDigest" | "output" | "failureClassification" | "retryDecision" | "errorMessage" | "finishedAt">>): NodeFlowNodeAttemptRecord {
    const current = requireRecord(this.getNodeAttempt(id), "Node flow node attempt", id);
    this.db.prepare(`UPDATE node_flow_node_attempts SET status = ?, invocation_id = ?, artifact_digest = ?, output_json = ?, failure_classification = ?, retry_decision = ?, error_message = ?, finished_at = ? WHERE id = ?`)
      .run(input.status ?? current.status, input.invocationId === undefined ? current.invocationId : input.invocationId, input.artifactDigest === undefined ? current.artifactDigest : input.artifactDigest, input.output === undefined ? this.serializeNullableJson(current.output) : this.serializeNullableJson(input.output), input.failureClassification === undefined ? current.failureClassification : input.failureClassification, input.retryDecision === undefined ? current.retryDecision : input.retryDecision, input.errorMessage === undefined ? current.errorMessage : input.errorMessage, input.finishedAt === undefined ? current.finishedAt : input.finishedAt, id);
    return requireRecord(this.getNodeAttempt(id), "Node flow node attempt", id);
  }

  listNodeAttempts(runId: string): NodeFlowNodeAttemptRecord[] {
    return (this.db.prepare(`SELECT * FROM node_flow_node_attempts WHERE run_id = ? ORDER BY node_id, logical_item, attempt_number`).all(runId) as unknown as NodeFlowAttemptRow[]).map((row) => this.mapAttemptRow(row));
  }

  createNodeRun(input: CreateNodeFlowNodeRunInput): NodeFlowNodeRunRecord {
    const run = requireRecord(this.getRun(input.runId), "Node flow run", input.runId);
    if (run.flowId !== input.flowId || run.projectId !== input.projectId) {
      throw new ValidationError("Node flow node run scope must match the parent run.");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO node_flow_node_runs (
        id, run_id, flow_id, project_id, node_id, logical_item, status, execution_invocation_id,
        input_json, output_json, error_message, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.runId,
      input.flowId,
      input.projectId,
      input.nodeId,
      input.logicalItem?.trim() || "default",
      input.status || "pending",
      input.executionInvocationId ?? null,
      input.input ? this.serializeJson(input.input) : null,
      input.output ? this.serializeJson(input.output) : null,
      input.errorMessage ?? null,
      input.startedAt ?? null,
      input.finishedAt ?? null,
      now,
      now,
    );
    return requireRecord(this.getNodeRun(id), "Node flow node run", id);
  }

  updateNodeRun(nodeRunId: string, input: UpdateNodeFlowNodeRunInput): NodeFlowNodeRunRecord {
    const current = requireRecord(this.getNodeRun(nodeRunId), "Node flow node run", nodeRunId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE node_flow_node_runs
      SET status = ?,
          execution_invocation_id = ?,
          input_json = ?,
          output_json = ?,
          error_message = ?,
          started_at = ?,
          finished_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      input.status ?? current.status,
      input.executionInvocationId === undefined ? current.executionInvocationId : input.executionInvocationId,
      input.input === undefined ? this.serializeNullableJson(current.input) : this.serializeNullableJson(input.input),
      input.output === undefined ? this.serializeNullableJson(current.output) : this.serializeNullableJson(input.output),
      input.errorMessage === undefined ? current.errorMessage : input.errorMessage,
      input.startedAt === undefined ? current.startedAt : input.startedAt,
      input.finishedAt === undefined ? current.finishedAt : input.finishedAt,
      now,
      nodeRunId,
    );
    return requireRecord(this.getNodeRun(nodeRunId), "Node flow node run", nodeRunId);
  }

  private insertVersion(input: {
    flowId: string;
    projectId: string;
    version: number;
    title: string;
    description: string;
    graphJson: string;
    createdAt: string;
  }): void {
    this.db.prepare(`
      INSERT INTO node_flow_versions (
        id, flow_id, project_id, version, title, description, graph_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      input.flowId,
      input.projectId,
      input.version,
      input.title,
      input.description,
      input.graphJson,
      input.createdAt,
    );
  }

  private insertPublication(flowId: string, projectId: string, version: number, graphJson: string, policy: NodeFlowExecutionPolicySnapshot, publishedBy: string): void {
    this.db.prepare(`INSERT OR IGNORE INTO node_flow_publications (id, flow_id, project_id, version, graph_json, policy_json, published_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), flowId, projectId, version, graphJson, this.serializeJson(policy), publishedBy, new Date().toISOString());
  }

  private requireProject(projectId: string): void {
    requireRecord(this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId), "Project", projectId);
  }

  private requireAgent(projectId: string, agentPresetId: string): void {
    requireRecord(
      this.db.prepare(`SELECT id FROM agent_presets WHERE id = ? AND project_id = ?`).get(agentPresetId, projectId),
      "Agent preset",
      agentPresetId,
    );
  }

  private requireFlow(flowId: string): NodeFlowRecord {
    const flow = this.getFlow(flowId);
    if (!flow) {
      throw new EntityNotFoundError(`Node flow not found: ${flowId}`);
    }
    return flow;
  }

  private getAttachment(flowId: string, agentPresetId: string): NodeFlowSkillAttachment | null {
    const row = this.db.prepare(`
      SELECT *
      FROM node_flow_agent_skills
      WHERE flow_id = ?
        AND agent_preset_id = ?
    `).get(flowId, agentPresetId) as NodeFlowSkillAttachmentRow | undefined;
    return row ? this.mapAttachmentRow(row) : null;
  }

  private getNodeRun(nodeRunId: string): NodeFlowNodeRunRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM node_flow_node_runs
      WHERE id = ?
    `).get(nodeRunId) as NodeFlowNodeRunRow | undefined;
    return row ? this.mapNodeRunRow(row) : null;
  }

  private getNodeAttempt(id: string): NodeFlowNodeAttemptRecord | null {
    const row = this.db.prepare(`SELECT * FROM node_flow_node_attempts WHERE id = ?`).get(id) as NodeFlowAttemptRow | undefined;
    return row ? this.mapAttemptRow(row) : null;
  }

  private requireTitle(title: string | undefined): string {
    const normalized = title?.trim();
    if (!normalized) {
      throw new ValidationError("Node flow title is required.");
    }
    return normalized;
  }

  private serializeJson(value: unknown): string {
    return JSON.stringify(value ?? {});
  }

  private serializeNullableJson(value: NodeFlowJsonObject | null): string | null {
    return value === null ? null : this.serializeJson(value);
  }

  private parseGraph(value: string): NodeFlowGraph {
    try {
      return migrateNodeFlowGraph(JSON.parse(value) as unknown).graph;
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  private parseObject(value: string | null): NodeFlowJsonObject | null {
    if (!value) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      return this.isJsonObject(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  }

  private parsePolicy(value: string): NodeFlowExecutionPolicySnapshot {
    try { return { ...DEFAULT_NODE_FLOW_EXECUTION_POLICY, ...JSON.parse(value) as NodeFlowExecutionPolicySnapshot }; }
    catch { return { ...DEFAULT_NODE_FLOW_EXECUTION_POLICY }; }
  }

  private isJsonValue(value: unknown): value is NodeFlowJsonValue {
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
      return value.every((entry) => this.isJsonValue(entry));
    }
    return this.isJsonObject(value);
  }

  private isJsonObject(value: unknown): value is NodeFlowJsonObject {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.values(value as Record<string, unknown>).every((entry) => this.isJsonValue(entry));
  }

  private mapFlowRow(row: NodeFlowRow): NodeFlowRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? "",
      graph: this.parseGraph(row.graph_json),
      version: toNumber(row.version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapVersionRow(row: NodeFlowVersionRow): NodeFlowVersionRecord {
    return {
      id: row.id,
      flowId: row.flow_id,
      projectId: row.project_id,
      version: toNumber(row.version),
      title: row.title,
      description: row.description ?? "",
      graph: this.parseGraph(row.graph_json),
      createdAt: row.created_at,
    };
  }

  private mapAttachmentRow(row: NodeFlowSkillAttachmentRow): NodeFlowSkillAttachment {
    return {
      flowId: row.flow_id,
      projectId: row.project_id,
      agentPresetId: row.agent_preset_id,
      skillName: row.skill_name,
      description: row.description ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRunRow(row: NodeFlowRunRow): NodeFlowRunRecord {
    return {
      id: row.id,
      flowId: row.flow_id,
      projectId: row.project_id,
      version: toNumber(row.version),
      publicationId: row.publication_id,
      status: row.status as NodeFlowRunRecord["status"],
      policy: this.parsePolicy(row.policy_json),
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      heartbeatAt: row.heartbeat_at,
      cancelRequestedAt: row.cancel_requested_at,
      executionInvocationId: row.execution_invocation_id,
      triggerType: row.trigger_type,
      triggerPayload: this.parseObject(row.trigger_payload_json),
      input: this.parseObject(row.input_json),
      output: this.parseObject(row.output_json),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapNodeRunRow(row: NodeFlowNodeRunRow): NodeFlowNodeRunRecord {
    return {
      id: row.id,
      runId: row.run_id,
      flowId: row.flow_id,
      projectId: row.project_id,
      nodeId: row.node_id,
      logicalItem: row.logical_item || "default",
      status: row.status as NodeFlowNodeRunRecord["status"],
      executionInvocationId: row.execution_invocation_id,
      input: this.parseObject(row.input_json),
      output: this.parseObject(row.output_json),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapPublicationRow(row: NodeFlowPublicationRow): NodeFlowPublicationRecord {
    return { id: row.id, flowId: row.flow_id, projectId: row.project_id, version: toNumber(row.version), graph: this.parseGraph(row.graph_json), policy: this.parsePolicy(row.policy_json), publishedBy: row.published_by, createdAt: row.created_at };
  }

  private mapAttemptRow(row: NodeFlowAttemptRow): NodeFlowNodeAttemptRecord {
    let credentialIds: string[] = [];
    try { const parsed = JSON.parse(row.credential_ids_json) as unknown; if (Array.isArray(parsed)) credentialIds = parsed.filter((item): item is string => typeof item === "string"); } catch { /* legacy row */ }
    return { id: row.id, runId: row.run_id, nodeRunId: row.node_run_id, nodeId: row.node_id, logicalItem: row.logical_item || "default", attemptNumber: toNumber(row.attempt_number), status: row.status as NodeFlowNodeRunRecord["status"], executorId: row.executor_id, invocationId: row.invocation_id, artifactDigest: row.artifact_digest, input: this.parseObject(row.input_json), output: this.parseObject(row.output_json), credentialIds, failureClassification: row.failure_classification as NodeFlowFailureClassification | null, retryDecision: row.retry_decision as NodeFlowNodeAttemptRecord["retryDecision"], errorMessage: row.error_message, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at };
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: false });
  }
}
