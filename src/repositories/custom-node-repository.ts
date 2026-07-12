import { randomUUID } from "node:crypto";
import type {
  CreateCustomNodeDraftInput,
  CustomNodeArtifact,
  CustomNodeLifecycleStatus,
  CustomNodeManifest,
  CustomNodePublication,
  CustomNodeRecord,
  CustomNodeValidationReport,
} from "../contracts/custom-node-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, ValidationError } from "./repository-utils.js";

interface CustomNodeRow {
  id: string;
  project_id: string;
  status: string;
  source_revision: string;
  manifest_json: string;
  validation_report_json: string | null;
  artifact_digest: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface CustomNodeArtifactRow { artifact_json: string }
interface CustomNodePublicationRow {
  id: string; node_id: string; project_id: string; node_type: string; version: number | string;
  artifact_digest: string; published_by: string; published_at: string;
}

const LIFECYCLE_STATUSES: readonly CustomNodeLifecycleStatus[] = ["draft", "validating", "passed", "failed", "published"];

export class CustomNodeRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  createDraft(projectId: string, input: CreateCustomNodeDraftInput): CustomNodeRecord {
    this.requireProject(projectId);
    if (!input.sourceRevision.trim()) throw new ValidationError("Custom node source revision is required.");
    if (!input.createdBy.trim()) throw new ValidationError("Custom node creator is required.");
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO custom_nodes (
        id, project_id, status, source_revision, manifest_json, validation_report_json,
        artifact_digest, created_by, created_at, updated_at
      ) VALUES (?, ?, 'draft', ?, ?, NULL, NULL, ?, ?, ?)
    `).run(input.manifest.id, projectId, input.sourceRevision.trim(), JSON.stringify(input.manifest), input.createdBy.trim(), now, now);
    return this.requireNode(input.manifest.id);
  }

  getNode(nodeId: string): CustomNodeRecord | null {
    const row = this.db.prepare("SELECT * FROM custom_nodes WHERE id = ?").get(nodeId) as CustomNodeRow | undefined;
    return row ? this.mapNode(row) : null;
  }

  listProjectNodes(projectId: string): CustomNodeRecord[] {
    this.requireProject(projectId);
    return (this.db.prepare("SELECT * FROM custom_nodes WHERE project_id = ? ORDER BY updated_at DESC").all(projectId) as unknown as CustomNodeRow[])
      .map((row) => this.mapNode(row));
  }

  beginValidation(nodeId: string): CustomNodeRecord {
    const node = this.requireNode(nodeId);
    if (node.status === "published") throw new ValidationError("Published custom node revisions are immutable.");
    this.updateLifecycle(nodeId, "validating", null, null);
    return this.requireNode(nodeId);
  }

  completeValidation(nodeId: string, report: CustomNodeValidationReport, artifact: CustomNodeArtifact | null): CustomNodeRecord {
    const node = this.requireNode(nodeId);
    if (node.status !== "validating") throw new ValidationError("Custom node must be validating before validation can complete.");
    if (report.valid !== Boolean(artifact)) throw new ValidationError("Passed validation requires an artifact and failed validation must not publish one.");
    if (artifact && (artifact.nodeId !== node.id || artifact.projectId !== node.projectId || artifact.sourceRevision !== node.sourceRevision)) {
      throw new ValidationError("Custom node artifact does not match the validated draft.");
    }
    this.db.transaction(() => {
      if (artifact) this.insertArtifact(artifact);
      this.updateLifecycle(nodeId, report.valid ? "passed" : "failed", report, artifact?.digest ?? null);
    });
    return this.requireNode(nodeId);
  }

  publish(nodeId: string, publishedBy: string): CustomNodePublication {
    const node = this.requireNode(nodeId);
    if (node.status !== "passed" || !node.artifactDigest || node.validationReport?.valid !== true) {
      throw new ValidationError("Only a passed custom node artifact can be published.");
    }
    if (!publishedBy.trim()) throw new ValidationError("Custom node publisher is required.");
    const artifact = this.getArtifact(node.artifactDigest);
    if (!artifact) throw new EntityNotFoundError(`Custom node artifact not found: ${node.artifactDigest}`);
    const now = new Date().toISOString();
    const publication: CustomNodePublication = {
      id: randomUUID(), nodeId: node.id, projectId: node.projectId, nodeType: node.manifest.nodeType,
      version: node.manifest.version, artifactDigest: artifact.digest, publishedBy: publishedBy.trim(), publishedAt: now,
    };
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO custom_node_publications (
          id, node_id, project_id, node_type, version, artifact_digest, published_by, published_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(publication.id, publication.nodeId, publication.projectId, publication.nodeType, publication.version,
        publication.artifactDigest, publication.publishedBy, publication.publishedAt);
      this.updateLifecycle(node.id, "published", node.validationReport, node.artifactDigest);
    });
    return publication;
  }

  getArtifact(digest: string): CustomNodeArtifact | null {
    const row = this.db.prepare("SELECT artifact_json FROM custom_node_artifacts WHERE digest = ?").get(digest) as CustomNodeArtifactRow | undefined;
    return row ? JSON.parse(row.artifact_json) as CustomNodeArtifact : null;
  }

  resolvePublished(nodeType: string, version: number): { publication: CustomNodePublication; artifact: CustomNodeArtifact } | null {
    const row = this.db.prepare("SELECT * FROM custom_node_publications WHERE node_type = ? AND version = ?")
      .get(nodeType, version) as CustomNodePublicationRow | undefined;
    if (!row) return null;
    const publication = this.mapPublication(row);
    const artifact = this.getArtifact(publication.artifactDigest);
    return artifact ? { publication, artifact } : null;
  }

  listPublications(): Array<{ publication: CustomNodePublication; artifact: CustomNodeArtifact }> {
    const rows = this.db.prepare("SELECT * FROM custom_node_publications ORDER BY published_at ASC").all() as unknown as CustomNodePublicationRow[];
    return rows.flatMap((row) => {
      const publication = this.mapPublication(row);
      const artifact = this.getArtifact(publication.artifactDigest);
      return artifact ? [{ publication, artifact }] : [];
    });
  }

  private insertArtifact(artifact: CustomNodeArtifact): void {
    const serialized = JSON.stringify(artifact);
    const existing = this.db.prepare("SELECT artifact_json FROM custom_node_artifacts WHERE digest = ?").get(artifact.digest) as CustomNodeArtifactRow | undefined;
    if (existing) {
      if (existing.artifact_json !== serialized) throw new ValidationError("Content-addressed custom node artifact digest collision.");
      return;
    }
    this.db.prepare(`
      INSERT INTO custom_node_artifacts (digest, node_id, project_id, version, artifact_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(artifact.digest, artifact.nodeId, artifact.projectId, artifact.version, serialized, artifact.createdAt);
  }

