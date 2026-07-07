import { randomUUID } from "crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import type {
  AttachNodeFlowSkillInput,
  CreateNodeFlowInput,
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNodeRunRecord,
  NodeFlowRecord,
  NodeFlowRunRecord,
  NodeFlowSkillAttachment,
  NodeFlowVersionRecord,
  UpdateNodeFlowInput,
} from "../contracts/node-flow-types.js";

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
  status: string;
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

interface NodeFlowNodeRunRow {
  id: string;
  run_id: string;
  flow_id: string;
  project_id: string;
  node_id: string;
  status: string;
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

  createFlow(projectId: string, input: CreateNodeFlowInput): NodeFlowRecord {
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
    });

    const created = this.requireFlow(id);
    this.publishProjectStructureRefresh(projectId);
    return created;
  }

  updateFlow(flowId: string, input: UpdateNodeFlowInput): NodeFlowRecord {
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
      ORDER BY created_at ASC, node_id ASC
    `).all(run.id, run.projectId) as unknown as NodeFlowNodeRunRow[];
    return rows.map((row) => this.mapNodeRunRow(row));
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

  private parseGraph(value: string): NodeFlowGraph {
    try {
      return JSON.parse(value) as NodeFlowGraph;
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
      status: row.status as NodeFlowRunRecord["status"],
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
      status: row.status as NodeFlowNodeRunRecord["status"],
      input: this.parseObject(row.input_json),
      output: this.parseObject(row.output_json),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private publishProjectStructureRefresh(projectId: string): void {
    this.realtimeNotifier?.scheduleProjectStructureRefresh(projectId, { includeProjects: false });
  }
}
