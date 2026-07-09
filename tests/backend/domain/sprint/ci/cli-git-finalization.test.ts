import { describe, expect, it, vi } from "vitest";
import {
  CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT,
  hasCliGitFinalized,
  hasCliGitNoChanges,
  hasCliGitPushed,
  isCliTaskRunAwaitingGitFinalization,
  resolveCliGitPushedWorkerBranch,
} from "../../../../../src/domain/sprint/ci/cli-git-finalization.js";
import type { TaskRunRecord } from "../../../../../src/contracts/execution-types.js";

function cliTaskRun(): TaskRunRecord {
  return {
    id: "task-run-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskId: "task-1",
    sprintRunId: "run-1",
    dispatchId: "dispatch-1",
    connectionId: null,
    provider: "mockup-cli",
    mode: "docker_cli",
    sessionId: "cli-mockup-cli-1",
    sessionName: "sessions/cli-mockup-cli-1",
    state: "COMPLETED",
    workerBranch: "task/worker",
    prUrl: null,
    startedAt: null,
    finishedAt: null,
    durationMs: null,
  };
}

describe("CLI git finalization helpers", () => {
  it("scans beyond the old short event window for git-finalization evidence", () => {
    const events = Array.from({ length: 40 }, () => ({ eventType: "status_sync" }));
    events.push({ eventType: "cli_git_pushed" });
    const listTaskRunEvents = vi.fn().mockReturnValue(events);

    expect(hasCliGitFinalized(cliTaskRun(), listTaskRunEvents)).toBe(true);
    expect(isCliTaskRunAwaitingGitFinalization(cliTaskRun(), listTaskRunEvents)).toBe(false);
    expect(listTaskRunEvents).toHaveBeenCalledWith("task-run-1", CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  });

  it("keeps CLI task runs pending until a git-finalization event is recorded", () => {
    const listTaskRunEvents = vi.fn().mockReturnValue([
      { eventType: "cli_provider_completed" },
    ]);

    expect(hasCliGitFinalized(cliTaskRun(), listTaskRunEvents)).toBe(false);
    expect(isCliTaskRunAwaitingGitFinalization(cliTaskRun(), listTaskRunEvents)).toBe(true);
  });

  it("resolves pushed worker branch evidence from git finalization payloads", () => {
    const listTaskRunEvents = vi.fn().mockReturnValue([
      { eventType: "cli_git_pushed", payload: { pushedBranch: " task/feature-parent " } },
    ]);

    expect(hasCliGitPushed(cliTaskRun(), listTaskRunEvents)).toBe(true);
    expect(hasCliGitNoChanges(cliTaskRun(), listTaskRunEvents)).toBe(false);
    expect(resolveCliGitPushedWorkerBranch(cliTaskRun(), listTaskRunEvents)).toBe("task/feature-parent");
    expect(listTaskRunEvents).toHaveBeenCalledWith("task-run-1", CLI_GIT_FINALIZATION_EVENT_SCAN_LIMIT);
  });
});
