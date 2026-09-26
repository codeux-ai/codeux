import { randomUUID } from "node:crypto";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import type { GithubIntakeActionClass, GithubIntakeExternalKind, GithubIntakeItem, GithubIntakeStatus } from "../contracts/github-intake-types.js";

interface IntakeRow { id: string; project_id: string; provider: string; host_domain: string; repository: string; external_kind: GithubIntakeExternalKind; external_number: number; observed_version: string; action_class: GithubIntakeActionClass; policy_version: string; idempotency_key: string; disposition: string; status: GithubIntakeStatus; title: string; url: string; labels_json: string; payload_json: string; sprint_id: string | null; task_id: string | null; dispatch_id: string | null; claimed_at: string | null; terminal_at: string | null; next_wake_at: string | null; last_error: string | null; first_seen_at: string; last_seen_at: string; created_at: string; updated_at: string }

export interface GithubIntakeCandidate {
  projectId: string; provider?: string; hostDomain: string; repository: string;
  externalKind: GithubIntakeExternalKind; externalNumber: number; observedVersion: string;
  actionClass: GithubIntakeActionClass; policyVersion: string; disposition?: string;
  status?: GithubIntakeStatus; title: string; url: string; labels?: unknown[];
  payload?: Record<string, unknown>; nextWakeAt?: string | null;
}

export interface GithubIntakeClaim extends GithubIntakeItem { }
export type GithubIntakeCapacityClaimResult =
  | { status: "claimed"; item: GithubIntakeClaim }
  | { status: "capacity" }
  | { status: "unavailable" };

export function buildGithubIntakeIdempotencyKey(input: Pick<GithubIntakeCandidate, "projectId" | "provider" | "hostDomain" | "repository" | "externalKind" | "externalNumber" | "observedVersion" | "actionClass" | "policyVersion">): string {
  return [input.projectId, input.provider ?? "github", input.hostDomain, input.repository, input.externalKind, input.externalNumber, input.observedVersion, input.actionClass, input.policyVersion].join("|");
}

export class GithubIntakeRepository {
  private readonly db: DatabaseAdapter;
  constructor(storage: AppDbStorage = new AppDbStorage()) { this.db = storage.getDatabase(); }

  /** Use only for the short DB-only sprint-create/ledger-link admission boundary. */
  withTransaction<T>(operation: () => T): T { return this.db.transaction(operation); }

  upsertSeen(input: GithubIntakeCandidate): GithubIntakeItem {
    const now = new Date().toISOString();
    const provider = input.provider ?? "github";
    const key = buildGithubIntakeIdempotencyKey({ ...input, provider });
    const id = randomUUID();
    this.db.prepare(`INSERT INTO github_intake_items
      (id, project_id, provider, host_domain, repository, external_kind, external_number, observed_version,
       action_class, policy_version, idempotency_key, disposition, status, title, url, labels_json, payload_json,
       next_wake_at, first_seen_at, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET title=excluded.title, url=excluded.url,
       labels_json=excluded.labels_json, payload_json=excluded.payload_json,
       next_wake_at=excluded.next_wake_at, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at`)
      .run(id, input.projectId, provider, input.hostDomain, input.repository, input.externalKind, input.externalNumber,
        input.observedVersion, input.actionClass, input.policyVersion, key, input.disposition ?? "candidate",
        input.status ?? "seen", input.title.trim(), input.url, JSON.stringify(input.labels ?? []), JSON.stringify(input.payload ?? {}),
        input.nextWakeAt ?? null, now, now, now, now);
    return this.requireByKey(key);
  }

  getByKey(idempotencyKey: string): GithubIntakeItem | null {
    const row = this.db.prepare("SELECT * FROM github_intake_items WHERE idempotency_key = ?").get(idempotencyKey) as IntakeRow | undefined;
    return row ? this.map(row) : null;
  }

