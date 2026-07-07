import { randomUUID } from "crypto";
import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CreateCustomDashboardValidationSessionInput,
  CustomDashboardDataSourceEdge,
  CustomDashboardDataSourceNode,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardStatus,
  CustomDashboardValidationReport,
  CustomDashboardValidationSessionRecord,
  CustomDashboardValidationStatus,
  UpdateCustomDashboardDraftInput,
  UpdateCustomDashboardValidationSessionInput,
} from "../contracts/custom-dashboard-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toNumber, ValidationError } from "./repository-utils.js";

interface CustomDashboardRow {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  manifest_json: string;
  files_json: string;
  source_node_graph_json: string;
  styleguide_json: string;
  runtime_metadata_json: string;
  published_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CustomDashboardRevisionRow {
  id: string;
  dashboard_id: string;
  project_id: string;
  revision_number: number | string;
  manifest_json: string;
  files_json: string;
  source_node_graph_json: string;
  styleguide_json: string;
  validation_status: string | null;
  validation_report_json: string | null;
  runtime_metadata_json: string;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
}

interface CustomDashboardValidationSessionRow {
  id: string;
  dashboard_id: string;
  revision_id: string;
  project_id: string;
  status: string;
  validation_report_json: string | null;
  runtime_metadata_json: string;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

const DASHBOARD_STATUSES: readonly CustomDashboardStatus[] = [
  "draft",
  "validating",
  "validated",
  "published",
  "rejected",
  "archived",
];

const VALIDATION_STATUSES: readonly CustomDashboardValidationStatus[] = [
  "queued",
  "building",
  "running",
  "passed",
  "failed",
  "cancelled",
];

export class CustomDashboardRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listDashboardsByProject(projectId: string): CustomDashboardRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT
        cd.*,
        cdp.revision_id AS published_revision_id
      FROM custom_dashboards cd
      LEFT JOIN custom_dashboard_publications cdp ON cdp.dashboard_id = cd.id
      WHERE cd.project_id = ?
      ORDER BY cd.updated_at DESC, cd.created_at DESC, cd.title ASC
    `).all(projectId) as unknown as CustomDashboardRow[];
    return rows.map((row) => this.mapDashboardRow(row));
  }

  getDashboardById(dashboardId: string): CustomDashboardRecord | null {
    const row = this.db.prepare(`
      SELECT
        cd.*,
        cdp.revision_id AS published_revision_id
      FROM custom_dashboards cd
      LEFT JOIN custom_dashboard_publications cdp ON cdp.dashboard_id = cd.id
      WHERE cd.id = ?
    `).get(dashboardId) as CustomDashboardRow | undefined;
    return row ? this.mapDashboardRow(row) : null;
  }

  createDraft(projectId: string, input: CreateCustomDashboardDraftInput): CustomDashboardRecord {
    this.requireProject(projectId);
    const now = new Date().toISOString();
    const id = input.id?.trim() || randomUUID();
    const title = this.requireTitle(input.title);
    const description = input.description?.trim() || "";
    const manifest = this.normalizeManifest(input.manifest);
    const fileBundle = this.normalizeFileBundle(input.fileBundle);
    const sourceNodeGraph = this.normalizeSourceNodeGraph(input.sourceNodeGraph);
    const styleguide = this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = this.normalizeJsonObject(input.runtimeMetadata);

    this.db.prepare(`
      INSERT INTO custom_dashboards (
        id, project_id, title, description, status, manifest_json, files_json,
        source_node_graph_json, styleguide_json, runtime_metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      projectId,
      title,
      description,
      this.serializeJson(manifest),
      this.serializeJson(fileBundle),
      this.serializeJson(sourceNodeGraph),
      this.serializeJson(styleguide),
      this.serializeJson(runtimeMetadata),
      now,
      now,
    );

    return this.requireDashboard(id);
  }