  private updateLifecycle(
    nodeId: string,
    status: CustomNodeLifecycleStatus,
    report: CustomNodeValidationReport | null,
    artifactDigest: string | null,
  ): void {
    this.db.prepare(`
      UPDATE custom_nodes
      SET status = ?, validation_report_json = ?, artifact_digest = ?, updated_at = ?
      WHERE id = ?
    `).run(status, report ? JSON.stringify(report) : null, artifactDigest, new Date().toISOString(), nodeId);
  }

  private requireProject(projectId: string): void {
    if (!this.db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) throw new EntityNotFoundError(`Project not found: ${projectId}`);
  }

  private requireNode(nodeId: string): CustomNodeRecord {
    const node = this.getNode(nodeId);
    if (!node) throw new EntityNotFoundError(`Custom node not found: ${nodeId}`);
    return node;
  }

  private mapNode(row: CustomNodeRow): CustomNodeRecord {
    if (!LIFECYCLE_STATUSES.includes(row.status as CustomNodeLifecycleStatus)) throw new ValidationError(`Invalid custom node status: ${row.status}`);
    return {
      id: row.id, projectId: row.project_id, status: row.status as CustomNodeLifecycleStatus,
      sourceRevision: row.source_revision, manifest: JSON.parse(row.manifest_json) as CustomNodeManifest,
      validationReport: row.validation_report_json ? JSON.parse(row.validation_report_json) as CustomNodeValidationReport : null,
      artifactDigest: row.artifact_digest, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  private mapPublication(row: CustomNodePublicationRow): CustomNodePublication {
    return {
      id: row.id, nodeId: row.node_id, projectId: row.project_id, nodeType: row.node_type,
      version: Number(row.version), artifactDigest: row.artifact_digest, publishedBy: row.published_by, publishedAt: row.published_at,
    };
  }
}