  claim(id: string, now = new Date().toISOString()): GithubIntakeClaim | null {
    return this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE github_intake_items SET status='claimed', claimed_at=?, updated_at=?
        WHERE id=? AND status='seen' AND (next_wake_at IS NULL OR next_wake_at <= ?)
        AND sprint_id IS NULL AND dispatch_id IS NULL`).run(now, now, id, now);
      if (result.changes === 0) return null;
      const row = this.db.prepare("SELECT * FROM github_intake_items WHERE id = ?").get(id) as IntakeRow | undefined;
      return row ? this.map(row) : null;
    });
  }

  /** Atomically admits one item only while the repository is below its lane cap. */
  claimWithinCapacity(
    id: string,
    projectId: string,
    repository: string,
    maxActiveLanes: number,
    now = new Date().toISOString(),
  ): GithubIntakeCapacityClaimResult {
    return this.db.transaction(() => {
      const active = this.db.prepare(`SELECT COUNT(*) AS count FROM github_intake_items
        WHERE project_id = ? AND repository = ? AND status IN ('claimed', 'dispatched')`)
        .get(projectId, repository) as { count: number };
      if (Number(active.count) >= maxActiveLanes) return { status: "capacity" };
      const result = this.db.prepare(`UPDATE github_intake_items SET status='claimed', claimed_at=?, updated_at=?
        WHERE id=? AND project_id=? AND repository=? AND status='seen'
          AND (next_wake_at IS NULL OR next_wake_at <= ?) AND sprint_id IS NULL AND dispatch_id IS NULL`)
        .run(now, now, id, projectId, repository, now);
      if (result.changes === 0) return { status: "unavailable" };
      const row = this.db.prepare("SELECT * FROM github_intake_items WHERE id = ?").get(id) as IntakeRow | undefined;
      return row ? { status: "claimed", item: this.map(row) } : { status: "unavailable" };
    });
  }

  attachDispatch(id: string, values: { sprintId?: string | null; taskId?: string | null; dispatchId?: string | null }, now = new Date().toISOString()): GithubIntakeItem {
    const result = this.db.prepare(`UPDATE github_intake_items SET status='dispatched', sprint_id=?, task_id=?, dispatch_id=?, last_error=NULL, updated_at=? WHERE id=? AND status='claimed'`)
      .run(values.sprintId ?? null, values.taskId ?? null, values.dispatchId ?? null, now, id);
    if (result.changes !== 1) throw new Error(`GitHub intake claim is no longer attachable: ${id}`);
    return this.require(id);
  }

  setStatus(id: string, status: Exclude<GithubIntakeStatus, "seen" | "claimed">, disposition?: string, error?: string | null, now = new Date().toISOString()): GithubIntakeItem {
    this.db.prepare(`UPDATE github_intake_items SET status=?, disposition=COALESCE(?, disposition), last_error=?, terminal_at=?, updated_at=? WHERE id=?`)
      .run(status, disposition ?? null, error ?? null, ["completed", "failed", "held", "ignored"].includes(status) ? now : null, now, id);
    return this.require(id);
  }

  countActive(projectId: string, repository: string): number {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM github_intake_items
      WHERE project_id = ? AND repository = ? AND status IN ('claimed', 'dispatched')`)
      .get(projectId, repository) as { count: number };
    return Number(row.count);
  }

  /**
   * Returns only work that still consumes an intake lane.  Terminal and held
   * items intentionally do not appear here: the reconciliation pass must be
   * able to free capacity without deleting its audit trail.
   */
  listDispatched(projectId: string, repository: string): GithubIntakeItem[] {
    const rows = this.db.prepare(`SELECT * FROM github_intake_items
      WHERE project_id = ? AND repository = ? AND status = 'dispatched'
      ORDER BY claimed_at ASC, rowid ASC`).all(projectId, repository) as IntakeRow[];
    return rows.map((row) => this.map(row));
  }

  reconcileProjectState(
    projectId: string,
    repository: string,
    orphanedBefore: string,
    now = new Date().toISOString(),
  ): { completed: number; failed: number; held: number } {
    return this.db.transaction(() => {
      const orphanedDispatches = this.db.prepare(`UPDATE github_intake_items
        SET status='held', disposition='orphaned_dispatch', terminal_at=?, updated_at=?
        WHERE project_id=? AND repository=? AND status='dispatched' AND claimed_at <= ?
          AND sprint_id IN (SELECT id FROM sprints WHERE status='idle')`)
        .run(now, now, projectId, repository, orphanedBefore).changes;
      this.db.prepare(`UPDATE sprints SET status='cancelled', updated_at=?
        WHERE id IN (
          SELECT sprint_id FROM github_intake_items
          WHERE project_id=? AND repository=? AND status='held' AND disposition='orphaned_dispatch'
        ) AND project_id=? AND status='idle'`).run(now, projectId, repository, projectId);
      const completed = this.db.prepare(`UPDATE github_intake_items
        SET status='completed', disposition='sprint_completed', terminal_at=?, updated_at=?
        WHERE project_id=? AND repository=? AND status='dispatched' AND sprint_id IN (
          SELECT id FROM sprints WHERE status='completed'
        )`).run(now, now, projectId, repository).changes;
      const failed = this.db.prepare(`UPDATE github_intake_items
        SET status='failed', disposition='sprint_failed', terminal_at=?, updated_at=?
        WHERE project_id=? AND repository=? AND status='dispatched' AND sprint_id IN (
          SELECT id FROM sprints WHERE status IN ('failed', 'cancelled')
        )`).run(now, now, projectId, repository).changes;
      const held = this.db.prepare(`UPDATE github_intake_items
        SET status='held', disposition='orphaned_claim', terminal_at=?, updated_at=?
        WHERE project_id=? AND repository=? AND status='claimed' AND sprint_id IS NULL
          AND claimed_at IS NOT NULL AND claimed_at <= ?`)
        .run(now, now, projectId, repository, orphanedBefore).changes;
      return { completed, failed, held: held + orphanedDispatches };
    });
  }

  private require(id: string): GithubIntakeItem { const row = this.db.prepare("SELECT * FROM github_intake_items WHERE id = ?").get(id) as IntakeRow | undefined; if (!row) throw new Error(`GitHub intake item not found: ${id}`); return this.map(row); }
  private requireByKey(key: string): GithubIntakeItem { const row = this.getByKey(key); if (!row) throw new Error(`GitHub intake item not found: ${key}`); return row; }
  private map(row: IntakeRow): GithubIntakeItem { return { id: row.id, projectId: row.project_id, provider: row.provider, hostDomain: row.host_domain, repository: row.repository, externalKind: row.external_kind, externalNumber: row.external_number, observedVersion: row.observed_version, actionClass: row.action_class, policyVersion: row.policy_version, idempotencyKey: row.idempotency_key, disposition: row.disposition, status: row.status, title: row.title, url: row.url, labels: JSON.parse(row.labels_json) as unknown[], payload: JSON.parse(row.payload_json) as Record<string, unknown>, sprintId: row.sprint_id, taskId: row.task_id, dispatchId: row.dispatch_id, claimedAt: row.claimed_at, terminalAt: row.terminal_at, nextWakeAt: row.next_wake_at, lastError: row.last_error, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at, createdAt: row.created_at, updatedAt: row.updated_at }; }
}