  updateDraft(dashboardId: string, input: UpdateCustomDashboardDraftInput): CustomDashboardRecord {
    const current = this.requireDashboard(dashboardId);
    if (current.status === "archived") {
      throw new ValidationError("Archived custom dashboards cannot be updated.");
    }
    const now = new Date().toISOString();
    const title = input.title === undefined ? current.title : this.requireTitle(input.title);
    const description = input.description === undefined ? current.description : input.description.trim();
    const manifest = input.manifest === undefined ? current.manifest : this.normalizeManifest(input.manifest);
    const fileBundle = input.fileBundle === undefined ? current.fileBundle : this.normalizeFileBundle(input.fileBundle);
    const sourceNodeGraph = input.sourceNodeGraph === undefined
      ? current.sourceNodeGraph
      : this.normalizeSourceNodeGraph(input.sourceNodeGraph);
    const styleguide = input.styleguide === undefined ? current.styleguide : this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = input.runtimeMetadata === undefined
      ? current.runtimeMetadata
      : this.normalizeJsonObject(input.runtimeMetadata);

    this.db.prepare(`
      UPDATE custom_dashboards
      SET title = ?,
          description = ?,
          manifest_json = ?,
          files_json = ?,
          source_node_graph_json = ?,
          styleguide_json = ?,
          runtime_metadata_json = ?,
          status = CASE WHEN status IN ('validated', 'rejected') THEN 'draft' ELSE status END,
          updated_at = ?
      WHERE id = ?
    `).run(
      title,
      description,
      this.serializeJson(manifest),
      this.serializeJson(fileBundle),
      this.serializeJson(sourceNodeGraph),
      this.serializeJson(styleguide),
      this.serializeJson(runtimeMetadata),
      now,
      dashboardId,
    );

    return this.requireDashboard(dashboardId);
  }

  createRevision(dashboardId: string, input: CreateCustomDashboardRevisionInput = {}): CustomDashboardRevisionRecord {
    const dashboard = this.requireDashboard(dashboardId);
    if (dashboard.status === "archived") {
      throw new ValidationError("Archived custom dashboards cannot create revisions.");
    }
    const now = new Date().toISOString();
    const id = randomUUID();
    const revisionNumber = this.getNextRevisionNumber(dashboard.id);
    const manifest = input.manifest === undefined ? dashboard.manifest : this.normalizeManifest(input.manifest);
    const fileBundle = input.fileBundle === undefined ? dashboard.fileBundle : this.normalizeFileBundle(input.fileBundle);
    const sourceNodeGraph = input.sourceNodeGraph === undefined
      ? dashboard.sourceNodeGraph
      : this.normalizeSourceNodeGraph(input.sourceNodeGraph);
    const styleguide = input.styleguide === undefined ? dashboard.styleguide : this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = input.runtimeMetadata === undefined
      ? dashboard.runtimeMetadata
      : this.normalizeJsonObject(input.runtimeMetadata);

    this.db.prepare(`
      INSERT INTO custom_dashboard_revisions (
        id, dashboard_id, project_id, revision_number, manifest_json, files_json,
        source_node_graph_json, styleguide_json, validation_status, validation_report_json,
        runtime_metadata_json, validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)
    `).run(
      id,
      dashboard.id,
      dashboard.projectId,
      revisionNumber,
      this.serializeJson(manifest),
      this.serializeJson(fileBundle),
      this.serializeJson(sourceNodeGraph),
      this.serializeJson(styleguide),
      this.serializeJson(runtimeMetadata),
      now,
      now,
    );

    return this.requireRevision(id);
  }

  listRevisions(dashboardId: string): CustomDashboardRevisionRecord[] {
    const dashboard = this.requireDashboard(dashboardId);
    const rows = this.db.prepare(`
      SELECT *
      FROM custom_dashboard_revisions
      WHERE dashboard_id = ?
        AND project_id = ?
      ORDER BY revision_number DESC
    `).all(dashboard.id, dashboard.projectId) as unknown as CustomDashboardRevisionRow[];
    return rows.map((row) => this.mapRevisionRow(row));
  }

