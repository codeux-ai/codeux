import { randomUUID } from "crypto";
import type {
  CreateCustomDashboardDraftInput,
  CreateCustomDashboardRevisionInput,
  CreateCustomDashboardValidationSessionInput,
  CustomDashboardCredentialBinding,
  CustomDashboardCredentialSlot,
  CustomDashboardDataSourceEdge,
  CustomDashboardDataSourceNode,
  CustomDashboardDataSourceNodeGraph,
  CustomDashboardFileBundle,
  CustomDashboardFileBundleEntry,
  CustomDashboardJsonObject,
  CustomDashboardJsonValue,
  CustomDashboardManifest,
  CustomDashboardRecord,
  CustomDashboardRouteDefinition,
  CustomDashboardRuntimeState,
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
  credential_bindings_json: string;
  routes_json: string;
  styleguide_json: string;
  runtime_metadata_json: string;
  runtime_status: string;
  runtime_halt_reason: string | null;
  runtime_halted_revision_id: string | null;
  runtime_halted_at: string | null;
  runtime_resumed_at: string | null;
  runtime_state_updated_at: string | null;
  runtime_recovery_metadata_json: string;
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
  credential_bindings_json: string;
  routes_json: string;
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

const MAX_CREDENTIAL_SLOTS = 32;
const MAX_CREDENTIAL_BINDINGS = 32;
const MAX_ROUTES = 32;
const MAX_IDENTIFIER_LENGTH = 64;
const MAX_LABEL_LENGTH = 128;
const MAX_ROUTE_PATH_LENGTH = 256;
const MAX_RUNTIME_HALT_REASON_LENGTH = 320;
const DASHBOARD_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ROUTE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const RESERVED_ROUTE_PREFIXES = [
  "/api",
  "/assets",
  "/custom-dashboards",
  "/health",
  "/mcp",
  "/projects",
  "/ready",
  "/settings",
  "/sprints",
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
    const credentialBindings = this.normalizeCredentialBindings(projectId, id, sourceNodeGraph, input.credentialBindings);
    const routes = this.normalizeRoutes(input.routes, manifest);
    const styleguide = this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = this.normalizeJsonObject(input.runtimeMetadata);

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO custom_dashboards (
          id, project_id, title, description, status, manifest_json, files_json,
          source_node_graph_json, credential_bindings_json, routes_json, styleguide_json,
          runtime_metadata_json, runtime_status, runtime_state_updated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `).run(
        id,
        projectId,
        title,
        description,
        this.serializeJson(manifest),
        this.serializeJson(fileBundle),
        this.serializeJson(sourceNodeGraph),
        this.serializeJson(credentialBindings),
        this.serializeJson(routes),
        this.serializeJson(styleguide),
        this.serializeJson(runtimeMetadata),
        now,
        now,
        now,
      );
      this.syncCredentialBindings(projectId, id, credentialBindings, now);
    });

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
    const credentialBindings = input.credentialBindings === undefined && input.sourceNodeGraph === undefined
      ? current.credentialBindings
      : this.normalizeCredentialBindings(
          current.projectId,
          current.id,
          sourceNodeGraph,
          input.credentialBindings ?? current.credentialBindings,
        );
    const routes = input.routes === undefined && input.manifest === undefined
      ? current.routes
      : this.normalizeRoutes(input.routes ?? current.routes, manifest);
    const styleguide = input.styleguide === undefined ? current.styleguide : this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = input.runtimeMetadata === undefined
      ? current.runtimeMetadata
      : this.normalizeJsonObject(input.runtimeMetadata);

    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE custom_dashboards
      SET title = ?,
          description = ?,
          manifest_json = ?,
          files_json = ?,
          source_node_graph_json = ?,
          credential_bindings_json = ?,
          routes_json = ?,
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
        this.serializeJson(credentialBindings),
        this.serializeJson(routes),
        this.serializeJson(styleguide),
        this.serializeJson(runtimeMetadata),
        now,
        dashboardId,
      );
      this.syncCredentialBindings(current.projectId, current.id, credentialBindings, now);
    });

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
    const credentialBindings = input.credentialBindings === undefined && input.sourceNodeGraph === undefined
      ? dashboard.credentialBindings
      : this.normalizeCredentialBindings(
          dashboard.projectId,
          dashboard.id,
          sourceNodeGraph,
          input.credentialBindings ?? dashboard.credentialBindings,
        );
    const routes = input.routes === undefined && input.manifest === undefined
      ? dashboard.routes
      : this.normalizeRoutes(input.routes ?? dashboard.routes, manifest);
    const styleguide = input.styleguide === undefined ? dashboard.styleguide : this.normalizeJsonObject(input.styleguide);
    const runtimeMetadata = input.runtimeMetadata === undefined
      ? dashboard.runtimeMetadata
      : this.normalizeJsonObject(input.runtimeMetadata);

    this.db.prepare(`
      INSERT INTO custom_dashboard_revisions (
        id, dashboard_id, project_id, revision_number, manifest_json, files_json,
        source_node_graph_json, credential_bindings_json, routes_json, styleguide_json,
        validation_status, validation_report_json,
        runtime_metadata_json, validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)
    `).run(
      id,
      dashboard.id,
      dashboard.projectId,
      revisionNumber,
      this.serializeJson(manifest),
      this.serializeJson(fileBundle),
      this.serializeJson(sourceNodeGraph),
      this.serializeJson(credentialBindings),
      this.serializeJson(routes),
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
      this.applyValidationStatus(revision, status, validationReport, now, runtimeMetadata);
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
      this.applyValidationStatus(revision, status, validationReport, now, runtimeMetadata);
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

  deleteValidationSession(sessionId: string): void {
    this.requireValidationSession(sessionId);
    this.db.prepare(`DELETE FROM custom_dashboard_validation_sessions WHERE id = ?`).run(sessionId);
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
    const publishedRevisionId = this.getPublishedRevisionId(revision.dashboardId);
    if (publishedRevisionId === revision.id) {
      this.setDashboardStatus(revision.dashboardId, "published", now);
      return this.requireRevision(revision.id);
    }
    this.db.prepare(`
      UPDATE custom_dashboard_revisions
      SET validation_status = 'passed',
          validation_report_json = ?,
          validated_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(this.serializeJson(report), now, now, revision.id);
    this.setDashboardStatus(revision.dashboardId, publishedRevisionId ? "published" : "validated", now);
    return this.requireRevision(revision.id);
  }

  publishRevision(
    dashboardId: string,
    revisionId: string,
    validationSessionId?: string,
    expectedPublishedRevisionId?: string | null,
  ): CustomDashboardRecord {
    const dashboard = this.requireDashboard(dashboardId);
    if (dashboard.status === "archived") {
      throw new ValidationError("Archived custom dashboards cannot be published.");
    }
    if (expectedPublishedRevisionId !== undefined && dashboard.publishedRevisionId !== expectedPublishedRevisionId) {
      throw new ValidationError("The custom dashboard publication changed before this transition completed.");
    }
    if (dashboard.runtimeState.status === "halted" && expectedPublishedRevisionId === undefined) {
      throw new ValidationError("A halted custom dashboard requires the current published revision for an explicit publish or rollback.");
    }
    const revision = this.requireRevision(revisionId);
    if (revision.dashboardId !== dashboard.id || revision.projectId !== dashboard.projectId) {
      throw new ValidationError("Custom dashboard revision does not belong to the requested dashboard.");
    }
    if (validationSessionId !== undefined) {
      const normalizedSessionId = validationSessionId.trim();
      if (!normalizedSessionId) {
        throw new ValidationError("Custom dashboard validation session id is required.");
      }
      const session = this.getValidationSessionById(normalizedSessionId);
      if (!session) {
        throw new ValidationError(`Custom dashboard validation session not found: ${normalizedSessionId}`);
      }
      if (
        session.dashboardId !== dashboard.id
        || session.revisionId !== revision.id
        || session.projectId !== dashboard.projectId
      ) {
        throw new ValidationError("Custom dashboard validation session does not belong to the requested revision.");
      }
      if (session.status !== "passed" || session.validationReport?.valid !== true) {
        throw new ValidationError(`Only passed custom dashboard validation sessions can be published. Current validation status: ${session.status}.`);
      }
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
      this.db.prepare(`
        UPDATE custom_dashboards
        SET runtime_status = 'active',
            runtime_halt_reason = NULL,
            runtime_halted_revision_id = NULL,
            runtime_halted_at = NULL,
            runtime_resumed_at = CASE WHEN runtime_status = 'halted' THEN ? ELSE runtime_resumed_at END,
            runtime_state_updated_at = ?,
            runtime_recovery_metadata_json = CASE WHEN runtime_status = 'halted' THEN '{}' ELSE runtime_recovery_metadata_json END
        WHERE id = ?
      `).run(now, now, dashboard.id);
    });

    return this.requireDashboard(dashboard.id);
  }

  haltRuntime(
    dashboardId: string,
    revisionId: string,
    reason: unknown,
    recoveryMetadata?: CustomDashboardJsonObject,
  ): CustomDashboardRecord {
    const normalizedReason = this.normalizeRuntimeHaltReason(reason);
    const normalizedRevisionId = revisionId.trim();
    if (!normalizedRevisionId) {
      throw new ValidationError("Custom dashboard halted revision id is required.");
    }
    const metadata = this.normalizeJsonObject(recoveryMetadata);
    const now = new Date().toISOString();

    this.db.transaction(() => {
      const dashboard = this.requireDashboard(dashboardId);
      if (dashboard.status === "archived") {
        throw new ValidationError("Archived custom dashboards cannot be halted.");
      }
      if (dashboard.publishedRevisionId !== normalizedRevisionId) {
        throw new ValidationError("The runtime halt report does not match the current published revision.");
      }
      if (dashboard.runtimeState.status === "halted") {
        if (dashboard.runtimeState.haltedRevisionId !== normalizedRevisionId) {
          throw new ValidationError("The custom dashboard is already halted for another revision.");
        }
        return;
      }
      this.db.prepare(`
        UPDATE custom_dashboards
        SET runtime_status = 'halted',
            runtime_halt_reason = ?,
            runtime_halted_revision_id = ?,
            runtime_halted_at = ?,
            runtime_state_updated_at = ?,
            runtime_recovery_metadata_json = ?,
            updated_at = ?
        WHERE id = ?
          AND runtime_status = 'active'
      `).run(
        normalizedReason,
        normalizedRevisionId,
        now,
        now,
        this.serializeJson(metadata),
        now,
        dashboard.id,
      );
    });

    return this.requireDashboard(dashboardId);
  }

  resumeRuntime(
    dashboardId: string,
    revisionId: string,
    validationSessionId?: string,
    recoveryMetadata?: CustomDashboardJsonObject,
  ): CustomDashboardRecord {
    const now = new Date().toISOString();
    const metadata = this.normalizeJsonObject(recoveryMetadata);
    this.db.transaction(() => {
      const dashboard = this.requireDashboard(dashboardId);
      const revision = this.requirePublishableRevision(dashboard, revisionId, validationSessionId);
      if (dashboard.publishedRevisionId !== revision.id) {
        throw new ValidationError("The runtime resume revision does not match the current published revision.");
      }
      if (dashboard.runtimeState.status === "active") return;
      if (dashboard.runtimeState.haltedRevisionId !== revision.id) {
        throw new ValidationError("The custom dashboard halt does not belong to the requested revision.");
      }
      this.db.prepare(`
        UPDATE custom_dashboards
        SET runtime_status = 'active',
            runtime_halt_reason = NULL,
            runtime_halted_revision_id = NULL,
            runtime_halted_at = NULL,
            runtime_resumed_at = ?,
            runtime_state_updated_at = ?,
            runtime_recovery_metadata_json = ?,
            updated_at = ?
        WHERE id = ?
          AND runtime_status = 'halted'
          AND runtime_halted_revision_id = ?
      `).run(now, now, this.serializeJson(metadata), now, dashboard.id, revision.id);
    });
    return this.requireDashboard(dashboardId);
  }

  reconcileRuntimeStatesOnStartup(): string[] {
    const halted = this.db.prepare(`
      SELECT id
      FROM custom_dashboards
      WHERE runtime_status = 'halted'
    `).all() as unknown as Array<{ id: string }>;
    const now = new Date().toISOString();
    for (const { id } of halted) {
      const dashboard = this.requireDashboard(id);
      const previous = dashboard.runtimeState.recoveryMetadata;
      const count = typeof previous.startupRecoveryCount === "number"
        ? previous.startupRecoveryCount + 1
        : 1;
      this.db.prepare(`
        UPDATE custom_dashboards
        SET runtime_recovery_metadata_json = ?, runtime_state_updated_at = ?
        WHERE id = ? AND runtime_status = 'halted'
      `).run(this.serializeJson({ ...previous, lastStartupRecoveryAt: now, startupRecoveryCount: count }), now, id);
    }
    return halted.map(({ id }) => id);
  }

  listActiveValidationSessions(): CustomDashboardValidationSessionRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM custom_dashboard_validation_sessions
      WHERE status IN ('queued', 'building', 'running')
      ORDER BY created_at ASC
    `).all() as unknown as CustomDashboardValidationSessionRow[];
    return rows.map((row) => this.mapValidationSessionRow(row));
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
    runtimeMetadataPatch?: CustomDashboardJsonObject,
  ): void {
    if (status === "passed" && validationReport?.valid !== true) {
      throw new ValidationError("Passed custom dashboard validation requires a valid report.");
    }
    const publishedRevisionId = this.getPublishedRevisionId(revision.dashboardId);
    if (publishedRevisionId === revision.id) {
      this.setDashboardStatus(revision.dashboardId, "published", now);
      return;
    }
    const validatedAt = status === "passed" ? now : null;
    const nextRuntimeMetadata = status === "passed" && runtimeMetadataPatch
      ? this.normalizeJsonObject({ ...revision.runtimeMetadata, ...runtimeMetadataPatch })
      : null;
    if (nextRuntimeMetadata) {
      this.db.prepare(`
        UPDATE custom_dashboard_revisions
        SET validation_status = ?,
            validation_report_json = ?,
            validated_at = ?,
            runtime_metadata_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        status,
        this.serializeNullableJson(validationReport),
        validatedAt,
        this.serializeJson(nextRuntimeMetadata),
        now,
        revision.id,
      );
    } else {
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
    }

    if (publishedRevisionId) {
      this.setDashboardStatus(revision.dashboardId, "published", now);
      return;
    }
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

  private requirePublishableRevision(
    dashboard: CustomDashboardRecord,
    revisionId: string,
    validationSessionId?: string,
  ): CustomDashboardRevisionRecord {
    const revision = this.requireRevision(revisionId);
    if (revision.dashboardId !== dashboard.id || revision.projectId !== dashboard.projectId) {
      throw new ValidationError("Custom dashboard revision does not belong to the requested dashboard.");
    }
    if (revision.validationStatus !== "passed" || !revision.validatedAt || revision.validationReport?.valid !== true) {
      throw new ValidationError("Only validated custom dashboard revisions can activate a runtime.");
    }
    if (validationSessionId !== undefined) {
      const session = this.requireValidationSession(validationSessionId.trim());
      if (session.dashboardId !== dashboard.id || session.revisionId !== revision.id || session.projectId !== dashboard.projectId) {
        throw new ValidationError("Custom dashboard validation session does not belong to the requested revision.");
      }
      if (session.status !== "passed" || session.validationReport?.valid !== true) {
        throw new ValidationError(`Only passed custom dashboard validation sessions can activate a runtime. Current validation status: ${session.status}.`);
      }
    }
    return revision;
  }

  private normalizeRuntimeHaltReason(reason: unknown): string {
    if (typeof reason !== "string") {
      throw new ValidationError("Custom dashboard runtime halt reason must be a string.");
    }
    const normalized = reason
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\b(Bearer)\s+[^\s]+/gi, "$1 [REDACTED]")
      .replace(/\b(api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]")
      .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[REDACTED]")
      .replace(/\s+/g, " ")
      .trim();
    if (!normalized) {
      throw new ValidationError("Custom dashboard runtime halt reason is required.");
    }
    return normalized.slice(0, MAX_RUNTIME_HALT_REASON_LENGTH);
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

  private getPublishedRevisionId(dashboardId: string): string | null {
    const row = this.db.prepare(`
      SELECT revision_id
      FROM custom_dashboard_publications
      WHERE dashboard_id = ?
    `).get(dashboardId) as { revision_id: string } | undefined;
    return row?.revision_id ?? null;
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
    const slotIds = new Set<string>();
    const nodes = input.nodes.map((node) => this.normalizeSourceNode(node, nodeIds, slotIds));
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
    slotIds: Set<string>,
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
      ...(input.credentialSlots !== undefined
        ? { credentialSlots: this.normalizeCredentialSlots(input.credentialSlots, slotIds) }
        : {}),
    };
  }

  private normalizeCredentialSlots(
    input: CustomDashboardCredentialSlot[],
    slotIds: Set<string>,
  ): CustomDashboardCredentialSlot[] {
    if (!Array.isArray(input)) {
      throw new ValidationError("Custom dashboard credentialSlots must be an array.");
    }
    if (slotIds.size + input.length > MAX_CREDENTIAL_SLOTS) {
      throw new ValidationError(`Custom dashboards cannot declare more than ${MAX_CREDENTIAL_SLOTS} credential slots.`);
    }
    return input.map((slot) => {
      const normalizedSlot = this.normalizeIdentifier(slot?.slot, "credential slot");
      if (slotIds.has(normalizedSlot)) {
        throw new ValidationError(`Custom dashboard credential slot is duplicated: ${normalizedSlot}`);
      }
      slotIds.add(normalizedSlot);
      const label = this.normalizeBoundedString(slot?.label, "credential slot label", MAX_LABEL_LENGTH);
      const requiredCapability = this.normalizeBoundedString(
        slot?.requiredCapability,
        "credential slot requiredCapability",
        128,
      );
      if (!Array.isArray(slot?.allowedKinds) || slot.allowedKinds.length === 0 || slot.allowedKinds.length > 32) {
        throw new ValidationError("Custom dashboard credential slot allowedKinds must contain between 1 and 32 entries.");
      }
      const allowedKinds = slot.allowedKinds.map((kind) =>
        this.normalizeBoundedString(kind, "credential slot allowedKinds entry", 128)
      );
      return {
        slot: normalizedSlot,
        label,
        required: slot.required === true,
        allowedKinds: [...new Set(allowedKinds)],
        requiredCapability,
        ...(slot.metadata ? { metadata: this.normalizeBoundedMetadata(slot.metadata, "credential slot metadata") } : {}),
      };
    });
  }

  private normalizeCredentialBindings(
    projectId: string,
    dashboardId: string,
    graph: CustomDashboardDataSourceNodeGraph,
    input: Array<Pick<CustomDashboardCredentialBinding, "slot" | "credentialId">> | undefined,
  ): CustomDashboardCredentialBinding[] {
    if (input === undefined) {
      input = [];
    }
    if (!Array.isArray(input) || input.length > MAX_CREDENTIAL_BINDINGS) {
      throw new ValidationError(`Custom dashboard credentialBindings must contain at most ${MAX_CREDENTIAL_BINDINGS} entries.`);
    }
    const slots = new Map(
      graph.nodes.flatMap((node) => node.credentialSlots ?? []).map((slot) => [slot.slot, slot]),
    );
    const boundSlots = new Set<string>();
    const bindings = input.map((binding) => {
      if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
        throw new ValidationError("Custom dashboard credential bindings must be objects.");
      }
      if (["value", "secret", "token", "password", "apiKey"].some((field) => field in binding)) {
        throw new ValidationError("Custom dashboard credential bindings cannot contain secret values.");
      }
      const slotId = this.normalizeIdentifier(binding?.slot, "credential binding slot");
      if (boundSlots.has(slotId)) {
        throw new ValidationError(`Custom dashboard credential binding is duplicated: ${slotId}`);
      }
      boundSlots.add(slotId);
      const slot = slots.get(slotId);
      if (!slot) {
        throw new ValidationError(`Custom dashboard credential binding references an undeclared slot: ${slotId}`);
      }
      const credentialId = this.normalizeBoundedString(binding?.credentialId, "credentialId", 256);
      const credential = this.requireAccessibleCredential(projectId, credentialId, slot);
      const bindingKey = `custom-dashboard:${dashboardId}:${slotId}`;
      return {
        slot: slotId,
        credentialId: credential.id,
        capability: slot.requiredCapability,
        bindingKey,
        credential,
      };
    });
    for (const slot of slots.values()) {
      if (slot.required && !boundSlots.has(slot.slot)) {
        throw new ValidationError(`Custom dashboard required credential slot is not bound: ${slot.slot}`);
      }
    }
    return bindings;
  }

  private syncCredentialBindings(
    projectId: string,
    dashboardId: string,
    bindings: CustomDashboardCredentialBinding[],
    now: string,
  ): void {
    const prefix = `custom-dashboard:${dashboardId}:`;
    this.db.prepare(`
      DELETE FROM automation_credential_bindings
      WHERE project_id = ? AND substr(binding_key, 1, ?) = ?
    `).run(projectId, prefix.length, prefix);
    const statement = this.db.prepare(`
      INSERT INTO automation_credential_bindings (
        id, credential_id, project_id, binding_key, required_capabilities_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const binding of bindings) {
      statement.run(
        randomUUID(),
        binding.credentialId,
        projectId,
        binding.bindingKey,
        this.serializeJson([binding.capability]),
        now,
        now,
      );
    }
  }

  private requireAccessibleCredential(
    projectId: string,
    credentialId: string,
    slot: CustomDashboardCredentialSlot,
  ): CustomDashboardCredentialBinding["credential"] {
    const row = this.db.prepare(`
      SELECT
        c.id, c.name, c.kind, c.scope, c.capabilities_json, c.status,
        EXISTS(SELECT 1 FROM automation_credential_secrets s WHERE s.credential_id = c.id) AS configured
      FROM automation_credentials c
      WHERE c.id = ?
        AND (c.project_id = ? OR (
          c.scope = 'global'
          AND EXISTS (SELECT 1 FROM json_each(c.allowed_project_ids_json) WHERE value = ?)
        ))
    `).get(credentialId, projectId, projectId) as {
      id: string;
      name: string;
      kind: string;
      scope: "project" | "global";
      capabilities_json: string;
      status: "active" | "revoked" | "unavailable";
      configured: number | bigint;
    } | undefined;
    if (!row) {
      throw new ValidationError("Custom dashboard credential is not accessible to this project.");
    }
    const capabilities = this.parseJson(row.capabilities_json);
    if (!Array.isArray(capabilities) || !capabilities.every((value) => typeof value === "string")) {
      throw new ValidationError("Stored credential capabilities are invalid.");
    }
    if (row.status !== "active" || Number(row.configured) !== 1) {
      throw new ValidationError("Custom dashboard bindings require an active configured credential.");
    }
    if (!capabilities.includes(slot.requiredCapability)) {
      throw new ValidationError(`Custom dashboard credential does not grant capability: ${slot.requiredCapability}`);
    }
    if (!slot.allowedKinds.includes(row.kind)) {
      throw new ValidationError(`Custom dashboard credential kind is not allowed for slot: ${slot.slot}`);
    }
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      scope: row.scope,
      capabilities,
      status: row.status,
      configured: true,
    };
  }

  private normalizeRoutes(
    input: CustomDashboardRouteDefinition[] | undefined,
    manifest: CustomDashboardManifest,
  ): CustomDashboardRouteDefinition[] {
    if (input === undefined) {
      return [];
    }
    if (!Array.isArray(input) || input.length > MAX_ROUTES) {
      throw new ValidationError(`Custom dashboard routes must contain at most ${MAX_ROUTES} entries.`);
    }
    const paths = new Set<string>();
    return input.map((route) => {
      const path = this.normalizeRoutePath(route?.path);
      if (paths.has(path)) {
        throw new ValidationError(`Custom dashboard route path is duplicated: ${path}`);
      }
      paths.add(path);
      const label = this.normalizeBoundedString(route?.label, "route label", MAX_LABEL_LENGTH);
      const entryFile = this.normalizeBoundedString(route?.entryFile, "route entryFile", 256).replace(/^\.\//, "");
      if (entryFile.startsWith("/")
        || entryFile.includes("\\")
        || entryFile.split("/").includes("..")
        || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(entryFile)) {
        throw new ValidationError("Custom dashboard route entryFile must be a bundle-relative file path.");
      }
      if (!manifest.filePaths.includes(entryFile)) {
        throw new ValidationError(`Custom dashboard route entryFile must be listed in manifest.filePaths: ${entryFile}`);
      }
      return {
        path,
        label,
        entryFile,
        ...(route.metadata
          ? { metadata: this.normalizeRouteMetadata(route.metadata) }
          : {}),
      };
    });
  }

  private normalizeRoutePath(value: string | undefined): string {
    const raw = this.normalizeBoundedString(value, "route path", MAX_ROUTE_PATH_LENGTH);
    if (raw.startsWith("//")
      || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
      || raw.includes("\\")
      || raw.includes("?")
      || raw.includes("#")) {
      throw new ValidationError("Custom dashboard route path must be a local URL path without a scheme, query, or fragment.");
    }
    const path = `/${raw.split("/").filter(Boolean).join("/")}`;
    if (path !== "/" && !path.split("/").slice(1).every((segment) => ROUTE_SEGMENT.test(segment))) {
      throw new ValidationError("Custom dashboard route path contains an unsafe segment.");
    }
    const lowerPath = path.toLowerCase();
    if (RESERVED_ROUTE_PREFIXES.some((prefix) => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`))) {
      throw new ValidationError(`Custom dashboard route path uses a reserved host route: ${path}`);
    }
    return path;
  }

  private normalizeIdentifier(value: string | undefined, field: string): string {
    const normalized = this.normalizeBoundedString(value, field, MAX_IDENTIFIER_LENGTH);
    if (!DASHBOARD_IDENTIFIER.test(normalized)) {
      throw new ValidationError(`Custom dashboard ${field} must use letters, numbers, underscores, and hyphens.`);
    }
    return normalized;
  }

  private normalizeBoundedString(value: string | undefined, field: string, maxLength: number): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new ValidationError(`Custom dashboard ${field} is required.`);
    }
    if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
      throw new ValidationError(`Custom dashboard ${field} is invalid or exceeds ${maxLength} characters.`);
    }
    return normalized;
  }

  private normalizeBoundedMetadata(value: CustomDashboardJsonObject, field: string): CustomDashboardJsonObject {
    const normalized = this.normalizeJsonObject(value);
    if (Buffer.byteLength(this.serializeJson(normalized), "utf8") > 8 * 1024) {
      throw new ValidationError(`Custom dashboard ${field} must be at most 8192 UTF-8 bytes.`);
    }
    return normalized;
  }

  private normalizeRouteMetadata(value: CustomDashboardJsonObject): CustomDashboardJsonObject {
    const normalized = this.normalizeBoundedMetadata(value, "route metadata");
    const visit = (entry: CustomDashboardJsonValue): void => {
      if (typeof entry === "string") {
        const candidate = entry.trim();
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)
          || candidate.startsWith("/")
          || candidate.startsWith("../")
          || /^[a-zA-Z]:\\/.test(candidate)) {
          throw new ValidationError("Custom dashboard route metadata cannot contain URLs or filesystem paths.");
        }
        return;
      }
      if (Array.isArray(entry)) {
        entry.forEach(visit);
        return;
      }
      if (entry && typeof entry === "object") {
        Object.values(entry).forEach(visit);
      }
    };
    visit(normalized);
    return normalized;
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

  private parseCredentialBindings(value: string | undefined): CustomDashboardCredentialBinding[] {
    const parsed = this.parseJson(value ?? "[]");
    if (!Array.isArray(parsed)) {
      throw new ValidationError("Persisted custom dashboard credential bindings are invalid.");
    }
    return parsed as CustomDashboardCredentialBinding[];
  }

  private parseRoutes(
    value: string | undefined,
    manifest: CustomDashboardManifest,
  ): CustomDashboardRouteDefinition[] {
    const parsed = this.parseJson(value ?? "[]");
    return this.normalizeRoutes(parsed as CustomDashboardRouteDefinition[], manifest);
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
    const manifest = this.parseManifest(row.manifest_json);
    return {
      id: row.id,
      projectId: row.project_id,
      title: row.title,
      description: row.description ?? "",
      status: this.normalizeDashboardStatus(row.status),
      manifest,
      fileBundle: this.parseFileBundle(row.files_json),
      sourceNodeGraph: this.parseSourceNodeGraph(row.source_node_graph_json),
      credentialBindings: this.parseCredentialBindings(row.credential_bindings_json),
      routes: this.parseRoutes(row.routes_json, manifest),
      styleguide: this.parseJsonObject(row.styleguide_json),
      runtimeMetadata: this.parseJsonObject(row.runtime_metadata_json),
      runtimeState: this.mapRuntimeState(row),
      publishedRevisionId: row.published_revision_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapRuntimeState(row: CustomDashboardRow): CustomDashboardRuntimeState {
    const status = row.runtime_status === "halted" ? "halted" : "active";
    return {
      status,
      haltedReason: status === "halted" ? row.runtime_halt_reason : null,
      haltedRevisionId: status === "halted" ? row.runtime_halted_revision_id : null,
      haltedAt: status === "halted" ? row.runtime_halted_at : null,
      resumedAt: row.runtime_resumed_at,
      updatedAt: row.runtime_state_updated_at ?? row.updated_at,
      recoveryMetadata: this.parseJsonObject(row.runtime_recovery_metadata_json),
    };
  }

  private mapRevisionRow(row: CustomDashboardRevisionRow): CustomDashboardRevisionRecord {
    const manifest = this.parseManifest(row.manifest_json);
    return {
      id: row.id,
      dashboardId: row.dashboard_id,
      projectId: row.project_id,
      revisionNumber: toNumber(row.revision_number),
      manifest,
      fileBundle: this.parseFileBundle(row.files_json),
      sourceNodeGraph: this.parseSourceNodeGraph(row.source_node_graph_json),
      credentialBindings: this.parseCredentialBindings(row.credential_bindings_json),
      routes: this.parseRoutes(row.routes_json, manifest),
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
