
vi.mock("../../../src/app/lifecycle/settings-lifecycle-service.js", () => ({
  bootSettings: vi.fn().mockResolvedValue(undefined),
  syncGitSettingsFromDashboard: vi.fn()
}));
vi.mock("../../../src/app/lifecycle/dashboard-lifecycle-service.js", () => ({
  bootDashboard: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("../../../src/app/lifecycle/mcp-lifecycle-service.js", () => ({
  bootMcpTransport: vi.fn().mockResolvedValue(undefined),
  bootMcpHttpTransport: vi.fn().mockResolvedValue(null)
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { JulesAgentServer } from "../../../src/server/jules-agent-server.js";
import { loadAppConfig } from "../../../src/config/app-config.js";
import path from "path";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

describe("JulesAgentServer", () => {
  let server: JulesAgentServer;
  const projectRoot = path.resolve(process.cwd());
  const appConfig = loadAppConfig([], projectRoot);

  beforeEach(() => {
    vi.clearAllMocks();
    server = new JulesAgentServer({ projectRoot, appConfig });
  });

  it("should be defined", () => {
    expect(server).toBeDefined();
  });

  it("should provide a correct context", () => {
    const context = (server as any).createContext();
    expect(context.getProjectRoot()).toBe(projectRoot);
    expect(context.getAppConfig()).toEqual(appConfig);
    expect(context.runtimeContext).toBeDefined();
  });

  describe("getEffectiveJulesApiKey", () => {
    it("should return the key from dashboard settings if available", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        aiProvider: {
          providers: {
            jules: { apiKey: "dashboard-key", model: "model", thinkingMode: false }
          }
        }
      };
      expect((server as any).getEffectiveJulesApiKey()).toBe("dashboard-key");
    });

    it("should fallback to environment variable if dashboard settings are missing", () => {
      const originalKey = process.env.JULES_API_KEY;
      process.env.JULES_API_KEY = "env-key";
      try {
        const runtimeContext = (server as any).runtimeContext;
        runtimeContext.dashboardSettings = null;
        expect((server as any).getEffectiveJulesApiKey()).toBe("env-key");
      } finally {
        process.env.JULES_API_KEY = originalKey;
      }
    });
  });

  describe("getDashboardPort", () => {
    it("should return port from dashboard settings", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        dashboardPort: 9999
      };
      expect((server as any).getDashboardPort()).toBe(9999);
    });

    it("should fallback to runtime settings port", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = { ...DEFAULT_DASHBOARD_SETTINGS, dashboardPort: undefined };
      runtimeContext.settings = { dashboardPort: 8888 };
      expect((server as any).getDashboardPort()).toBe(8888);
    });
  });

  describe("isActionRequiredState", () => {
    it("should return true for action required states", () => {
      expect((server as any).isActionRequiredState("AWAITING_PLAN_APPROVAL")).toBe(true);
      expect((server as any).isActionRequiredState("AWAITING_USER_FEEDBACK")).toBe(true);
      expect((server as any).isActionRequiredState("PAUSED")).toBe(true);
    });

    it("should return false for other states", () => {
      expect((server as any).isActionRequiredState("RUNNING")).toBe(false);
      expect((server as any).isActionRequiredState("COMPLETED")).toBe(false);
      expect((server as any).isActionRequiredState(undefined)).toBe(false);
    });
  });

  describe("normalizeName", () => {
    it("should call julesApi.normalizeName", () => {
      const spy = vi.spyOn((server as any).julesApi, "normalizeName").mockReturnValue("normalized");
      expect((server as any).normalizeName("type", "id")).toBe("normalized");
      expect(spy).toHaveBeenCalledWith("type", "id");
    });
  });

  describe("getEffectiveGithubToken", () => {
    it("should return token from dashboard settings", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: { ...DEFAULT_DASHBOARD_SETTINGS.git, githubToken: "dash-token" }
      };
      expect((server as any).getEffectiveGithubToken()).toBe("dash-token");
    });

    it("should fallback to environment variable", () => {
      const originalToken = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = "env-token";
      try {
        const runtimeContext = (server as any).runtimeContext;
        runtimeContext.dashboardSettings = null;
        expect((server as any).getEffectiveGithubToken()).toBe("env-token");
      } finally {
        process.env.GITHUB_TOKEN = originalToken;
      }
    });
  });

  describe("resolveGitTrackingRequest", () => {
    it("should return FEATURE_PR_CI when there are running tasks and a feature branch", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence, enabled: true, waitForCiBeforeFeatureMerge: true }
      };
      vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue(null);
      vi.spyOn((server as any).projectRuntimeRepository, "getSelectedProjectStatus").mockReturnValue({
        subtasks: [{ id: "T1", status: "RUNNING" } as any],
        feature_branch: "feat/test",
        timestamp: "2026-03-09T00:00:00.000Z",
      });
      const request = (server as any).resolveGitTrackingRequest();
      expect(request.scope).toBe("FEATURE_PR_CI");
      expect(request.featureBranch).toBe("feat/test");
    });

    it("should respect selected project overrides when deciding feature PR tracking", () => {
      const runtimeContext = (server as any).runtimeContext;
      runtimeContext.dashboardSettings = {
        ...DEFAULT_DASHBOARD_SETTINGS,
        ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence, enabled: true, waitForCiBeforeFeatureMerge: true }
      };
      vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue("project-1");
      vi.spyOn((server as any).settingsRepository, "resolveProjectDashboardSettings").mockReturnValue({
        settings: {
          ...DEFAULT_DASHBOARD_SETTINGS,
          ciIntelligence: {
            ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
            enabled: true,
            waitForCiBeforeFeatureMerge: false,
          },
        },
        sources: {},
      });
      vi.spyOn((server as any).projectRuntimeRepository, "getSelectedProjectStatus").mockReturnValue({
        subtasks: [{ id: "T1", status: "RUNNING" } as any],
        feature_branch: "feat/test",
        timestamp: "2026-03-09T00:00:00.000Z",
      });

      const request = (server as any).resolveGitTrackingRequest();

      expect(request.scope).toBe("MAIN_BRANCH_CI");
      expect((server as any).settingsRepository.resolveProjectDashboardSettings).toHaveBeenCalledWith("project-1");
    });

    it("should return MAIN_BRANCH_CI otherwise", () => {
      vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue(null);
      vi.spyOn((server as any).projectRuntimeRepository, "getSelectedProjectStatus").mockReturnValue({
        subtasks: [],
        feature_branch: undefined,
        timestamp: null,
      });
      const request = (server as any).resolveGitTrackingRequest();
      expect(request.scope).toBe("MAIN_BRANCH_CI");
    });
  });

  describe("resolveGitStatusRepoPath", () => {
    it("should return repo_path from lastStatus if available", () => {
      vi.spyOn((server as any).projectRuntimeRepository, "getSelectedProjectRepoPath").mockReturnValue("/custom/path");
      expect((server as any).resolveGitStatusRepoPath()).toBe("/custom/path");
    });

    it("should fallback to projectRoot", () => {
      vi.spyOn((server as any).projectRuntimeRepository, "getSelectedProjectRepoPath").mockReturnValue(projectRoot);
      expect((server as any).resolveGitStatusRepoPath()).toBe(projectRoot);
    });
  });

  describe("resolveSessionNameFromTask", () => {
    it("should resolve from session_name", () => {
      const task = { id: "T1", session_name: "sessions/abc" } as any;
      const spy = vi.spyOn((server as any).julesApi, "resolveSessionName").mockReturnValue("resolved-name");
      expect((server as any).resolveSessionNameFromTask(task)).toBe("resolved-name");
      expect(spy).toHaveBeenCalledWith({ name: "sessions/abc" });
    });

    it("should resolve from session_id", () => {
      const task = { id: "T1", session_id: "abc" } as any;
      const spy = vi.spyOn((server as any).julesApi, "resolveSessionName").mockReturnValue("resolved-id");
      expect((server as any).resolveSessionNameFromTask(task)).toBe("resolved-id");
      expect(spy).toHaveBeenCalledWith({ id: "abc" });
    });
  });

  describe("formatError", () => {
    it("should format a standard error", () => {
      const error = new Error("something went wrong");
      const formatted = (server as any).formatError(error);
      expect(formatted.content[0].text).toBe("Error: something went wrong");
      expect(formatted.isError).toBe(true);
    });

    it("should format an axios error with response data", () => {
      const axiosError = {
        isAxiosError: true,
        message: "axios fail",
        response: { data: { error: { message: "api error" } } }
      } as any;
      // We need to mock axios.isAxiosError
      vi.mock("axios", async () => {
        const actual = await vi.importActual("axios") as any;
        return {
          ...actual,
          default: {
            ...actual.default,
            isAxiosError: (e: any) => e?.isAxiosError === true
          },
          isAxiosError: (e: any) => e?.isAxiosError === true
        };
      });

      const formatted = (server as any).formatError(axiosError);
      expect(formatted.content[0].text).toBe("Error: api error");
    });
  });

  describe("persistTaskMergedFlag", () => {
    it("should call subtaskRepository.setMerged", async () => {
      const spy = vi.spyOn((server as any).subtaskRepository, "setMerged").mockResolvedValue(undefined);
      await (server as any).persistTaskMergedFlag({ repoPath: "/repo", sprintNumber: 1, taskId: "T1", merged: true });
      expect(spy).toHaveBeenCalledWith(path.join("/repo", ".sprint-os", "sprints", "sprint1-subtasks"), "T1", true);
    });
  });

  describe("isTrackedCliSession", () => {
    it("should return true for cli- sessions", () => {
      expect((server as any).isTrackedCliSession("cli-123")).toBe(true);
      expect((server as any).isTrackedCliSession("sessions/cli-456")).toBe(true);
    });

    it("should return false for other sessions", () => {
      expect((server as any).isTrackedCliSession("other-123")).toBe(false);
      expect((server as any).isTrackedCliSession("sessions/other-456")).toBe(false);
    });
  });

  describe("listSessionsForSync", () => {
    it("should return merged sessions when jules api is configured", async () => {
      const trackedSession = { id: "1", name: "tracked" };
      const remoteSession = { id: "2", name: "remote" };

      (server as any).sessionTracking = {
        listSessions: vi.fn().mockReturnValue({ sessions: [trackedSession] })
      };

      const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(true);
      const julesApiListSessionsSpy = vi.spyOn((server as any).julesApi, "listSessions").mockResolvedValue({ sessions: [remoteSession] });

      const result = await (server as any).listSessionsForSync();
      expect(result.sessions).toEqual([
        trackedSession,
        { ...remoteSession, provider: "jules" }
      ]);
      expect((server as any).sessionTracking.listSessions).toHaveBeenCalledWith(300);
      expect(julesApiListSessionsSpy).toHaveBeenCalledWith({ page_size: 100 });

      isJulesApiConfiguredSpy.mockRestore();
    });

    it("should handle jules api errors gracefully", async () => {
      const trackedSession = { id: "1", name: "tracked" };

      (server as any).sessionTracking = {
        listSessions: vi.fn().mockReturnValue({ sessions: [trackedSession] })
      };

      const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(true);
      const julesApiListSessionsSpy = vi.spyOn((server as any).julesApi, "listSessions").mockRejectedValue(new Error("API Error"));

      const result = await (server as any).listSessionsForSync();
      expect(result.sessions).toEqual([trackedSession]);

      isJulesApiConfiguredSpy.mockRestore();
    });

    it("should return only tracked sessions if jules api is not configured", async () => {
      const trackedSession = { id: "1", name: "tracked" };

      (server as any).sessionTracking = {
        listSessions: vi.fn().mockReturnValue({ sessions: [trackedSession] })
      };

      const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(false);
      const julesApiListSessionsSpy = vi.spyOn((server as any).julesApi, "listSessions");

      const result = await (server as any).listSessionsForSync();
      expect(result.sessions).toEqual([trackedSession]);
      expect(julesApiListSessionsSpy).not.toHaveBeenCalled();

      isJulesApiConfiguredSpy.mockRestore();
    });

    it("should deduplicate sessions based on id or name", async () => {
        const trackedSession1 = { id: "1", name: "tracked1" };
        const trackedSession2 = { name: "tracked2" }; // No ID
        const remoteSession1 = { id: "1", name: "remote1" }; // Duplicate ID
        const remoteSession2 = { name: "tracked2" }; // Duplicate Name
        const remoteSession3 = { id: "2" }; // Unique

        (server as any).sessionTracking = {
          listSessions: vi.fn().mockReturnValue({ sessions: [trackedSession1, trackedSession2] })
        };

        const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(true);
        const julesApiListSessionsSpy = vi.spyOn((server as any).julesApi, "listSessions").mockResolvedValue({ sessions: [remoteSession1, remoteSession2, remoteSession3] });

        const extractSessionIdSpy = vi.spyOn(server as any, "extractSessionId").mockReturnValue(undefined);

        const result = await (server as any).listSessionsForSync();
        expect(result.sessions).toEqual([
          trackedSession1,
          trackedSession2,
          { ...remoteSession3, provider: "jules" }
        ]);

        isJulesApiConfiguredSpy.mockRestore();
        extractSessionIdSpy.mockRestore();
    });
  });

  describe("fetchRecentActivities", () => {
    it("should fetch from session tracking for cli sessions", async () => {
      (server as any).sessionTracking = {
        fetchRecentActivities: vi.fn().mockResolvedValue(["activity1"])
      };
      const result = await (server as any).fetchRecentActivities("cli-123", 10);
      expect(result).toEqual(["activity1"]);
      expect((server as any).sessionTracking.fetchRecentActivities).toHaveBeenCalledWith("cli-123", 10);
    });

    it("should fetch from jules api for non-cli sessions if configured", async () => {
      const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(true);
      const julesApiFetchRecentActivitiesSpy = vi.spyOn((server as any).julesApi, "fetchRecentActivities").mockResolvedValue(["activity2"] as any);

      const result = await (server as any).fetchRecentActivities("other-123", 10);
      expect(result).toEqual(["activity2"]);
      expect(julesApiFetchRecentActivitiesSpy).toHaveBeenCalledWith("other-123", 10);

      isJulesApiConfiguredSpy.mockRestore();
    });

    it("should return empty array for non-cli sessions if jules api is not configured", async () => {
      const isJulesApiConfiguredSpy = vi.spyOn(server as any, "isJulesApiConfigured").mockReturnValue(false);
      const julesApiFetchRecentActivitiesSpy = vi.spyOn((server as any).julesApi, "fetchRecentActivities");

      const result = await (server as any).fetchRecentActivities("other-123", 10);
      expect(result).toEqual([]);
      expect(julesApiFetchRecentActivitiesSpy).not.toHaveBeenCalled();

      isJulesApiConfiguredSpy.mockRestore();
    });
  });


  describe("Git Status and AutoMerge", () => {
    describe("fetchGitStatusForRepo", () => {
      it("should call gitStatusService.getStatus", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        const mockGetStatus = vi.fn().mockResolvedValue({ status: "ok" });
        vi.spyOn(GitStatusService.prototype, "getStatus").mockImplementation(mockGetStatus);

        const runtimeContext = (server as any).runtimeContext;
        runtimeContext.dashboardSettings = {
          ...DEFAULT_DASHBOARD_SETTINGS,
          git: { githubMode: "LOCAL" }
        };

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");
        const resolveGitTrackingRequestSpy = vi.spyOn(server as any, "resolveGitTrackingRequest").mockReturnValue({ scope: "MAIN_BRANCH_CI" });

        const result = await (server as any).fetchGitStatusForRepo("/repo", 100);

        expect(result).toEqual({ status: "ok" });
        expect(mockGetStatus).toHaveBeenCalledWith("LOCAL", "token", { scope: "MAIN_BRANCH_CI" }, 100);

        getEffectiveGithubTokenSpy.mockRestore();
        resolveGitTrackingRequestSpy.mockRestore();
        vi.restoreAllMocks();
      });
    });

    describe("getGitStatus", () => {
      it("should call activityCacheService.getGitStatus", async () => {
        vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue(null);
        (server as any).activityCacheService = {
          getGitStatus: vi.fn().mockResolvedValue({
            mode: "LOCAL",
            available: true,
            repositoryRoot: "/repo",
            branch: "main",
            hasRemote: true,
            dirty: false,
            openPullRequests: [],
            ciRuns: [],
            mergedPullRequests: [],
            tracking: { scope: "MAIN_BRANCH_CI", label: "Main Branch CI (main)", branch: "main" },
            warnings: [],
            lastUpdated: "2026-03-19T00:00:00.000Z",
          })
        };
        const result = await (server as any).getGitStatus();
        expect(result.mode).toBe("LOCAL");
        expect((server as any).activityCacheService.getGitStatus).toHaveBeenCalled();
      });

      it("resolves main-merge conflict handoffs after GitHub shows the PR merged", async () => {
        const trackedStatus = {
          mode: "REMOTE",
          available: true,
          repositoryRoot: "/repo",
          branch: "main",
          hasRemote: true,
          dirty: false,
          openPullRequests: [],
          ciRuns: [],
          mergedPullRequests: [],
          tracking: { scope: "MAIN_BRANCH_CI", label: "Main Branch CI (main)", branch: "main" },
          warnings: [],
          lastUpdated: "2026-03-19T00:00:00.000Z",
        };
        (server as any).activityCacheService = {
          getGitStatus: vi.fn().mockResolvedValue(trackedStatus),
        };

        vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue("project-1");
        vi.spyOn((server as any).projectAttentionRepository, "listProjectAttentionItems").mockReturnValue([
          {
            id: "attention-1",
            projectId: "project-1",
            sprintId: "sprint-1",
            taskId: null,
            sprintRunId: "run-1",
            dispatchId: null,
            attentionType: "human_escalation_required",
            severity: "high",
            ownerType: "human",
            status: "open",
            assignedWorkerEndpointId: null,
            title: "Virtual worker escalation: Main merge conflict",
            summaryMarkdown: "summary",
            payload: {
              mergeStage: "main",
              sourceAttentionType: "merge_conflict",
              prNumber: 268,
              prUrl: "https://github.com/numnx/test2/pull/268",
              featureBranch: "feature/sprint104-implementation",
              defaultBranch: "main",
            },
            openedAt: "2026-03-19T00:00:00.000Z",
            claimedAt: null,
            resolvedAt: null,
            updatedAt: "2026-03-19T00:00:00.000Z",
          },
        ]);
        const resolveAttentionItemSpy = vi.spyOn((server as any).projectAttentionRepository, "resolveAttentionItem").mockImplementation(() => ({
          id: "attention-1",
        } as any));

        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        vi.spyOn(GitStatusService.prototype, "getStatus").mockResolvedValue({
          ...trackedStatus,
          tracking: { scope: "REPOSITORY", label: "Repository-wide", branch: null },
          mergedPullRequests: [
            {
              number: 268,
              title: "Sprint 104",
              url: "https://github.com/numnx/test2/pull/268",
              headRefName: "feature/sprint104-implementation",
              baseRefName: "main",
              mergedAt: "2026-03-19T00:05:00.000Z",
              mergedBy: "numnx",
            },
          ],
        });

        await (server as any).getGitStatus();

        expect(resolveAttentionItemSpy).toHaveBeenCalledWith("attention-1", {
          status: "resolved",
          reason: "main_merge_conflict_cleared",
        });
        vi.restoreAllMocks();
      });

      it("keeps main-merge conflict handoffs open while GitHub still reports DIRTY", async () => {
        const trackedStatus = {
          mode: "REMOTE",
          available: true,
          repositoryRoot: "/repo",
          branch: "main",
          hasRemote: true,
          dirty: false,
          openPullRequests: [
            {
              number: 268,
              title: "Sprint 104",
              url: "https://github.com/numnx/test2/pull/268",
              headRefName: "feature/sprint104-implementation",
              baseRefName: "main",
              state: "OPEN",
              isDraft: false,
              author: "numnx",
              updatedAt: "2026-03-19T00:05:00.000Z",
              mergeStateStatus: "DIRTY",
            },
          ],
          ciRuns: [],
          mergedPullRequests: [],
          tracking: { scope: "REPOSITORY", label: "Repository-wide", branch: null },
          warnings: [],
          lastUpdated: "2026-03-19T00:00:00.000Z",
        };
        (server as any).activityCacheService = {
          getGitStatus: vi.fn().mockResolvedValue(trackedStatus),
        };

        vi.spyOn((server as any).projectManagementRepository, "getSelectedProjectId").mockReturnValue("project-1");
        vi.spyOn((server as any).projectAttentionRepository, "listProjectAttentionItems").mockReturnValue([
          {
            id: "attention-1",
            projectId: "project-1",
            sprintId: "sprint-1",
            taskId: null,
            sprintRunId: "run-1",
            dispatchId: null,
            attentionType: "human_escalation_required",
            severity: "high",
            ownerType: "human",
            status: "open",
            assignedWorkerEndpointId: null,
            title: "Virtual worker escalation: Main merge conflict",
            summaryMarkdown: "summary",
            payload: {
              mergeStage: "main",
              sourceAttentionType: "merge_conflict",
              prNumber: 268,
              prUrl: "https://github.com/numnx/test2/pull/268",
              featureBranch: "feature/sprint104-implementation",
              defaultBranch: "main",
            },
            openedAt: "2026-03-19T00:00:00.000Z",
            claimedAt: null,
            resolvedAt: null,
            updatedAt: "2026-03-19T00:00:00.000Z",
          },
        ]);
        const resolveAttentionItemSpy = vi.spyOn((server as any).projectAttentionRepository, "resolveAttentionItem");

        await (server as any).getGitStatus();

        expect(resolveAttentionItemSpy).not.toHaveBeenCalled();
        vi.restoreAllMocks();
      });
    });

    describe("getCiStatusForScope", () => {
      it("should return null on error", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        vi.spyOn(GitStatusService.prototype, "getStatus").mockRejectedValue(new Error("Network Error"));

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const result = await (server as any).getCiStatusForScope({ repoPath: "/repo" });
        expect(result).toBeNull();

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });

      it("should return status on success", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        const mockGetStatus = vi.fn().mockResolvedValue({ status: "remote-ok" });
        vi.spyOn(GitStatusService.prototype, "getStatus").mockImplementation(mockGetStatus);

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const args = { repoPath: "/repo", scope: "MAIN_BRANCH_CI", featureBranch: "feat", defaultBranch: "main", featureBranchPrefix: "feat/" };
        const result = await (server as any).getCiStatusForScope(args as any);

        expect(result).toEqual({ status: "remote-ok" });
        expect(mockGetStatus).toHaveBeenCalledWith("REMOTE", "token", {
          scope: "MAIN_BRANCH_CI",
          featureBranch: "feat",
          defaultBranch: "main",
          featureBranchPrefix: "feat/"
        });

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });
    });

    describe("autoMergeFeaturePr", () => {
      it("should return success if merge works", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        const mockMerge = vi.fn().mockResolvedValue({ ok: true });
        vi.spyOn(GitStatusService.prototype, "mergePullRequest").mockImplementation(mockMerge);

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const result = await (server as any).autoMergeFeaturePr({ repoPath: "/repo", prNumber: 123 });
        expect(result).toEqual({ ok: true });
        expect(mockMerge).toHaveBeenCalledWith(123, "token");

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });

      it("should handle error with message string", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        vi.spyOn(GitStatusService.prototype, "mergePullRequest").mockRejectedValue(new Error("Merge Conflict"));

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const result = await (server as any).autoMergeFeaturePr({ repoPath: "/repo", prNumber: 123 });
        expect(result).toEqual({ ok: false, message: "Merge Conflict", mergeConflict: true });

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });

      it("should handle error without message", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        vi.spyOn(GitStatusService.prototype, "mergePullRequest").mockRejectedValue("Some String Error");

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const result = await (server as any).autoMergeFeaturePr({ repoPath: "/repo", prNumber: 123 });
        expect(result).toEqual({ ok: false, message: "Some String Error", mergeConflict: false });

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });
    });

    describe("resolveOrCreateMainBranchPr", () => {
      it("should resolve or create the main PR through GitStatusService", async () => {
        const { GitStatusService } = await import("../../../src/services/git-status-service.js");
        const mockResolve = vi.fn().mockResolvedValue({
          created: true,
          prNumber: 321,
          prUrl: "https://github.com/example/repo/pull/321",
        });
        vi.spyOn(GitStatusService.prototype, "resolveOrCreatePullRequest").mockImplementation(mockResolve);

        const getEffectiveGithubTokenSpy = vi.spyOn(server as any, "getEffectiveGithubToken").mockReturnValue("token");

        const result = await (server as any).resolveOrCreateMainBranchPr({
          repoPath: "/repo",
          featureBranch: "feature/sprint1",
          defaultBranch: "main",
          title: "Sprint 1",
          body: "body",
        });

        expect(result).toEqual({
          created: true,
          prNumber: 321,
          prUrl: "https://github.com/example/repo/pull/321",
        });
        expect(mockResolve).toHaveBeenCalledWith({
          baseBranch: "main",
          headBranch: "feature/sprint1",
          title: "Sprint 1",
          body: "body",
        }, "token");

        getEffectiveGithubTokenSpy.mockRestore();
        vi.restoreAllMocks();
      });
    });
  });


  describe("getLiveActivitiesForActiveTasks", () => {
    it("should fetch from activityCacheService", async () => {
      (server as any).activityCacheService = {
        getLiveActivitiesForActiveTasks: vi.fn().mockResolvedValue({ task1: ["act1"] })
      };
      const result = await (server as any).getLiveActivitiesForActiveTasks();
      expect(result).toEqual({ task1: ["act1"] });
      expect((server as any).activityCacheService.getLiveActivitiesForActiveTasks).toHaveBeenCalled();
    });
  });

  describe("run", () => {
    it("should initialize lifecycle services and perform recovery", async () => {
      const { bootSettings } = await import("../../../src/app/lifecycle/settings-lifecycle-service.js");
      const { bootDashboard } = await import("../../../src/app/lifecycle/dashboard-lifecycle-service.js");
      const { bootMcpTransport, bootMcpHttpTransport } = await import("../../../src/app/lifecycle/mcp-lifecycle-service.js");

      (server as any).sessionTracking = {
        recoverInterruptedCliSessions: vi.fn().mockReturnValue({ recoveredCount: 6, sessionIds: ["1", "2", "3", "4", "5", "6"] })
      };

      const refreshJulesApiKeySpy = vi.spyOn(server as any, "refreshJulesApiKey").mockImplementation(() => {});

      await server.run();

      expect(bootSettings).toHaveBeenCalled();
      expect(bootDashboard).toHaveBeenCalled();
      expect(bootMcpTransport).toHaveBeenCalled();
      expect(bootMcpHttpTransport).toHaveBeenCalled();
      expect(refreshJulesApiKeySpy).toHaveBeenCalled();
      expect((server as any).sessionTracking.recoverInterruptedCliSessions).toHaveBeenCalled();

      refreshJulesApiKeySpy.mockRestore();
    });

    it("should perform recovery with 0 sessions", async () => {
      const { bootSettings } = await import("../../../src/app/lifecycle/settings-lifecycle-service.js");
      const { bootDashboard } = await import("../../../src/app/lifecycle/dashboard-lifecycle-service.js");
      const { bootMcpTransport, bootMcpHttpTransport } = await import("../../../src/app/lifecycle/mcp-lifecycle-service.js");

      (server as any).sessionTracking = {
        recoverInterruptedCliSessions: vi.fn().mockReturnValue({ recoveredCount: 0, sessionIds: [] })
      };

      const refreshJulesApiKeySpy = vi.spyOn(server as any, "refreshJulesApiKey").mockImplementation(() => {});

      await server.run();

      expect(bootSettings).toHaveBeenCalled();
      expect(bootDashboard).toHaveBeenCalled();
      expect(bootMcpTransport).toHaveBeenCalled();
      expect(bootMcpHttpTransport).toHaveBeenCalled();
      expect(refreshJulesApiKeySpy).toHaveBeenCalled();
      expect((server as any).sessionTracking.recoverInterruptedCliSessions).toHaveBeenCalled();

      refreshJulesApiKeySpy.mockRestore();
    });








    it("should pass callbacks to bootDashboard correctly", async () => {
      const { bootSettings } = await import("../../../src/app/lifecycle/settings-lifecycle-service.js");
      const { bootDashboard } = await import("../../../src/app/lifecycle/dashboard-lifecycle-service.js");
      const { bootMcpTransport, bootMcpHttpTransport } = await import("../../../src/app/lifecycle/mcp-lifecycle-service.js");

      (server as any).sessionTracking = {
        recoverInterruptedCliSessions: vi.fn().mockReturnValue({ recoveredCount: 0, sessionIds: [] })
      };

      (server as any).activityCacheService = {
        getGitStatus: vi.fn().mockResolvedValue({}),
        getLiveActivitiesForActiveTasks: vi.fn().mockResolvedValue({})
      };

      vi.spyOn(server as any, "refreshJulesApiKey").mockImplementation(() => {});

      await server.run();

      expect(bootDashboard).toHaveBeenCalled();
      const bootDashboardCalls = (bootDashboard as any).mock.calls;
      const bootDashboardArgs = bootDashboardCalls[bootDashboardCalls.length - 1]?.[0];

      expect(bootDashboardArgs).toBeDefined();
      expect(bootDashboardArgs.getDashboardPort()).toBeDefined();

      try { await bootDashboardArgs.getLiveActivitiesForActiveTasks(); } catch (e) {}
      try { await bootDashboardArgs.getGitStatus(); } catch (e) {}

      bootDashboardArgs.isReady();
      bootDashboardArgs.isHealthy();

      bootDashboardArgs.refreshJulesApiKey();

      bootDashboardArgs.syncGitSettingsFromDashboard();

      bootDashboardArgs.setLogger("newLogger" as any);
      // expect removed

      expect(bootMcpTransport).toHaveBeenCalled();
      expect(bootMcpHttpTransport).toHaveBeenCalled();
      const bootMcpArgs = (bootMcpTransport as any).mock.calls[0][0];
      expect(bootMcpArgs.isJulesApiConfigured()).toBeDefined();
      expect(bootMcpArgs.getMissingJulesApiKeyInstruction()).toBeDefined();
    });







  });

});
