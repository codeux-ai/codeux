import type { RuntimeStartupStateSnapshot, StartupAggregateStatus, StartupJobState } from "../../contracts/app-types.js";

export class RuntimeStartupState {
  private jobs = new Map<string, StartupJobState>();

  /**
   * Runs a background job without blocking the synchronous boot path.
   * Tracks its status from pending -> running -> completed/failed.
   *
   * @param name The name of the job
   * @param jobFn The asynchronous function to execute
   */
  public runBackgroundJob(name: string, jobFn: () => Promise<void>): void {
    const jobState: StartupJobState = {
      name,
      status: "pending",
      error: null,
      startedAt: null,
      finishedAt: null,
    };

    this.jobs.set(name, jobState);

    // Schedule the job without blocking execution
    setImmediate(() => {
      this.executeJob(name, jobFn).catch(() => {
        // Errors are already handled in executeJob, so we don't need to do anything here.
        // But we catch to prevent unhandled rejections if something in setImmediate itself fails.
      });
    });
  }

  private async executeJob(name: string, jobFn: () => Promise<void>): Promise<void> {
    const jobState = this.jobs.get(name);
    if (!jobState) {
      return;
    }

    jobState.status = "running";
    jobState.startedAt = new Date().toISOString();

    try {
      await jobFn();
      jobState.status = "completed";
    } catch (error) {
      jobState.status = "failed";
      jobState.error = error instanceof Error ? error.message : String(error);
    } finally {
      jobState.finishedAt = new Date().toISOString();
    }
  }

  /**
   * Returns an immutable snapshot of the current aggregate startup state.
   */
  public getSnapshot(): RuntimeStartupStateSnapshot {
    const jobsArray = Array.from(this.jobs.values()).map(job => ({ ...job }));

    let aggregateStatus: StartupAggregateStatus = "completed";

    if (jobsArray.length === 0) {
       aggregateStatus = "completed";
    } else if (jobsArray.some(job => job.status === "failed")) {
      aggregateStatus = "failed";
    } else if (jobsArray.some(job => job.status === "running")) {
      aggregateStatus = "running";
    } else if (jobsArray.some(job => job.status === "pending")) {
      // Technically if it's pending, it's either going to run or is waiting to run.
      // If none are running and none failed, but some are pending, we are pending.
      // However if some are running and some are pending, we are running (checked above).
      aggregateStatus = "pending";
    } else if (jobsArray.every(job => job.status === "completed")) {
      aggregateStatus = "completed";
    }

    return {
      status: aggregateStatus,
      jobs: jobsArray,
    };
  }
}
