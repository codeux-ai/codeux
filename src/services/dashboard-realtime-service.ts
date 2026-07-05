import type {
  DashboardRealtimeEvent,
  DashboardRealtimeScopeType,
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  OverviewTelemetrySnapshot,
} from "../contracts/app-types.js";
import type { ProjectCollectionResponse } from "../contracts/project-management-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  DashboardRealtimeEventRepository,
  type AppendDashboardRealtimeEventInput,
} from "../repositories/dashboard-realtime-event-repository.js";

type MaybePromise<T> = T | Promise<T>;

export interface DashboardSnapshotCacheInvalidator {
  invalidateProjectExecution(projectId: string): void;
  invalidateProjectStats(projectId: string): void;
  invalidateOverview(): void;
  invalidateProjects(): void;
}

export interface DashboardRealtimeSnapshotLoaders {
  getProjectsSnapshot: () => MaybePromise<ProjectCollectionResponse>;
  getProjectExecutionSnapshot: (projectId: string) => MaybePromise<ExecutionDashboardSnapshot>;
  getProjectStatusSnapshot: (projectId: string) => MaybePromise<DashboardStatus>;
  getProjectLiveSnapshot: (projectId: string) => MaybePromise<import("../contracts/app-types.js").ProjectLiveDashboardSnapshot>;
  /**
   * Git/CI/PR status for a project. Published on the dedicated, slow-cadence `project.git.updated`
   * channel (consumed only by the Live page) so the large, slow git payload never rides the hot
   * `project.live.updated` ticks. Optional so existing loader wirings/tests stay valid.
   */
  getProjectGitStatus?: (projectId: string) => MaybePromise<GitTrackingStatus | null>;
  getOverviewTelemetrySnapshot: () => MaybePromise<OverviewTelemetrySnapshot>;
}


export interface DashboardRealtimeMetrics {
  coalesced: number;
  throttled: number;
  unchanged: number;
  published: number;
  skipped: number;
  failures: number;
}

export interface DashboardRealtimeMutationNotifier {
  scheduleProjectsRefresh: () => void;
  scheduleProjectLiveRefresh: (projectId: string) => void;
  scheduleProjectExecutionRefresh: (projectId: string, options?: { includeOverview?: boolean; includeProjects?: boolean }) => void;
  scheduleProjectRuntimeStatusRefresh: (projectId: string) => void;
  scheduleProjectStructureRefresh: (projectId: string, options?: { includeProjects?: boolean }) => void;
}

type DashboardRealtimeListener = (event: DashboardRealtimeEvent) => void;
type SnapshotObject = Record<string, unknown>;

const DEFAULT_FLUSH_DELAY_MS = 75;
// The live snapshot is the heaviest realtime payload (~480KB: full execution tree + runtime event
// feed) and is reassembled from several DB queries on each publish. The throttle below is checked
// *before* the loader runs, so it caps how often that assembly happens. A 5s floor keeps the Live
// page fresh enough while roughly halving the assemble/serialize/broadcast load versus the previous
// ~2s mutation-driven cadence.
const PROJECT_LIVE_MIN_INTERVAL_MS = 5_000;
const PROJECT_GIT_MIN_INTERVAL_MS = 5_000;
const PROJECT_EXECUTION_MIN_INTERVAL_MS = 300;
const PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS = 250;
const PROJECT_STRUCTURE_MIN_INTERVAL_MS = 250;
const PROJECTS_MIN_INTERVAL_MS = 750;
const OVERVIEW_MIN_INTERVAL_MS = 1_000;

export class DashboardRealtimeService implements DashboardRealtimeMutationNotifier {
  private readonly metrics = new Map<string, DashboardRealtimeMetrics>();

  getMetrics(eventType: string): DashboardRealtimeMetrics {
    return (
      this.metrics.get(eventType) || {
        coalesced: 0,
        throttled: 0,
        unchanged: 0,
        published: 0,
        skipped: 0,
        failures: 0,
      }
    );
  }

  private incrementMetric(eventType: string, metric: keyof DashboardRealtimeMetrics): void {
    let current = this.metrics.get(eventType);
    if (!current) {
      current = { coalesced: 0, throttled: 0, unchanged: 0, published: 0, skipped: 0, failures: 0 };
      this.metrics.set(eventType, current);
    }
    current[metric]++;
  }

  private addPendingWithCoalesce(set: Set<string>, id: string, eventType: string): void {
    if (set.has(id)) {
      this.incrementMetric(eventType, "coalesced");
    } else {
      set.add(id);
    }
  }

  private trackCoalesceFlag(currentValue: boolean, eventType: string): boolean {
    if (currentValue) {
      this.incrementMetric(eventType, "coalesced");
      return true;
    }
    return true;
  }

