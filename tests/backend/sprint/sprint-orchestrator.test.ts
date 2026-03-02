import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";

const buildDeps = () => {
  const listSessions = vi.fn();
  const loadSubtasks = vi.fn<() => Promise<Subtask[]>>();
  const getGuideContent = vi.fn().mockResolvedValue("guide");

  const deps = {
    settings: { maxFailures: 5 },
    dashboardPort: 4444,
    completedSprints: new Set<number>(),
    getConsecutiveFailures: () => 0,
    setConsecutiveFailures: vi.fn(),
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    fetchRecentActivities: vi.fn().mockResolvedValue([]),
    listSessions,
    loadSubtasks,
    startTask: vi.fn(),
    getGuideContent,
    updateLastStatus: vi.fn(),
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    isJulesApiConfigured: () => true,
    approveSessionPlan: vi.fn().mockResolvedValue({}),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    getCiStatusForScope: vi.fn().mockResolvedValue(null),
    autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
    renderInstruction: vi.fn(async (templateId: string, variables: Record<string, unknown>) => {
      if (templateId === "planningMissing" && typeof variables.subtasks_dir === "string") {
        return `### 🛑 ACTION REQUIRED: Sprint Planning Missing\n\nNo subtasks found in \`${variables.subtasks_dir}\`.`;
      }
      if (templateId === "branchMissing" && typeof variables.feature_branch === "string") {
        return `### 🛑 ACTION REQUIRED: Branch Configuration Missing\n\nThe feature branch \`${variables.feature_branch}\` is not ready.`;
      }
      if (templateId === "actionRequiredAgentHeader") {
        return "\n### 🤖 AGENT INTERVENTION NEEDED\n";
      }
      if (templateId === "actionRequiredAgentTask" || templateId === "actionRequiredHumanTask") {
        return `- **Task ${variables.task_id}** is \`${variables.session_state}\`.`;
      }
      if (templateId === "actionRequiredHumanHeader") {
        return "\n### ✋ HUMAN INTERVENTION NEEDED\n";
      }
      if (templateId === "watchHeader") {
        return "### Sprint Header";
      }
      return "";
    }),
  };

  return { deps, listSessions, loadSubtasks, getGuideContent };
};

describe("SprintOrchestrator", () => {
  it("returns setup guidance when all providers are disabled", async () => {
    const { deps } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      aiProvider: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
        providers: {
          jules: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules, enabled: false },
          gemini: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini, enabled: false },
          codex: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex, enabled: false },
          "claude-code": { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"], enabled: false },
        },
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("Provider Setup Required");
    expect(result.content[0].text).toContain("No AI providers are enabled");
  });

  it("returns branch configuration blocker for plan when feature branch is missing", async () => {
    const { deps } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/definitely/missing-repo",
      source_id: "sources/123",
      action: "plan",
      wait: false,
    });

    expect(result.content[0].text).toContain("Branch Configuration Missing");
    expect(result.content[0].text).toContain("feature/sprint1-implementation");
  });

  it("marks actionable session states as blocked and emits instructions", async () => {
    const { deps, listSessions, loadSubtasks } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-test-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
          state: "AWAITING_USER_FEEDBACK",
          prompt: "x",
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
    expect(text).toContain("HUMAN INTERVENTION NEEDED");
    expect(text).toContain("AWAITING_USER_FEEDBACK");
    expect(text).toContain("`BLOCKED`");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto-answers clarification in FULL automation mode", async () => {
    const { deps, listSessions, loadSubtasks } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      automationLevel: "FULL",
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-full-auto-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: "Sprint 1: [01-task] Test task",
          state: "AWAITING_USER_FEEDBACK",
          provider: "jules",
          prompt: "x",
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
    expect(text).toContain("Auto-Answered Clarification");
    expect(deps.sendSessionMessage).toHaveBeenCalledWith(
      "abc123",
      expect.stringContaining("Proceed with the safest implementation path")
    );

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("routes blocked tasks to agent intervention when auto-intervention fails", async () => {
    const { deps, listSessions, loadSubtasks } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      automationLevel: "FULL",
    });
    deps.sendSessionMessage = vi.fn().mockRejectedValue(new Error("temporary Jules API error"));
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-agent-intervention-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: "Sprint 1: [01-task] Test task",
          state: "AWAITING_USER_FEEDBACK",
          provider: "jules",
          prompt: "x",
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
    expect(text).toContain("AGENT INTERVENTION NEEDED");
    expect(text).toContain("Auto-Intervention Failed");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("keeps completed tasks in work state while feature PR CI is failing when autofix wait is enabled", async () => {
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
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
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
      { id: "01-task", title: "Test task", prompt: "Do it", depends_on: [], is_independent: true },
    ]);
    listSessions.mockResolvedValue({
      sessions: [
        {
          id: "abc123",
          name: "sessions/abc123",
          title: "Sprint 1: [01-task] Test task",
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
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
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
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
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
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
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
    const { deps, listSessions, loadSubtasks } = buildDeps();
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

    loadSubtasks.mockResolvedValue([
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
          title: "Sprint 1: [01-task] Test task",
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

  it("returns intermediate watch output when watch loop output interval is reached", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValueOnce(0).mockReturnValue(61_000);
      const { deps, loadSubtasks } = buildDeps();
      deps.getDashboardSettings = () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        sprintLoopSteps: {
          ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
          branchPreflight: false,
          planningPreflight: false,
          sessionSync: false,
          statusDerivation: false,
          startReadyTasks: false,
          watchLoop: true,
          watchLoopIntervalSeconds: 30,
          watchLoopOutputIntervalSeconds: 60,
        },
      });
      deps.renderInstruction = vi.fn(async (templateId: string) => {
        if (templateId === "watchHeader") return "### Sprint Header";
        if (templateId === "watchContinue") return "WATCH_CONTINUE";
        return "";
      });

      const orchestrator = new SprintOrchestrator(deps as any);
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-watch-"));
      const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
      await fs.mkdir(subtasksDir, { recursive: true });
      await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

      loadSubtasks.mockResolvedValue([
        {
          id: "01-task",
          title: "Test task",
          prompt: "Do it",
          depends_on: [],
          is_independent: false,
          status: "RUNNING",
        },
      ]);

      const executePromise = orchestrator.execute({
        sprint_number: 1,
        repo_path: tmpRoot,
        source_id: "sources/123",
        action: "orchestrate",
        wait: true,
      });

      const result = await executePromise;
      const text = result.content[0].text as string;
      expect(text).toContain("WATCH_CONTINUE");
      expect(text).not.toContain("Sprint Execution Finished");
      expect(deps.renderInstruction).toHaveBeenCalledWith(
        "watchContinue",
        expect.objectContaining({
          action: "orchestrate",
          running_tasks: 1,
        }),
        tmpRoot
      );

      await fs.rm(tmpRoot, { recursive: true, force: true });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("forces single-cycle execution for status even when wait=true", async () => {
    const { deps, loadSubtasks } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: {
        ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
        sessionSync: false,
        statusDerivation: false,
        startReadyTasks: false,
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-status-nowait-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ]);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: true,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("Status Action is Instant");
    expect(text).not.toContain("Sprint Header");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
