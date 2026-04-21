import type { Logger } from "../../shared/logging/logger.js";
import type { RuntimeCleanupService } from "../../services/runtime-cleanup-service.js";
import type { SprintPreviewService } from "../../services/sprint-preview-service.js";
import type { DashboardRealtimeService } from "../../services/dashboard-realtime-service.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";

export interface RuntimeLoopOrchestratorOptions {
  runtimeCleanupService: RuntimeCleanupService;
  sprintPreviewService: SprintPreviewService;
  dashboardRealtimeService: DashboardRealtimeService;
  projectManagementRepository: ProjectManagementRepository;
  logger: Logger;
  runtimeRole: string;
}

export class RuntimeLoopOrchestrator {
  private static readonly RUNTIME_CLEANUP_INTERVAL_MS = 15_000;
  private static readonly LIVE_SNAPSHOT_REFRESH_INTERVAL_MS = 30_000;

  private runtimeCleanupInterval: ReturnType<typeof setInterval> | null = null;
  private sprintPreviewInterval: ReturnType<typeof setInterval> | null = null;
  private liveSnapshotInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: RuntimeLoopOrchestratorOptions) {}

  start(): void {
    if (this.options.runtimeRole !== "project_manager") {
      return;
    }

    this.startRuntimeCleanupLoop();
    this.startSprintPreviewLoop();
    this.startLiveSnapshotLoop();
  }

  stop(): void {
    if (this.runtimeCleanupInterval) {
      clearInterval(this.runtimeCleanupInterval);
      this.runtimeCleanupInterval = null;
    }
    if (this.sprintPreviewInterval) {
      clearInterval(this.sprintPreviewInterval);
      this.sprintPreviewInterval = null;
    }
    if (this.liveSnapshotInterval) {
      clearInterval(this.liveSnapshotInterval);
      this.liveSnapshotInterval = null;
    }
  }

  private startRuntimeCleanupLoop(): void {
    if (this.runtimeCleanupInterval) {
      return;
    }

    const runCleanup = (): void => {
      try {
        this.options.runtimeCleanupService.cleanup();
      } catch (error) {
        this.options.logger.error("Runtime cleanup sweep failed", { error });
      }
    };

    const initialTimer = setTimeout(runCleanup, 0);
    initialTimer.unref?.();
    this.runtimeCleanupInterval = setInterval(runCleanup, RuntimeLoopOrchestrator.RUNTIME_CLEANUP_INTERVAL_MS);
    this.runtimeCleanupInterval.unref?.();
  }

  private startSprintPreviewLoop(): void {
    if (this.sprintPreviewInterval) {
      return;
    }

    const reconcile = (): void => {
      void this.options.sprintPreviewService.reconcileSessions().catch((error) => {
        this.options.logger.error("Sprint preview reconciliation failed", { error });
      });
    };

    const initialTimer = setTimeout(reconcile, 0);
    initialTimer.unref?.();
    this.sprintPreviewInterval = setInterval(reconcile, RuntimeLoopOrchestrator.RUNTIME_CLEANUP_INTERVAL_MS);
    this.sprintPreviewInterval.unref?.();
  }

  private startLiveSnapshotLoop(): void {
    if (this.liveSnapshotInterval) {
      return;
    }

    const refreshLiveSnapshot = (): void => {
      const projectId = this.options.projectManagementRepository.getSelectedProjectId();
      if (!projectId) {
        return;
      }

      this.options.dashboardRealtimeService.scheduleProjectLiveRefresh(projectId);
    };

    const initialTimer = setTimeout(refreshLiveSnapshot, 0);
    initialTimer.unref?.();
    this.liveSnapshotInterval = setInterval(refreshLiveSnapshot, RuntimeLoopOrchestrator.LIVE_SNAPSHOT_REFRESH_INTERVAL_MS);
    this.liveSnapshotInterval.unref?.();
  }
}