  private readonly listeners = new Set<DashboardRealtimeListener>();
  private readonly pendingProjectLiveIds = new Set<string>();
  private readonly pendingProjectGitIds = new Set<string>();
  private readonly pendingProjectIds = new Set<string>();
  private readonly pendingProjectStatusIds = new Set<string>();
  private readonly pendingProjectStructureIds = new Set<string>();
  private readonly projectLivePublishedAt = new Map<string, number>();
  private readonly projectGitPublishedAt = new Map<string, number>();
  private readonly projectExecutionPublishedAt = new Map<string, number>();
  private readonly projectRuntimeStatusPublishedAt = new Map<string, number>();
  private readonly projectStructurePublishedAt = new Map<string, number>();
  private readonly lastPayloadFingerprints = new Map<string, string>();
  private pendingProjects = false;
  private pendingOverview = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDueAt: number | null = null;
  private latestSequence: number;
  private projectsPublishedAt = 0;
  private overviewPublishedAt = 0;
  private snapshotLoaders: DashboardRealtimeSnapshotLoaders | null = null;
  private cacheInvalidator: DashboardSnapshotCacheInvalidator | null = null;
  private scopeInterestResolver: ((scope: string) => boolean) | null = null;

  private executionRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedExecutionRefreshProjectIds = new Set<string>();

  constructor(
    private readonly eventRepository: DashboardRealtimeEventRepository,
    private readonly logger: Logger,
  ) {
    this.latestSequence = this.eventRepository.getLatestSequence() ?? 0;
  }

  setCacheInvalidator(invalidator: DashboardSnapshotCacheInvalidator): void {
    this.cacheInvalidator = invalidator;
  }

  setSnapshotLoaders(loaders: DashboardRealtimeSnapshotLoaders): void {
    this.snapshotLoaders = loaders;
  }

  setScopeInterestResolver(resolver: ((scope: string) => boolean) | null): void {
    this.scopeInterestResolver = resolver;
  }

  subscribe(listener: DashboardRealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestSequence(): number | null {
    return this.latestSequence > 0 ? this.latestSequence : null;
  }

  getLatestSequenceForScopes(scopes: string[]): number | null {
    return this.eventRepository.getLatestSequenceForScopes(scopes);
  }

  hasNonReplayableEventsSince(scopes: string[], afterSequence: number): boolean {
    return this.eventRepository.hasNonReplayableEventsSince(scopes, afterSequence);
  }

  replay(scopes: string[], afterSequence: number, limit: number = 200): DashboardRealtimeEvent[] {
    return this.eventRepository.listEventsSince(scopes, afterSequence, limit);
  }

  private scheduleExecutionRefreshDebouncer(): void {
    if (this.executionRefreshDebounceTimer) {
      return;
    }

    this.executionRefreshDebounceTimer = setTimeout(() => {
      this.executionRefreshDebounceTimer = null;
      const projectIds = Array.from(this.queuedExecutionRefreshProjectIds);
      this.queuedExecutionRefreshProjectIds.clear();

      if (projectIds.length > 0) {
        const event = this.publishRawEvent({
          scopeType: "projects",
          scopeId: "projects",
          eventType: "execution_refresh",
          entityType: "project_collection",
          entityId: "projects",
          payload: { projectIds },
          replayable: false,
        });
        if (event) {
          this.incrementMetric("execution_refresh", "published");
        }
      }
    }, 10);
  }

  scheduleProjectExecutionRefresh(
    projectId: string,
    options?: { includeOverview?: boolean; includeProjects?: boolean },
  ): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.cacheInvalidator?.invalidateProjectExecution(normalizedProjectId);
    this.cacheInvalidator?.invalidateProjectStats(normalizedProjectId);

    if (options?.includeOverview !== false) {
       this.cacheInvalidator?.invalidateOverview();
    }
    if (options?.includeProjects === true) {
       this.cacheInvalidator?.invalidateProjects();
    }

    this.addPendingWithCoalesce(this.pendingProjectLiveIds, normalizedProjectId, "project.live.updated");
    this.addPendingWithCoalesce(this.pendingProjectIds, normalizedProjectId, "project.execution.updated");
    if (options?.includeProjects === true) {
      this.pendingProjects = this.trackCoalesceFlag(this.pendingProjects, "projects.updated");
    }
    if (options?.includeOverview !== false) {
      this.pendingOverview = this.trackCoalesceFlag(this.pendingOverview, "overview.telemetry.updated");
    }
    this.scheduleFlush();

    this.queuedExecutionRefreshProjectIds.add(normalizedProjectId);
    this.scheduleExecutionRefreshDebouncer();
  }

  scheduleProjectRuntimeStatusRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.addPendingWithCoalesce(this.pendingProjectLiveIds, normalizedProjectId, "project.live.updated");
    this.addPendingWithCoalesce(this.pendingProjectStatusIds, normalizedProjectId, "project.runtime_status.updated");
    this.scheduleFlush();
  }

  scheduleProjectStructureRefresh(projectId: string, options?: { includeProjects?: boolean }): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.addPendingWithCoalesce(this.pendingProjectLiveIds, normalizedProjectId, "project.live.updated");
    this.addPendingWithCoalesce(this.pendingProjectStructureIds, normalizedProjectId, "project.structure.updated");
    if (options?.includeProjects !== false) {
      this.pendingProjects = this.trackCoalesceFlag(this.pendingProjects, "projects.updated");
    }
    this.scheduleFlush();
  }

  scheduleProjectLiveRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.addPendingWithCoalesce(this.pendingProjectLiveIds, normalizedProjectId, "project.live.updated");
    this.scheduleFlush();
  }

  /**
   * Schedules a project.live.updated publish that bypasses the steady-state throttle. Used for
   * explicit user actions — e.g. switching the selected sprint — where waiting up to
   * PROJECT_LIVE_MIN_INTERVAL_MS for the live snapshot to reflect the change feels sluggish. Clearing
   * the last-published watermark makes the throttle treat this as the first publish, so the next
   * flush (within the normal ~75ms debounce) emits immediately; normal throttling resumes after.
   */
  expediteProjectLiveRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.projectLivePublishedAt.delete(normalizedProjectId);
    this.addPendingWithCoalesce(this.pendingProjectLiveIds, normalizedProjectId, "project.live.updated");
    this.scheduleFlush();
  }

  /**
   * Schedule a publish of the project's git/CI/PR status on the dedicated `project.git.updated`
   * channel. Kept separate from the live tick so the slow, large git payload is throttled hard
   * and only reaches the Live page (which subscribes to this event), and only when it changes.
   */
  scheduleProjectGitRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.addPendingWithCoalesce(this.pendingProjectGitIds, normalizedProjectId, "project.git.updated");
    this.scheduleFlush();
  }

  scheduleOverviewRefresh(): void {
    this.cacheInvalidator?.invalidateOverview();
    this.pendingOverview = this.trackCoalesceFlag(this.pendingOverview, "overview.telemetry.updated");
    this.scheduleFlush();
  }

  scheduleProjectsRefresh(): void {
    this.cacheInvalidator?.invalidateProjects();
    this.pendingProjects = this.trackCoalesceFlag(this.pendingProjects, "projects.updated");
    this.scheduleFlush();

    this.queuedExecutionRefreshProjectIds.add("projects");
    this.scheduleExecutionRefreshDebouncer();
  }

  publishRawEvent(input: AppendDashboardRealtimeEventInput): DashboardRealtimeEvent | null {
    try {
      const event = this.eventRepository.appendEvent(input);
      this.latestSequence = Math.max(this.latestSequence, event.sequence);
      this.broadcast(event);
      return event;
    } catch (error) {
      this.incrementMetric(input.eventType, "failures");
      this.logger.error("dashboard_realtime_event_write_failed", {
        eventType: input.eventType,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        projectId: input.projectId ?? null,
        correlationId: input.correlationId ?? null,
        error,
      });
      return null;
    }
  }

  async drain(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flushDueAt = null;
    }

    if (this.executionRefreshDebounceTimer) {
      clearTimeout(this.executionRefreshDebounceTimer);
      this.executionRefreshDebounceTimer = null;
      const projectIds = Array.from(this.queuedExecutionRefreshProjectIds);
      this.queuedExecutionRefreshProjectIds.clear();
      if (projectIds.length > 0) {
        const event = this.publishRawEvent({
          scopeType: "projects",
          scopeId: "projects",
          eventType: "execution_refresh",
          entityType: "project_collection",
          entityId: "projects",
          payload: { projectIds },
          replayable: false,
        });
        if (event) {
          this.incrementMetric("execution_refresh", "published");
        }
      }
    }

    await this.flushScheduledSnapshots();
  }

  private scheduleFlush(delayMs: number = DEFAULT_FLUSH_DELAY_MS): void {
    const dueAt = Date.now() + Math.max(0, delayMs);
    if (this.flushTimer && this.flushDueAt !== null && this.flushDueAt <= dueAt) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushDueAt = dueAt;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDueAt = null;
      void this.flushScheduledSnapshots();
    }, Math.max(0, dueAt - Date.now()));
  }

  private buildPublishTask<T>(options: {
    now: number;
    lastPublishedAt: number;
    minIntervalMs: number;
    scopeType: DashboardRealtimeScopeType;
    scopeId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    projectId?: string;
    loader: () => Promise<T> | T;
    shouldPublish?: () => boolean;
    cacheKey?: string;
    skipDuplicate?: boolean;
    sprintIdExtractor?: (payload: T) => string | undefined;
    logType?: "realtime_snapshot_published" | "realtime_background_refresh";
    logPayloadSize?: boolean;
    onPublished: (now: number) => void;
  }): { task: Promise<void> | null; waitMs: number } {
    const waitMs = this.getThrottleDelay(options.lastPublishedAt, options.minIntervalMs, options.now);
    if (waitMs > 0) {
      this.incrementMetric(options.eventType, "throttled");
      return { task: null, waitMs };
    }

    if (options.shouldPublish && !options.shouldPublish()) {
      this.incrementMetric(options.eventType, "skipped");
      return { task: null, waitMs: 0 };
    }

    const task = (async () => {
      try {
        const payload = await Promise.resolve(options.loader());
        let sprintId: string | undefined;
        if (options.sprintIdExtractor) {
          sprintId = options.sprintIdExtractor(payload);
        }

        let payloadSizeBytes: number | undefined;

        if (options.cacheKey && options.skipDuplicate) {
          const fingerprint = this.getDeduplicationFingerprint(options.eventType, payload);
          if (this.lastPayloadFingerprints.get(options.cacheKey) === fingerprint) {
            this.logger.debug("skipping_duplicate_realtime_snapshot", {
              type: options.eventType,
              ...(options.projectId ? { projectId: options.projectId } : {}),
            });
            this.incrementMetric(options.eventType, "unchanged");
            options.onPublished(options.now);
            return;
          }
          this.lastPayloadFingerprints.set(options.cacheKey, fingerprint);
          if (options.logPayloadSize) {
            payloadSizeBytes = Buffer.byteLength(fingerprint, "utf8");
          }
        } else if (options.logPayloadSize) {
          const fingerprint = this.getDeduplicationFingerprint(options.eventType, payload);
          payloadSizeBytes = Buffer.byteLength(fingerprint, "utf8");
        }

        const event = this.publishRawEvent({
          scopeType: options.scopeType,
          scopeId: options.scopeId,
          eventType: options.eventType,
          entityType: options.entityType,
          entityId: options.entityId,
          ...(options.projectId ? { projectId: options.projectId } : {}),
          ...(sprintId ? { sprintId } : {}),
          payload,
          replayable: false,
        });
        if (!event) {
          return;
        }
        this.incrementMetric(options.eventType, "published");

        if (options.logType) {
          if (options.logType === "realtime_snapshot_published") {
            this.logger.info(options.logType, {
              type: options.eventType,
              ...(payloadSizeBytes !== undefined ? { sizeBytes: payloadSizeBytes } : {}),
              ...(options.projectId ? { projectId: options.projectId } : {}),
              publishFrequencyMs: options.lastPublishedAt > 0 ? options.now - options.lastPublishedAt : 0,
            });
          } else {
            this.logger.info(options.logType, { type: options.entityId });
          }
        }

        options.onPublished(options.now);
      } catch (error) {
        this.incrementMetric(options.eventType, "failures");
        this.logger.error(`Failed to publish ${options.eventType.replace(/\./g, " ")} realtime snapshot`, {
          ...(options.projectId ? { projectId: options.projectId } : {}),
          error,
        });
      }
    })();

    return { task, waitMs: 0 };
  }

  private async flushScheduledSnapshots(): Promise<void> {
    const loaders = this.snapshotLoaders;
    if (!loaders) {
      this.pendingProjectLiveIds.clear();
      this.pendingProjectGitIds.clear();
      this.pendingProjectIds.clear();
      this.pendingProjectStatusIds.clear();
      this.pendingProjectStructureIds.clear();
      this.pendingProjects = false;
      this.pendingOverview = false;
      return;
    }

    const now = Date.now();
    let nextDelayMs: number | null = null;
    const projectLiveIds = [...this.pendingProjectLiveIds];
    const projectGitIds = [...this.pendingProjectGitIds];
    const projectIds = [...this.pendingProjectIds];
    const projectStatusIds = [...this.pendingProjectStatusIds];
    const projectStructureIds = [...this.pendingProjectStructureIds];
    const shouldPublishProjects = this.pendingProjects;
    const shouldPublishOverview = this.pendingOverview;
    this.pendingProjectLiveIds.clear();
    this.pendingProjectGitIds.clear();
    this.pendingProjectIds.clear();
    this.pendingProjectStatusIds.clear();
    this.pendingProjectStructureIds.clear();
    this.pendingProjects = false;
    this.pendingOverview = false;

    const publishTasks: Array<Promise<void>> = [];


    const scopes = [
      {
        ids: shouldPublishProjects ? ["projects"] : [],
        minIntervalMs: PROJECTS_MIN_INTERVAL_MS,
        scopeType: "projects" as const,
        scopeId: (id: string) => "projects",
        eventType: "projects.updated",
        entityType: "project_collection",
        entityId: (id: string) => "projects",
        loader: () => loaders.getProjectsSnapshot(),
        lastPublishedAt: (id: string) => this.projectsPublishedAt,
        logType: "realtime_background_refresh" as const,
        onPublished: (id: string, publishedAt: number) => {
          this.projectsPublishedAt = publishedAt;
        },
        onPending: (id: string) => {
          this.pendingProjects = this.trackCoalesceFlag(this.pendingProjects, "projects.updated");
        },
      },
      {
        ids: projectLiveIds,
        minIntervalMs: PROJECT_LIVE_MIN_INTERVAL_MS,
        scopeType: "project" as const,
        // Dedicated sub-scope so the heavy live payload (~0.5MB, status+execution
        // +git+activity feed) is delivered ONLY to clients that render it (Live and
        // Tasks pages). Pages on the plain `project:<id>` scope (sprints, overview,
        // chat) no longer receive — or have to parse — these frames.
        scopeId: (projectId: string) => `${projectId}:live`,
        eventType: "project.live.updated",
        entityType: "project_live",
        entityId: (projectId: string) => projectId,
        projectId: (projectId: string) => projectId,
        loader: (projectId: string) => loaders.getProjectLiveSnapshot(projectId),
        cacheKey: (projectId: string) => `project:${projectId}:project.live.updated`,
        skipDuplicate: true,
        sprintIdExtractor: (payload: any) => payload.selectedSprintId,
        logType: "realtime_snapshot_published" as const,
        logPayloadSize: true,
        lastPublishedAt: (projectId: string) => this.projectLivePublishedAt.get(projectId) ?? 0,
        shouldPublish: (projectId: string) => this.hasScopeInterest(`project:${projectId}:live`),
        onPublished: (projectId: string, publishedAt: number) => {
          this.projectLivePublishedAt.set(projectId, publishedAt);
        },
        onPending: (projectId: string) => {
          this.pendingProjectLiveIds.add(projectId);
        },
      },
      {
        ids: loaders.getProjectGitStatus ? projectGitIds : [],
        minIntervalMs: PROJECT_GIT_MIN_INTERVAL_MS,
        scopeType: "project" as const,
        // Dedicated sub-scope so the large Git/CI/PR payload is only delivered to
        // the Live page hook. Base project subscribers, including the file browser,
        // should not parse multi-megabyte git frames they will ignore.
        scopeId: (projectId: string) => `${projectId}:git`,
        eventType: "project.git.updated",
        entityType: "project_git",
        entityId: (projectId: string) => projectId,
        projectId: (projectId: string) => projectId,
        loader: (projectId: string) => loaders.getProjectGitStatus!(projectId),
        cacheKey: (projectId: string) => `project:${projectId}:project.git.updated`,
        skipDuplicate: true,
        lastPublishedAt: (projectId: string) => this.projectGitPublishedAt.get(projectId) ?? 0,
        shouldPublish: (projectId: string) => this.hasScopeInterest(`project:${projectId}:git`),
        onPublished: (projectId: string, publishedAt: number) => {
          this.projectGitPublishedAt.set(projectId, publishedAt);
        },
        onPending: (projectId: string) => {
          this.pendingProjectGitIds.add(projectId);
        },
      },
      {
        ids: projectIds,
        minIntervalMs: PROJECT_EXECUTION_MIN_INTERVAL_MS,
        scopeType: "project" as const,
        scopeId: (projectId: string) => projectId,
        eventType: "project.execution.updated",
        entityType: "project",
        entityId: (projectId: string) => projectId,
        projectId: (projectId: string) => projectId,
        loader: (projectId: string) => loaders.getProjectExecutionSnapshot(projectId),
        cacheKey: (projectId: string) => `project:${projectId}:project.execution.updated`,
        skipDuplicate: true,
        lastPublishedAt: (projectId: string) => this.projectExecutionPublishedAt.get(projectId) ?? 0,
        onPublished: (projectId: string, publishedAt: number) => {
          this.projectExecutionPublishedAt.set(projectId, publishedAt);
        },
        onPending: (projectId: string) => {
          this.pendingProjectIds.add(projectId);
        },
      },
      {
        ids: projectStatusIds,
        minIntervalMs: PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS,
        scopeType: "project" as const,
        scopeId: (projectId: string) => projectId,
        eventType: "project.runtime_status.updated",
        entityType: "project_status",
        entityId: (projectId: string) => projectId,
        projectId: (projectId: string) => projectId,
        loader: (projectId: string) => loaders.getProjectStatusSnapshot(projectId),
        lastPublishedAt: (projectId: string) => this.projectRuntimeStatusPublishedAt.get(projectId) ?? 0,
        onPublished: (projectId: string, publishedAt: number) => {
          this.projectRuntimeStatusPublishedAt.set(projectId, publishedAt);
        },
        onPending: (projectId: string) => {
          this.pendingProjectStatusIds.add(projectId);
        },
      },
      {
        ids: projectStructureIds,
        minIntervalMs: PROJECT_STRUCTURE_MIN_INTERVAL_MS,
        scopeType: "project" as const,
        scopeId: (projectId: string) => projectId,
        eventType: "project.structure.updated",
        entityType: "project",
        entityId: (projectId: string) => projectId,
        projectId: (projectId: string) => projectId,
        loader: (projectId: string) => ({
          projectId,
          updatedAt: new Date().toISOString(),
        }),
        lastPublishedAt: (projectId: string) => this.projectStructurePublishedAt.get(projectId) ?? 0,
        onPublished: (projectId: string, publishedAt: number) => {
          this.projectStructurePublishedAt.set(projectId, publishedAt);
        },
        onPending: (projectId: string) => {
          this.pendingProjectStructureIds.add(projectId);
        },
      },
    ];

    for (const scope of scopes) {
      for (const id of scope.ids) {
        const result = this.buildPublishTask({
          now,
          lastPublishedAt: scope.lastPublishedAt(id),
          minIntervalMs: scope.minIntervalMs,
          scopeType: scope.scopeType,
          scopeId: scope.scopeId(id),
          eventType: scope.eventType,
          entityType: scope.entityType,
          entityId: scope.entityId(id),
          ...(scope.projectId ? { projectId: scope.projectId(id) } : {}),
          loader: () => scope.loader(id),
          ...(scope.shouldPublish ? { shouldPublish: () => scope.shouldPublish(id) } : {}),
          ...(scope.cacheKey ? { cacheKey: scope.cacheKey(id) } : {}),
          skipDuplicate: scope.skipDuplicate,
          sprintIdExtractor: scope.sprintIdExtractor,
          logType: scope.logType,
          logPayloadSize: scope.logPayloadSize,
          onPublished: (publishedAt) => scope.onPublished(id, publishedAt),
        });

        if (result.waitMs > 0) {
          scope.onPending(id);
          nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
        } else if (result.task) {
          publishTasks.push(result.task);
        }
      }
    }

    if (shouldPublishOverview) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.overviewPublishedAt,
        minIntervalMs: OVERVIEW_MIN_INTERVAL_MS,
        scopeType: "overview",
        scopeId: "overview",
        eventType: "overview.telemetry.updated",
        entityType: "overview",
        entityId: "overview",
        loader: () => loaders.getOverviewTelemetrySnapshot(),
        cacheKey: `overview:overview:overview.telemetry.updated`,
        skipDuplicate: true,
        logType: "realtime_background_refresh",
        onPublished: (publishedAt) => {
          this.overviewPublishedAt = publishedAt;
        },
      });

      if (result.waitMs > 0) {
        this.pendingOverview = this.trackCoalesceFlag(this.pendingOverview, "overview.telemetry.updated");
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    await Promise.allSettled(publishTasks);

    if (nextDelayMs !== null) {
      this.scheduleFlush(nextDelayMs);
    }
  }

  private getThrottleDelay(lastPublishedAt: number, minIntervalMs: number, now: number): number {
    if (lastPublishedAt <= 0) {
      return 0;
    }
    return Math.max(0, minIntervalMs - (now - lastPublishedAt));
  }

  private getNextDelay(currentDelayMs: number | null, candidateDelayMs: number): number {
    if (currentDelayMs === null) {
      return candidateDelayMs;
    }
    return Math.min(currentDelayMs, candidateDelayMs);
  }

  private hasScopeInterest(scope: string): boolean {
    if (!this.scopeInterestResolver) {
      return true;
    }
    try {
      return this.scopeInterestResolver(scope);
    } catch (error) {
      this.logger.warn("dashboard_realtime_scope_interest_check_failed", {
        logPurpose: "realtime",
        scope,
        error,
      });
      return true;
    }
  }

  private getDeduplicationFingerprint(eventType: string, payload: unknown): string {
    return this.getSemanticSnapshotSignature(eventType, payload) ?? this.getFingerprint(payload);
  }

  private getSemanticSnapshotSignature(eventType: string, payload: unknown): string | null {
    if (eventType === "project.execution.updated") {
      return this.getExecutionSnapshotSignature(payload);
    }
    if (eventType === "project.live.updated") {
      return this.getLiveSnapshotSignature(payload);
    }
    return null;
  }

  private getLiveSnapshotSignature(payload: unknown): string | null {
    if (!this.isObject(payload)) {
      return null;
    }

    const executionSignature = this.getExecutionSnapshotSignature(payload.execution);
    const statusSignature = this.getDashboardStatusSignature(payload.status);
    if (!executionSignature || !statusSignature) {
      return null;
    }

    return this.joinSignatureParts([
      "project.live.updated",
      this.signatureValue(payload.projectId),
      this.signatureValue(payload.selectedSprintId),
      statusSignature,
      executionSignature,
      this.getGitStatusSignature(payload.gitStatus),
      this.signatureValue(payload.gitStatusError),
    ]);
  }

  private getExecutionSnapshotSignature(payload: unknown): string | null {
    if (!this.isObject(payload)) {
      return null;
    }

    const sprintRuns = this.arrayField(payload, "sprintRuns");
    const taskDispatches = this.arrayField(payload, "taskDispatches");
    const connections = this.arrayField(payload, "connections");
    const overflowAssignedWorkers = this.arrayField(payload, "overflowAssignedWorkers");
    const attentionItems = this.arrayField(payload, "attentionItems");
    const recentEvents = this.arrayField(payload, "recentEvents");
    if (!sprintRuns || !taskDispatches || !connections || !overflowAssignedWorkers || !attentionItems || !recentEvents) {
      return null;
    }

    const recentInvocations = Array.isArray(payload.recentInvocations)
      ? payload.recentInvocations
      : [];

    return this.joinSignatureParts([
      "project.execution.updated",
      this.signatureValue(payload.projectId),
      this.signatureValue(payload.projectName),
      this.signatureCollection(sprintRuns, (item) => this.getSprintRunSignature(item)),
      this.signatureCollection(taskDispatches, (item) => this.getTaskDispatchSignature(item)),
      this.signatureCollection(connections, (item) => this.getConnectionSignature(item)),
      this.getAssignedWorkerSignature(payload.primaryAssignedWorker),
      this.signatureCollection(overflowAssignedWorkers, (item) => this.getAssignedWorkerSignature(item)),
      this.signatureCollection(attentionItems, (item) => this.getAttentionItemSignature(item)),
      this.signatureCollection(recentEvents, (item) => this.getRuntimeEventSignature(item)),
      this.signatureCollection(recentInvocations, (item) => this.getInvocationSignature(item)),
    ]);
  }

  private getDashboardStatusSignature(payload: unknown): string | null {
    if (!this.isObject(payload)) {
      return null;
    }
    const subtasks = this.arrayField(payload, "subtasks");
    if (!subtasks) {
      return null;
    }
    return this.joinSignatureParts([
      "status",
      this.signatureValue(payload.project_id),
      this.signatureValue(payload.sprint_id),
      this.signatureValue(payload.sprint_number),
      this.signatureValue(payload.source_id),
      this.signatureValue(payload.repo_path),
      this.signatureValue(payload.feature_branch),
      this.signatureCollection(subtasks, (item) => this.getSubtaskSignature(item)),
    ]);
  }

  private getSprintRunSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.sprintId),
      this.signatureValue(value.status),
      this.signatureValue(value.lastHeartbeatAt),
      this.signatureValue(value.activeLeaseOwnerKey),
      this.signatureValue(value.activeLeaseExpiresAt),
      this.signatureValue(value.finishedAt),
      this.getHumanInterventionSignature(value.humanIntervention),
    ]);
  }

  private getTaskDispatchSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.sprintRunId),
      this.signatureValue(value.taskId),
      this.signatureValue(value.status),
      this.signatureValue(value.taskRunState),
      this.signatureValue(value.provider),
      this.signatureValue(value.sessionId),
      this.signatureValue(value.workerBranch),
      this.signatureValue(value.prUrl),
      this.signatureValue(value.lastHeartbeatAt),
      this.signatureValue(value.activeLeaseOwnerKey),
      this.signatureValue(value.activeLeaseExpiresAt),
      this.signatureValue(value.errorMessage),
    ]);
  }

  private getConnectionSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.status),
      this.signatureValue(value.lastHeartbeatAt),
      this.signatureValue(value.activeDispatchCount),
      this.signatureValue(value.pendingInboxCount),
      this.signatureValue(value.tasksRunCount),
      this.signatureValue(value.messageCount),
    ]);
  }

  private getAssignedWorkerSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.assignmentId),
      this.signatureValue(value.workerEndpointId),
      this.signatureValue(value.status),
      this.signatureValue(value.lastAffinityAt),
      this.signatureValue(value.workerStatus),
    ]);
  }

  private getAttentionItemSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.sprintId),
      this.signatureValue(value.taskId),
      this.signatureValue(value.sprintRunId),
      this.signatureValue(value.dispatchId),
      this.signatureValue(value.attentionType),
      this.signatureValue(value.severity),
      this.signatureValue(value.ownerType),
      this.signatureValue(value.status),
      this.signatureValue(value.claimedAt),
      this.signatureValue(value.resolvedAt),
    ]);
  }

  private getHumanInterventionSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.title),
      this.signatureValue(value.reason),
      this.signatureValue(value.attentionType),
      this.signatureValue(value.severity),
      this.signatureValue(value.ownerType),
    ]);
  }

  private getRuntimeEventSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.scopeType),
      this.signatureValue(value.taskRunId),
      this.signatureValue(value.sprintRunId),
      this.signatureValue(value.dispatchId),
      this.signatureValue(value.eventType),
      this.signatureValue(value.sourceEventKey),
      this.signatureValue(value.sessionId),
      this.signatureValue(value.createdAt),
    ]);
  }

  private getInvocationSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.providerInvocationId),
      this.signatureValue(value.sprintRunId),
      this.signatureValue(value.dispatchId),
      this.signatureValue(value.taskRunId),
      this.signatureValue(value.attentionItemId),
      this.signatureValue(value.type),
      this.signatureValue(value.status),
      this.signatureValue(value.provider),
      this.signatureValue(value.model),
      this.signatureValue(value.startedAt),
      this.signatureValue(value.finishedAt),
      this.signatureValue(value.lastMessageAt),
      this.signatureValue(value.messageCount),
    ]);
  }

  private getSubtaskSignature(item: unknown): string {
    const value = this.objectOrEmpty(item);
    return this.joinSignatureParts([
      this.signatureValue(value.id),
      this.signatureValue(value.record_id),
      this.signatureValue(value.status),
      this.signatureValue(value.session_id),
      this.signatureValue(value.session_name),
      this.signatureValue(value.session_state),
      this.signatureValue(value.provider),
      this.signatureValue(value.model),
      this.signatureValue(value.worker_branch),
      this.signatureValue(value.pr_url),
      this.signatureValue(value.merge_indicator),
      this.signatureValue(value.intervention_owner),
    ]);
  }

  private getGitStatusSignature(payload: unknown): string {
    if (payload === null || payload === undefined) {
      return this.signatureValue(payload);
    }
    if (!this.isObject(payload)) {
      return this.signatureValue(payload);
    }
    return this.joinSignatureParts([
      this.signatureValue(payload.mode),
      this.signatureValue(payload.branch),
      this.signatureValue(payload.defaultBranch),
      this.signatureValue(payload.headSha),
      this.signatureValue(payload.upstreamSha),
      this.signatureValue(payload.hasUncommittedChanges),
      this.signatureValue(payload.ciStatus),
      this.signatureValue(payload.prUrl),
    ]);
  }

  private signatureCollection(items: unknown[], summarize: (item: unknown) => string): string {
    return this.joinSignatureParts([String(items.length), ...items.map((item) => summarize(item))]);
  }

  private signatureValue(value: unknown): string {
    if (value === null) {
      return "null";
    }
    if (value === undefined) {
      return "undefined";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return `${typeof value}:${String(value)}`;
    }
    if (this.isObject(value)) {
      return `object:${Object.keys(value).sort().join(",")}`;
    }
    return `${typeof value}:${String(value)}`;
  }

  private joinSignatureParts(parts: string[]): string {
    return parts.map((part) => `${part.length}:${part}`).join("|");
  }

  private arrayField(payload: SnapshotObject, key: string): unknown[] | null {
    const value = payload[key];
    return Array.isArray(value) ? value : null;
  }

  private objectOrEmpty(value: unknown): SnapshotObject {
    return this.isObject(value) ? value : {};
  }

  private isObject(value: unknown): value is SnapshotObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private getFingerprint(payload: unknown): string {
    return JSON.stringify(payload, (key, value) => {
      if (key === "updatedAt" || key === "timestamp") {
        return undefined;
      }
      return value;
    });
  }

  private broadcast(event: DashboardRealtimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("Dashboard realtime listener failed", {
          logPurpose: "realtime",
          eventType: event.eventType,
          sequence: event.sequence,
          scope: event.scope,
          projectId: event.projectId,
          correlationId: event.correlationId,
          error,
        });
      }
    }
  }
}

export function buildDashboardRealtimeScope(scopeType: DashboardRealtimeScopeType, scopeId: string): string {
  return scopeType === "overview" ? "overview" : `${scopeType}:${scopeId}`;
}
