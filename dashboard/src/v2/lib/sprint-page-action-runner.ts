import type { SprintStatus } from "../types.js";

export interface SprintActionRunnerDeps {
  pendingActionIds: Set<string>;
  setPendingActionIds: (updater: (current: Set<string>) => Set<string>) => void;
  setOptimisticStatuses: (
    updater: (
      current: Record<string, SprintStatus>,
    ) => Record<string, SprintStatus>,
  ) => void;
  setSuppressedRunningSprintIds: (
    updater: (current: Set<string>) => Set<string>,
  ) => void;
  refresh: () => Promise<any>;
  refreshExecution: () => Promise<any>;
  setError: (error: string) => void;
  checkActiveRun?: (sprintId: string) => Promise<boolean>;
}

export class SprintPageActionRunner {
  constructor(private readonly deps: SprintActionRunnerDeps) {}

  async runAction(
    actionIds: string | string[],
    sprintId: string | null,
    operation: (availableActionIds: string[]) => Promise<void>,
    options: {
      optimisticStatus?: SprintStatus;
      waitForActiveRun?: boolean;
      rethrow?: boolean;
    } = {},
  ): Promise<void> {
    const ids = Array.isArray(actionIds) ? actionIds : [actionIds];
    const availableIds = ids.filter(
      (id) => !this.deps.pendingActionIds.has(id),
    );

    if (availableIds.length === 0) {
      return;
    }

    this.deps.setPendingActionIds((current) => {
      const next = new Set(current);
      for (const id of availableIds) {
        next.add(id);
      }
      return next;
    });

    if (options.optimisticStatus && sprintId) {
      this.deps.setOptimisticStatuses((current) => ({
        ...current,
        [sprintId]: options.optimisticStatus!,
      }));
    }

    try {
      await operation(availableIds);

      if (options.optimisticStatus === "cancelled" && sprintId) {
        this.deps.setSuppressedRunningSprintIds((current) =>
          new Set(current).add(sprintId),
        );
      }

      if (options.waitForActiveRun && sprintId && this.deps.checkActiveRun) {
        await this.deps.checkActiveRun(sprintId);
      }

      await Promise.all([this.deps.refresh(), this.deps.refreshExecution()]);

      if (options.optimisticStatus && sprintId) {
        this.deps.setOptimisticStatuses((current) => {
          const next = { ...current };
          delete next[sprintId];
          return next;
        });
      }
    } catch (error) {
      if (options.optimisticStatus && sprintId) {
        this.deps.setOptimisticStatuses((current) => {
          const next = { ...current };
          delete next[sprintId];
          return next;
        });
      }
      await Promise.all([this.deps.refresh(), this.deps.refreshExecution()]);
      this.deps.setError(error instanceof Error ? error.message : String(error));

      if (options.rethrow) {
        throw error;
      }
    } finally {
      this.deps.setPendingActionIds((current) => {
        const next = new Set(current);
        for (const id of availableIds) {
          next.delete(id);
        }
        return next;
      });
    }
  }
}
