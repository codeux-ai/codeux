import { describe, expect, it } from "vitest";
import { RuntimeStartupState } from "../../../../src/app/lifecycle/runtime-startup-state.js";

describe("RuntimeStartupState", () => {
  it("initializes with a completed status when there are no jobs", () => {
    const state = new RuntimeStartupState();
    const snapshot = state.getSnapshot();

    expect(snapshot.status).toBe("completed");
    expect(snapshot.jobs).toHaveLength(0);
  });

  it("transitions a successful job through pending, running, and completed states", async () => {
    const state = new RuntimeStartupState();
    let resolveJob: () => void;
    let jobStarted = false;

    const jobPromise = new Promise<void>((resolve) => {
      resolveJob = resolve;
    });

    state.runBackgroundJob("test-job", async () => {
      jobStarted = true;
      await jobPromise;
    });

    // Should be pending initially since the microtask queue hasn't processed
    let snapshot = state.getSnapshot();
    expect(snapshot.status).toBe("pending");
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0].name).toBe("test-job");
    expect(snapshot.jobs[0].status).toBe("pending");

    // Let the event loop execute the setImmediate callback
    await new Promise((resolve) => setImmediate(resolve));

    // Now it should be running
    expect(jobStarted).toBe(true);
    snapshot = state.getSnapshot();
    expect(snapshot.status).toBe("running");
    expect(snapshot.jobs[0].status).toBe("running");
    expect(snapshot.jobs[0].startedAt).not.toBeNull();
    expect(snapshot.jobs[0].finishedAt).toBeNull();

    // Complete the job
    resolveJob!();

    // Let the promise chain resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now it should be completed
    snapshot = state.getSnapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.jobs[0].status).toBe("completed");
    expect(snapshot.jobs[0].error).toBeNull();
    expect(snapshot.jobs[0].startedAt).not.toBeNull();
    expect(snapshot.jobs[0].finishedAt).not.toBeNull();
  });

  it("transitions a failing job through pending, running, and failed states", async () => {
    const state = new RuntimeStartupState();
    let rejectJob: (err: Error) => void;

    const jobPromise = new Promise<void>((_, reject) => {
      rejectJob = reject;
    });

    state.runBackgroundJob("failing-job", async () => {
      await jobPromise;
    });

    // Let the setImmediate run so it starts running
    await new Promise((resolve) => setImmediate(resolve));

    let snapshot = state.getSnapshot();
    expect(snapshot.status).toBe("running");

    // Reject the job
    rejectJob!(new Error("Test error"));

    // Let the promise chain resolve
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now it should be failed
    snapshot = state.getSnapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0].status).toBe("failed");
    expect(snapshot.jobs[0].error).toBe("Test error");
    expect(snapshot.jobs[0].finishedAt).not.toBeNull();
  });

  it("reports aggregate status correctly with multiple jobs", async () => {
    const state = new RuntimeStartupState();

    state.runBackgroundJob("job-1", async () => {});
    state.runBackgroundJob("job-2", async () => {});

    // Initially both pending -> aggregate is pending
    expect(state.getSnapshot().status).toBe("pending");

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Both completed -> aggregate is completed
    expect(state.getSnapshot().status).toBe("completed");
    expect(state.getSnapshot().jobs).toHaveLength(2);
    expect(state.getSnapshot().jobs[0].status).toBe("completed");
    expect(state.getSnapshot().jobs[1].status).toBe("completed");

    // Add a new job that will stay running
    let resolveJob3: () => void;
    state.runBackgroundJob("job-3", async () => {
      await new Promise<void>((resolve) => { resolveJob3 = resolve; });
    });

    await new Promise((resolve) => setImmediate(resolve));

    // Now aggregate is running because one is running (others completed)
    expect(state.getSnapshot().status).toBe("running");

    // Add a failing job
    state.runBackgroundJob("job-4", async () => {
      throw new Error("Job 4 failed");
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Now aggregate is failed because one failed (even if another is running)
    expect(state.getSnapshot().status).toBe("failed");
    expect(state.getSnapshot().jobs[3].status).toBe("failed");

    // Clean up running job
    resolveJob3!();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("returns immutable snapshots", async () => {
    const state = new RuntimeStartupState();
    state.runBackgroundJob("job-1", async () => {});

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshot1 = state.getSnapshot();
    const snapshot2 = state.getSnapshot();

    expect(snapshot1).not.toBe(snapshot2);
    expect(snapshot1.jobs[0]).not.toBe(snapshot2.jobs[0]);
    expect(snapshot1).toEqual(snapshot2);

    // Modify the snapshot and ensure state doesn't change
    snapshot1.jobs[0].status = "pending";
    snapshot1.status = "pending";

    const snapshot3 = state.getSnapshot();
    expect(snapshot3.status).toBe("completed");
    expect(snapshot3.jobs[0].status).toBe("completed");
  });
});