  getRevisionById(revisionId: string): CustomDashboardRevisionRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM custom_dashboard_revisions
      WHERE id = ?
    `).get(revisionId) as CustomDashboardRevisionRow | undefined;
    return row ? this.mapRevisionRow(row) : null;
  }

  createValidationSession(
    revisionId: string,
    input: CreateCustomDashboardValidationSessionInput = {},
  ): CustomDashboardValidationSessionRecord {
    const revision = this.requireRevision(revisionId);
    const dashboard = this.requireDashboard(revision.dashboardId);
    const now = new Date().toISOString();
    const id = input.id?.trim() || randomUUID();
    const status = this.normalizeValidationStatus(input.status ?? "queued");
    const validationReport = input.validationReport === undefined || input.validationReport === null
      ? null
      : this.normalizeValidationReport(input.validationReport);
    const runtimeMetadata = this.normalizeJsonObject(input.runtimeMetadata);
    const startedAt = input.startedAt === undefined ? null : input.startedAt;
    const finishedAt = input.finishedAt === undefined ? null : input.finishedAt;

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO custom_dashboard_validation_sessions (
          id, dashboard_id, revision_id, project_id, status, validation_report_json,
          runtime_metadata_json, started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        dashboard.id,
        revision.id,
        revision.projectId,
        status,
        this.serializeNullableJson(validationReport),
        this.serializeJson(runtimeMetadata),
        startedAt,
        finishedAt,
        now,
        now,
      );
      this.applyValidationStatus(revision, status, validationReport, now);
    });

    return this.requireValidationSession(id);
  }

  updateValidationSession(
    sessionId: string,
    input: UpdateCustomDashboardValidationSessionInput,
  ): CustomDashboardValidationSessionRecord {
    const current = this.requireValidationSession(sessionId);
    const revision = this.requireRevision(current.revisionId);
    const now = new Date().toISOString();
    const status = input.status === undefined ? current.status : this.normalizeValidationStatus(input.status);
    const validationReport = input.validationReport === undefined
      ? current.validationReport
      : input.validationReport === null
        ? null
        : this.normalizeValidationReport(input.validationReport);
    const runtimeMetadata = input.runtimeMetadata === undefined
      ? current.runtimeMetadata
      : this.normalizeJsonObject(input.runtimeMetadata);
    const startedAt = input.startedAt === undefined ? current.startedAt : input.startedAt;
    const finishedAt = input.finishedAt === undefined ? current.finishedAt : input.finishedAt;

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE custom_dashboard_validation_sessions
        SET status = ?,
            validation_report_json = ?,
            runtime_metadata_json = ?,
            started_at = ?,
            finished_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        status,
        this.serializeNullableJson(validationReport),
        this.serializeJson(runtimeMetadata),
        startedAt,
        finishedAt,
        now,
        sessionId,
      );
      this.applyValidationStatus(revision, status, validationReport, now);
    });

    return this.requireValidationSession(sessionId);
  }

  listValidationSessions(revisionId: string): CustomDashboardValidationSessionRecord[] {
    const revision = this.requireRevision(revisionId);
    const rows = this.db.prepare(`
      SELECT *
      FROM custom_dashboard_validation_sessions
      WHERE revision_id = ?
        AND project_id = ?
      ORDER BY created_at DESC
    `).all(revision.id, revision.projectId) as unknown as CustomDashboardValidationSessionRow[];
    return rows.map((row) => this.mapValidationSessionRow(row));
  }

  getValidationSessionById(sessionId: string): CustomDashboardValidationSessionRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM custom_dashboard_validation_sessions
      WHERE id = ?
    `).get(sessionId) as CustomDashboardValidationSessionRow | undefined;
    return row ? this.mapValidationSessionRow(row) : null;
  }

  markRevisionValidated(
    revisionId: string,
    validationReport: CustomDashboardValidationReport,
  ): CustomDashboardRevisionRecord {
    const revision = this.requireRevision(revisionId);
    const report = this.normalizeValidationReport(validationReport);
    if (!report.valid) {
      throw new ValidationError("A validated custom dashboard revision requires a valid report.");
    }
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE custom_dashboard_revisions
      SET validation_status = 'passed',
          validation_report_json = ?,
          validated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(this.serializeJson(report), now, now, revision.id);
    this.setDashboardStatus(revision.dashboardId, "validated", now);
    return this.requireRevision(revision.id);
  }

  publishRevision(dashboardId: string, revisionId: string): CustomDashboardRecord {
    const dashboard = this.requireDashboard(dashboardId);
    if (dashboard.status === "archived") {
      throw new ValidationError("Archived custom dashboards cannot be published.");
    }
    const revision = this.requireRevision(revisionId);
    if (revision.dashboardId !== dashboard.id || revision.projectId !== dashboard.projectId) {
      throw new ValidationError("Custom dashboard revision does not belong to the requested dashboard.");
    }
    if (revision.validationStatus !== "passed" || !revision.validatedAt || revision.validationReport?.valid !== true) {
      throw new ValidationError("Only validated custom dashboard revisions can be published.");
    }
    const now = new Date().toISOString();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO custom_dashboard_publications (
          dashboard_id, project_id, revision_id, published_at, runtime_metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ${this.db.dialect.upsert(["dashboard_id"], ["revision_id", "published_at", "runtime_metadata_json", "updated_at"])}
      `).run(
        dashboard.id,
        dashboard.projectId,
        revision.id,
        now,
        this.serializeJson(revision.runtimeMetadata),
        now,
        now,
      );
      this.setDashboardStatus(dashboard.id, "published", now);
    });

    return this.requireDashboard(dashboard.id);
  }

  archiveDashboard(dashboardId: string): CustomDashboardRecord {
    const dashboard = this.requireDashboard(dashboardId);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM custom_dashboard_publications WHERE dashboard_id = ?`).run(dashboard.id);
      this.setDashboardStatus(dashboard.id, "archived", now);
    });
    return this.requireDashboard(dashboard.id);
  }

  deleteDashboard(dashboardId: string): void {
    this.requireDashboard(dashboardId);
    this.db.prepare(`DELETE FROM custom_dashboards WHERE id = ?`).run(dashboardId);
  }

  private applyValidationStatus(
    revision: CustomDashboardRevisionRecord,
    status: CustomDashboardValidationStatus,
    validationReport: CustomDashboardValidationReport | null,
    now: string,
  ): void {
    if (status === "passed" && validationReport?.valid !== true) {
      throw new ValidationError("Passed custom dashboard validation requires a valid report.");
    }
    const validatedAt = status === "passed" ? now : null;
    this.db.prepare(`
      UPDATE custom_dashboard_revisions
      SET validation_status = ?,
          validation_report_json = ?,
          validated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      status,
      this.serializeNullableJson(validationReport),
      validatedAt,
      now,
      revision.id,
    );

    if (status === "passed") {
      this.setDashboardStatus(revision.dashboardId, "validated", now);
      return;
    }
    if (status === "failed" || status === "cancelled") {
      this.setDashboardStatus(revision.dashboardId, "rejected", now);
      return;
    }
    this.setDashboardStatus(revision.dashboardId, "validating", now);
  }

  private getNextRevisionNumber(dashboardId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_revision_number
      FROM custom_dashboard_revisions
      WHERE dashboard_id = ?
    `).get(dashboardId) as { next_revision_number?: number | string } | undefined;
    return toNumber(row?.next_revision_number);
  }

  private requireProject(projectId: string): void {
    const normalized = projectId.trim();
    if (!normalized) {
      throw new ValidationError("projectId is required.");
    }
    requireRecord(this.db.prepare(`SELECT id FROM projects WHERE id = ?`).get(normalized), "Project", normalized);
  }

  private requireDashboard(dashboardId: string): CustomDashboardRecord {
    const dashboard = this.getDashboardById(dashboardId);
    if (!dashboard) {
      throw new EntityNotFoundError(`Custom dashboard not found: ${dashboardId}`);
    }
    return dashboard;
  }

  private requireRevision(revisionId: string): CustomDashboardRevisionRecord {
    const revision = this.getRevisionById(revisionId);
    if (!revision) {
      throw new EntityNotFoundError(`Custom dashboard revision not found: ${revisionId}`);
    }
    return revision;
  }

  private requireValidationSession(sessionId: string): CustomDashboardValidationSessionRecord {
    const session = this.getValidationSessionById(sessionId);
    if (!session) {
      throw new EntityNotFoundError(`Custom dashboard validation session not found: ${sessionId}`);
    }
    return session;
  }

  private setDashboardStatus(dashboardId: string, status: CustomDashboardStatus, updatedAt: string): void {
    this.db.prepare(`
      UPDATE custom_dashboards
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(status, updatedAt, dashboardId);
  }

  private requireTitle(title: string | undefined): string {
    const normalized = title?.trim();
    if (!normalized) {
      throw new ValidationError("Custom dashboard title is required.");
    }
    return normalized;
  }

  private normalizeManifest(input: CustomDashboardManifest): CustomDashboardManifest {
    if (!input || typeof input !== "object") {
      throw new ValidationError("Custom dashboard manifest is required.");
    }
    const schemaVersion = Number(input.schemaVersion);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
      throw new ValidationError("Custom dashboard manifest schemaVersion must be a positive integer.");
    }
    const title = input.title?.trim();
    if (!title) {
      throw new ValidationError("Custom dashboard manifest title is required.");
    }
    const entryFile = input.entryFile?.trim();
    if (!entryFile) {
      throw new ValidationError("Custom dashboard manifest entryFile is required.");
    }
    const filePaths = this.normalizeStringList(input.filePaths, "Custom dashboard manifest filePaths");
    if (!filePaths.includes(entryFile)) {
      throw new ValidationError("Custom dashboard manifest entryFile must be listed in filePaths.");
    }
    return {
      schemaVersion,
      title,
      entryFile,
      filePaths,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.dataSources ? { dataSources: this.normalizeSourceNodeGraph(input.dataSources) } : {}),
      ...(input.metadata ? { metadata: this.normalizeJsonObject(input.metadata) } : {}),
    };
  }

  private normalizeFileBundle(input: CustomDashboardFileBundle): CustomDashboardFileBundle {
    if (!input || typeof input !== "object" || !Array.isArray(input.files) || input.files.length === 0) {
      throw new ValidationError("Custom dashboard fileBundle.files must contain at least one file.");
    }
    const paths = new Set<string>();
    const files = input.files.map((file) => this.normalizeFileEntry(file, paths));
    return {
      files,
      ...(input.metadata ? { metadata: this.normalizeJsonObject(input.metadata) } : {}),
    };
  }

  private normalizeFileEntry(
    input: CustomDashboardFileBundleEntry,
    paths: Set<string>,
  ): CustomDashboardFileBundleEntry {
    const path = input.path?.trim();
    if (!path) {
      throw new ValidationError("Custom dashboard file path is required.");
    }
    if (paths.has(path)) {
      throw new ValidationError(`Custom dashboard file path is duplicated: ${path}`);
    }
    paths.add(path);
    if (typeof input.content !== "string") {
      throw new ValidationError(`Custom dashboard file content must be a string: ${path}`);
    }
    return {
      path,
      content: input.content,
      ...(input.contentType?.trim() ? { contentType: input.contentType.trim() } : {}),
      ...(input.checksum?.trim() ? { checksum: input.checksum.trim() } : {}),
    };
  }

  private normalizeSourceNodeGraph(
    input: CustomDashboardDataSourceNodeGraph | undefined,
  ): CustomDashboardDataSourceNodeGraph {
    if (input === undefined) {
      return { nodes: [], edges: [] };
    }
    if (!input || typeof input !== "object" || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) {
      throw new ValidationError("Custom dashboard sourceNodeGraph requires nodes and edges arrays.");
    }
    const nodeIds = new Set<string>();
    const nodes = input.nodes.map((node) => this.normalizeSourceNode(node, nodeIds));
    const edges = input.edges.map((edge) => this.normalizeSourceEdge(edge, nodeIds));
    return {
      nodes,
      edges,
      ...(input.metadata ? { metadata: this.normalizeJsonObject(input.metadata) } : {}),
    };
  }

  private normalizeSourceNode(
    input: CustomDashboardDataSourceNode,
    nodeIds: Set<string>,
  ): CustomDashboardDataSourceNode {
    const id = input.id?.trim();
    if (!id) {
      throw new ValidationError("Custom dashboard source node id is required.");
    }
    if (nodeIds.has(id)) {
      throw new ValidationError(`Custom dashboard source node id is duplicated: ${id}`);
    }
    nodeIds.add(id);
    const type = input.type?.trim();
    if (!type) {
      throw new ValidationError(`Custom dashboard source node type is required: ${id}`);
    }
    const title = input.title?.trim();
    if (!title) {
      throw new ValidationError(`Custom dashboard source node title is required: ${id}`);
    }
    return {
      id,
      type,
      title,
      ...(input.config ? { config: this.normalizeJsonObject(input.config) } : {}),
    };
  }

  private normalizeSourceEdge(
    input: CustomDashboardDataSourceEdge,
    nodeIds: Set<string>,
  ): CustomDashboardDataSourceEdge {
    const fromNodeId = input.fromNodeId?.trim();
    const toNodeId = input.toNodeId?.trim();
    if (!fromNodeId || !toNodeId) {
      throw new ValidationError("Custom dashboard source edge endpoints are required.");
    }
    if (!nodeIds.has(fromNodeId) || !nodeIds.has(toNodeId)) {
      throw new ValidationError("Custom dashboard source edge endpoints must reference source nodes.");
    }
    return {
      ...(input.id?.trim() ? { id: input.id.trim() } : {}),
      fromNodeId,
      toNodeId,
    };
  }

  private normalizeValidationReport(
    input: CustomDashboardValidationReport,
  ): CustomDashboardValidationReport {
    if (!input || typeof input !== "object" || typeof input.valid !== "boolean" || !Array.isArray(input.issues)) {
      throw new ValidationError("Custom dashboard validation report requires valid and issues fields.");
    }
    return {
      valid: input.valid,
      ...(input.summary?.trim() ? { summary: input.summary.trim() } : {}),
      issues: input.issues.map((issue) => {
        const field = issue.field?.trim();
        const code = issue.code?.trim();
        const message = issue.message?.trim();
        if (!field || !code || !message) {
          throw new ValidationError("Custom dashboard validation report issues require field, code, and message.");
        }
        return { field, code, message };
      }),
      ...(input.metadata ? { metadata: this.normalizeJsonObject(input.metadata) } : {}),
    };
  }

  private normalizeStringList(values: string[], fieldName: string): string[] {
    if (!Array.isArray(values) || values.length === 0) {
      throw new ValidationError(`${fieldName} must contain at least one value.`);
    }
    const normalized = values.map((value) => value.trim()).filter(Boolean);
    if (normalized.length !== values.length) {
      throw new ValidationError(`${fieldName} cannot contain empty values.`);
    }
    return [...new Set(normalized)];
  }

  private normalizeDashboardStatus(status: string): CustomDashboardStatus {
    if (DASHBOARD_STATUSES.includes(status as CustomDashboardStatus)) {
      return status as CustomDashboardStatus;
    }
    throw new ValidationError(`Unsupported custom dashboard status: ${status}`);
  }

  private normalizeValidationStatus(status: string): CustomDashboardValidationStatus {
    if (VALIDATION_STATUSES.includes(status as CustomDashboardValidationStatus)) {
      return status as CustomDashboardValidationStatus;
    }
    throw new ValidationError(`Unsupported custom dashboard validation status: ${status}`);
  }

  private normalizeJsonObject(input: CustomDashboardJsonObject | undefined): CustomDashboardJsonObject {
    if (input === undefined) {
      return {};
    }
    if (!this.isJsonObject(input)) {
      throw new ValidationError("Custom dashboard JSON payloads must be JSON objects.");
    }
    return this.parseJsonObject(this.serializeJson(input));
  }

  private serializeJson(value: unknown): string {
    if (!this.isJsonValue(value)) {
      throw new ValidationError("Custom dashboard JSON payloads must be JSON-safe.");
    }
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new ValidationError("Custom dashboard JSON payload failed to serialize.");
    }
    const parsed = JSON.parse(serialized) as unknown;
    if (!this.isJsonValue(parsed)) {
      throw new ValidationError("Custom dashboard JSON payload failed to round-trip.");
    }
    return serialized;
  }

  private serializeNullableJson(value: unknown | null): string | null {
    return value === null ? null : this.serializeJson(value);
  }

  private parseJsonObject(value: string): CustomDashboardJsonObject {
    const parsed = this.parseJson(value);
    if (!this.isJsonObject(parsed)) {
      throw new ValidationError("Persisted custom dashboard JSON object is invalid.");
    }
    return parsed;
  }

  private parseManifest(value: string): CustomDashboardManifest {
    const parsed = this.parseJson(value);
    return this.normalizeManifest(parsed as CustomDashboardManifest);
  }

  private parseFileBundle(value: string): CustomDashboardFileBundle {
    const parsed = this.parseJson(value);
    return this.normalizeFileBundle(parsed as CustomDashboardFileBundle);
  }

  private parseSourceNodeGraph(value: string): CustomDashboardDataSourceNodeGraph {
    const parsed = this.parseJson(value);
    return this.normalizeSourceNodeGraph(parsed as CustomDashboardDataSourceNodeGraph);
  }

  private parseValidationReport(value: string | null): CustomDashboardValidationReport | null {
    if (!value) {
      return null;
    }
    const parsed = this.parseJson(value);
    return this.normalizeValidationReport(parsed as CustomDashboardValidationReport);
  }

  private parseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new ValidationError("Persisted custom dashboard JSON is invalid.");
    }
  }

  private isJsonValue(value: unknown): value is CustomDashboardJsonValue {
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

  private isJsonObject(value: unknown): value is CustomDashboardJsonObject {
    return Boolean(value)
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.values(value as Record<string, unknown>).every((entry) => this.isJsonValue(entry));
  }

  private mapDashboardRow(row: CustomDashboardRow): CustomDashboardRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? "",
      status: this.normalizeDashboardStatus(row.status),
      manifest: this.parseManifest(row.manifest_json),
      fileBundle: this.parseFileBundle(row.files_json),
      sourceNodeGraph: this.parseSourceNodeGraph(row.source_node_graph_json),
      styleguide: this.parseJsonObject(row.styleguide_json),
      runtimeMetadata: this.parseJsonObject(row.runtime_metadata_json),
      publishedRevisionId: row.published_revision_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRevisionRow(row: CustomDashboardRevisionRow): CustomDashboardRevisionRecord {
    return {
      id: row.id,
      dashboardId: row.dashboard_id,
      projectId: row.project_id,
      revisionNumber: toNumber(row.revision_number),
      manifest: this.parseManifest(row.manifest_json),
      fileBundle: this.parseFileBundle(row.files_json),
      sourceNodeGraph: this.parseSourceNodeGraph(row.source_node_graph_json),
      styleguide: this.parseJsonObject(row.styleguide_json),
      validationStatus: row.validation_status ? this.normalizeValidationStatus(row.validation_status) : null,
      validationReport: this.parseValidationReport(row.validation_report_json),
      runtimeMetadata: this.parseJsonObject(row.runtime_metadata_json),
      validatedAt: row.validated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapValidationSessionRow(
    row: CustomDashboardValidationSessionRow,
  ): CustomDashboardValidationSessionRecord {
    return {
      id: row.id,
      dashboardId: row.dashboard_id,
      revisionId: row.revision_id,
      projectId: row.project_id,
      status: this.normalizeValidationStatus(row.status),
      validationReport: this.parseValidationReport(row.validation_report_json),
      runtimeMetadata: this.parseJsonObject(row.runtime_metadata_json),
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
