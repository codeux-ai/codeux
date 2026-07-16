import * as fs from "fs/promises";
import * as path from "path";
import { performance } from "node:perf_hooks";
import { getProjectLiveSnapshot, ProjectLiveSnapshotDeps } from "../src/app/live/project-live-snapshot.js";
import { DashboardRealtimeService } from "../src/services/dashboard-realtime-service.js";

async function main() {
  const fixturePath = path.resolve(process.cwd(), "scripts/fixtures/live-runtime-benchmark.json");
  const fixtureContent = await fs.readFile(fixturePath, "utf8");
  const fixtureData = JSON.parse(fixtureContent);

  console.log("Loading runtime benchmark fixture...");
  const projectId = fixtureData.projectId;

  const mockDeps: ProjectLiveSnapshotDeps = {
    projectManagementRepository: {
      getSelectedProjectId: () => fixtureData.projectId,
      getSelectedSprintId: () => fixtureData.selectedSprintId,
      sprintBelongsToProject: (_pid: string, sprintId: string) =>
        fixtureData.listSprintsResult.sprints.some((sprint: { id: string }) => sprint.id === sprintId),
      listSprints: (pid: string) => {
        return fixtureData.listSprintsResult;
      },
    } as any,
    projectRuntimeRepository: {
      getProjectStatus: (pid: string, sid: string | null) => {
        return fixtureData.status;
      },
    } as any,
    getProjectExecutionSnapshot: (pid: string) => {
      return fixtureData.execution;
    },
    getGitStatus: async () => {
      return fixtureData.gitStatus;
    },
    logger: {
      info: (event: string, meta?: any) => {
        if (event === "project_live_snapshot_assembled") {
          // Track these
          metrics.buildTimes.push(meta.buildTimeMs);
          metrics.projectMgmtMs.push(meta.projectMgmtMs);
          metrics.runtimeMs.push(meta.runtimeMs);
          metrics.executionMs.push(meta.executionMs);
          metrics.gitMs.push(meta.gitMs);

        }
      },
      warn: () => {},
      error: () => {},
      debug: () => {},
      child: () => mockDeps.logger,
    } as any,
  };

  const metrics = {
    buildTimes: [] as number[],
    projectMgmtMs: [] as number[],
    runtimeMs: [] as number[],
    executionMs: [] as number[],
    gitMs: [] as number[],

    executionSizeBytes: [] as number[],
    gitSizeBytes: [] as number[],
    statusSizeBytes: [] as number[],
    payloadSizeBytes: [] as number[],
    wallBuildTimes: [] as number[],
    publishCadenceMs: [] as number[],
  };

  const ITERATIONS = 1_000;
  console.log(`\nRunning ${ITERATIONS} iterations of snapshot assembly...`);

  for (let i = 0; i < ITERATIONS; i++) {
    const startedAt = performance.now();
    const snapshot = await getProjectLiveSnapshot(mockDeps, projectId);
    metrics.wallBuildTimes.push(performance.now() - startedAt);
    metrics.executionSizeBytes.push(Buffer.byteLength(JSON.stringify(snapshot.execution), "utf8"));
    metrics.gitSizeBytes.push(Buffer.byteLength(JSON.stringify(snapshot.gitStatus), "utf8"));
    metrics.statusSizeBytes.push(Buffer.byteLength(JSON.stringify(snapshot.status), "utf8"));
    metrics.payloadSizeBytes.push(Buffer.byteLength(JSON.stringify(snapshot), "utf8"));
  }

  const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  console.log("\n--- Snapshot Assembly Latency (Average) ---");
  console.log(`Measured Wall Time: ${avg(metrics.wallBuildTimes).toFixed(3)} ms`);
  console.log(`Instrumented Build Time: ${avg(metrics.buildTimes).toFixed(2)} ms`);
  console.log(`  |- Project Mgmt: ${avg(metrics.projectMgmtMs).toFixed(2)} ms`);
  console.log(`  |- Runtime Status: ${avg(metrics.runtimeMs).toFixed(2)} ms`);
  console.log(`  |- Execution State: ${avg(metrics.executionMs).toFixed(2)} ms`);
  console.log(`  |- Git Tracking: ${avg(metrics.gitMs).toFixed(2)} ms`);

  console.log("\n--- Snapshot Payload Sizes (Average) ---");
  console.log(`Total Payload Size: ${avg(metrics.payloadSizeBytes).toFixed(2)} bytes`);
  console.log(`  |- Execution Size: ${avg(metrics.executionSizeBytes).toFixed(2)} bytes`);
  console.log(`  |- Git Status Size: ${avg(metrics.gitSizeBytes).toFixed(2)} bytes`);
  console.log(`  |- Status Size: ${avg(metrics.statusSizeBytes).toFixed(2)} bytes`);

  console.log("\nTesting DashboardRealtimeService Publish Cadence...");

  const mockEventRepo = {
    appendEvent: (input: any) => ({ sequence: 1, ...input }),
    getLatestSequence: () => 1,
  };
  const mockRealtimeLogger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => mockRealtimeLogger,
  };

  const realtimeService = new DashboardRealtimeService(mockEventRepo as any, mockRealtimeLogger as any);
  realtimeService.setSnapshotLoaders({
    getProjectLiveSnapshot: (pid: string) => getProjectLiveSnapshot(mockDeps, pid),
    getProjectsSnapshot: () => ({} as any),
    getProjectExecutionSnapshot: () => ({} as any),
    getProjectStatusSnapshot: () => ({} as any),
    getOverviewTelemetrySnapshot: () => ({} as any),
  });

  const publishStart = Date.now();
  let publishCount = 0;

  realtimeService.subscribe((event) => {
    if (event.eventType === "project.live.updated") {
      publishCount++;
      metrics.publishCadenceMs.push(Date.now() - publishStart);
    }
  });

  // Schedule a refresh and force flush
  realtimeService.scheduleProjectLiveRefresh(projectId);

  // Wait a bit to ensure flush occurs (setTimeout inside realtimeService)
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log("\n--- DashboardRealtimeService Publish Cadence ---");
  console.log(`Published ${publishCount} event(s) in ~100ms interval.`);

  console.log("\nBenchmark complete.");
  process.exit(0);
}

main().catch(err => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
