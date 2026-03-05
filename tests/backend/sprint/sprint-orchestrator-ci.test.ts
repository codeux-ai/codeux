import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { buildTaskRunTag } from "../../../src/services/task-run-key.js";
import { buildDeps } from "./sprint-orchestrator.setup.js";

describe("SprintOrchestrator CI logic", () => {
  it("keeps completed tasks in work state while feature PR CI is failing when autofix wait is enabled", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: true,
        waitForJulesCiAutofix: true,
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 10,
          title: "Task PR",
          url: "https://example.com/pr/10",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-01",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: null,
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "failure" }],
        },
      ],
      ciRuns: [
        {
          id: 9001,
          name: "ci",
          workflowName: "CI",
          status: "completed",
          conclusion: "failure",
          event: "pull_request",
          headBranch: "worker/task-01",
          url: "https://example.com/run/9001",
          updatedAt: new Date().toISOString(),
          failedJobs: [
            {
              id: 7001,
              name: "test",
              conclusion: "failure",
              failedSteps: ["unit"],
              logExcerpt: "unit test failed: expected 1 to equal 2",
              logCommand: "gh run view 9001 --job 7001 --log-failed",
            },
          ],
        },
      ],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-autofix-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
      },
    ]);

    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/10", workerBranch: "worker/task-01" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("CI/Review Autofix Wait");
    expect(text).toContain("`01-task`");
    expect(text).toContain("`RUNNING`");
    expect(text).toContain("Failed jobs:");
    expect(deps.getCiStatusForScope).toHaveBeenCalled();
    expect(deps.sendSessionMessage).toHaveBeenCalled();
    expect(deps.sendSessionMessage).toHaveBeenCalledWith(
      "abc123",
      expect.stringContaining("Failed jobs: CI/test.")
    );
    expect(deps.sendSessionMessage).toHaveBeenCalledWith(
      "abc123",
      expect.stringContaining("unit test failed")
    );

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("escalates CI autofix after max retries with task id and PR link context", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      automationLevel: "FULL",
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: true,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 0,
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 42,
          title: "Task PR",
          url: "https://example.com/pr/42",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-01",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: null,
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "failure" }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-ci-escalation-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          provider: "jules",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/42", workerBranch: "worker/task-01" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("CI autofix retries exhausted");
    expect(text).toContain("`01-task`");
    expect(text).toContain("https://example.com/pr/42");
    expect(text).toContain("AGENT INTERVENTION NEEDED");
    expect(deps.sendSessionMessage).not.toHaveBeenCalled();

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto merges feature PR when checks are green and review blockers are clear", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        featurePrAutoMergeMode: "WHEN_GREEN",
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 12,
          title: "Task PR",
          url: "https://example.com/pr/12",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-01",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: "APPROVED",
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-automerge-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
      },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/12", workerBranch: "worker/task-01" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("Auto-Merged");
    expect(deps.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: tmpRoot, prNumber: 12 });

    const persisted = await fs.readFile(path.join(subtasksDir, "01-task.md"), "utf-8");
    expect(persisted).toContain("merged: true");
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto merges feature PR in always mode even when checks are pending", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        featurePrAutoMergeMode: "ALWAYS",
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 22,
          title: "Task PR",
          url: "https://example.com/pr/22",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-22",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: "APPROVED",
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "in_progress", conclusion: null }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-automerge-always-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
      },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/22", workerBranch: "worker/task-22" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("Auto-Merged");
    expect(text).toContain("mode: always");
    expect(deps.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: tmpRoot, prNumber: 22 });

    const persisted = await fs.readFile(path.join(subtasksDir, "01-task.md"), "utf-8");
    expect(persisted).toContain("merged: true");
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto merges feature PR without waiting for CI when feature CI wait is disabled", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: false,
        resolveAllCommentsBeforeFeatureMerge: true,
        featurePrAutoMergeMode: "WHEN_GREEN",
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 24,
          title: "Task PR",
          url: "https://example.com/pr/24",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-24",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: "APPROVED",
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "in_progress", conclusion: null }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-automerge-no-ci-wait-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
      },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/24", workerBranch: "worker/task-24" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("Auto-Merged");
    expect(deps.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: tmpRoot, prNumber: 24 });
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("keeps task running when worker branch is missing but PR is matched by pr_url and checks are pending", async () => {
    const { deps, listSessions, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        waitForCiBeforeFeatureMerge: true,
      },
    });
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      mode: "REMOTE",
      available: true,
      repositoryRoot: "/tmp/repo",
      branch: "feature/sprint1-implementation",
      hasRemote: true,
      dirty: false,
      openPullRequests: [
        {
          number: 20,
          title: "Task PR",
          url: "https://example.com/pr/20",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/task-20",
          baseRefName: "feature/sprint1-implementation",
          mergeStateStatus: null,
          reviewDecision: null,
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "in_progress", conclusion: null }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
      tracking: { scope: "FEATURE_PR_CI", label: "Feature PR CI", branch: "feature/sprint1-implementation" },
      warnings: [],
      lastUpdated: new Date().toISOString(),
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-pr-url-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        pr_url: "https://example.com/pr/20",
      },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: `Sprint 1: ${buildTaskRunTag(path.basename(path.resolve(tmpRoot)), "1", "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          prompt: "x",
          outputs: [{ pullRequest: { url: "https://example.com/pr/20" } }],
        },
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("CI/Review Merge Gate");
    expect(text).toContain("PR #20");
    expect(text).toContain("`RUNNING`");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

});
