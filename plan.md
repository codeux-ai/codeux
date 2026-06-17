
1.  **Add `DashboardSnapshotCacheInvalidator` interface to `src/services/dashboard-realtime-service.ts`**
    *   Add an interface `export interface DashboardSnapshotCacheInvalidator { invalidateProjectExecution(projectId: string): void; invalidateProjectStats(projectId: string): void; invalidateOverview(): void; invalidateProjects(): void; }`.
    *   Add `private cacheInvalidator: DashboardSnapshotCacheInvalidator | null = null;` and `setCacheInvalidator(invalidator: DashboardSnapshotCacheInvalidator): void` to `DashboardRealtimeService`.

2.  **Synchronous Invalidation in `DashboardRealtimeService`**
    *   Modify `scheduleProjectExecutionRefresh` to call `this.cacheInvalidator?.invalidateProjectExecution(projectId); this.cacheInvalidator?.invalidateProjectStats(projectId);`.
    *   Modify `scheduleOverviewRefresh` to call `this.cacheInvalidator?.invalidateOverview();`.
    *   Modify `scheduleProjectsRefresh` to call `this.cacheInvalidator?.invalidateProjects();`.

3.  **Inject the cache invalidator**
    *   In `src/app/lifecycle/dashboard-lifecycle-service.ts`, remove the `.subscribe(cache.invalidateFromEvent)`.
    *   Add `deps.dashboardRealtimeService.setCacheInvalidator(cache);`.

4.  **Restore `src/app/lifecycle/dashboard-snapshot-cache.ts`**
    *   Remove the added `invalidateFromEvent` and its import, leaving the file nearly identical to original (except it now implicitly implements the interface we added).

5.  **Fix tests**
    *   Update `tests/backend/app/lifecycle/dashboard-snapshot-cache.test.ts` to use the previous assertions without `invalidateFromEvent`.
    *   Add tests to `tests/backend/services/dashboard-realtime-service.test.ts` demonstrating that scheduling methods call the injected cache invalidator synchronously.

6.  **Pre commit**
    *   Run tests.
