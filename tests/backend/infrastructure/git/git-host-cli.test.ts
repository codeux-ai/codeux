import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createGitHostCli, GithubApiHostCli, GitlabApiHostCli } from "../../../../src/infrastructure/git/git-host-cli.js";

// ─── Existing CLI tests ───────────────────────────────────────────────────────

describe("GitHostCli", () => {
  const repoPath = "/test/repo";

  describe("GithubHostCli", () => {
    it("should invoke gh with standard arguments", async () => {
      const runner = vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: "{}", stderr: "" });
      const cli = createGitHostCli("github", runner, repoPath);

      await cli.prListOpen("gh-token");
      expect(runner).toHaveBeenCalledWith("gh", [
        "pr", "list", "--state", "open", "--limit", "50", "--json",
        "number,title,url,state,isDraft,headRefName,baseRefName,mergeStateStatus,reviewDecision,updatedAt,comments,statusCheckRollup"
      ], { cwd: repoPath, hostToken: "gh-token" });
    });
  });

  describe("GitlabHostCli", () => {
    it("should invoke glab with mapped JSON output for PR list", async () => {
      const gitlabResponse = [
        {
          iid: 42,
          title: "Test MR",
          web_url: "https://gitlab.com/test",
          draft: false,
          source_branch: "feat",
          target_branch: "main",
          has_conflicts: false,
          detailed_merge_status: "mergeable",
          updated_at: "2023-10-01",
          user_notes_count: 5
        }
      ];

      const runner = vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: JSON.stringify(gitlabResponse), stderr: "" });
      const cli = createGitHostCli("gitlab", runner, repoPath);

      const result = await cli.prListOpen("glab-token");
      expect(runner).toHaveBeenCalledWith("glab", [
        "mr", "list", "--state", "opened", "--per-page", "50", "--output", "json"
      ], { cwd: repoPath, hostToken: "glab-token" });

      const parsed = JSON.parse(result.stdout);
      expect(parsed[0]).toEqual({
        number: 42,
        title: "Test MR",
        url: "https://gitlab.com/test",
        state: "OPEN",
        isDraft: false,
        headRefName: "feat",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        reviewDecision: null,
        updatedAt: "2023-10-01",
        comments: 5,
        statusCheckRollup: []
      });
    });

    it("should invoke glab for CI list and map JSON", async () => {
      const gitlabResponse = [
        {
          id: 123,
          name: "Test Pipeline",
          status: "success",
          source: "push",
          ref: "main",
          web_url: "https://gitlab.com/pipe",
          updated_at: "2023-10-02"
        }
      ];

      const runner = vi.fn().mockResolvedValue({ ok: true, code: 0, stdout: JSON.stringify(gitlabResponse), stderr: "" });
      const cli = createGitHostCli("gitlab", runner, repoPath);

      const result = await cli.runList("glab-token");
      const parsed = JSON.parse(result.stdout);
      expect(parsed[0]).toEqual({
        databaseId: 123,
        name: "Test Pipeline",
        workflowName: null,
        status: "completed",
        conclusion: "success",
        event: "push",
        headBranch: "main",
        url: "https://gitlab.com/pipe",
        updatedAt: "2023-10-02"
      });
    });
  });

  describe("LocalHostCli", () => {
    it("should return unavailable for local provider", async () => {
      const cli = createGitHostCli("local", vi.fn(), repoPath);
      const res = await cli.prListOpen();
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain("unavailable");
    });
  });
});

// ─── GithubApiHostCli tests ───────────────────────────────────────────────────

describe("GithubApiHostCli", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
    let idx = 0;
    fetchMock.mockImplementation(async () => {
      const resp = responses[idx++] ?? responses[responses.length - 1];
      return {
        ok: resp.ok,
        status: resp.status ?? (resp.ok ? 200 : 400),
        text: async () => (typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body)),
      };
    });
  }

  const cli = new GithubApiHostCli("owner", "repo");

  describe("version / authStatus", () => {
    it("returns ok when token is valid", async () => {
      mockFetch([{ ok: true, body: { login: "user" } }]);
      const res = await cli.version("tok");
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("github-api-host-cli");
    });

    it("returns error without token", async () => {
      const res = await cli.version();
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/token required/i);
    });

    it("returns error on API failure", async () => {
      mockFetch([{ ok: false, status: 401, body: { message: "Bad credentials" } }]);
      const res = await cli.version("bad-token");
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain("Bad credentials");
    });
  });

  describe("prListOpen", () => {
    it("maps GitHub REST response to gh-compatible shape", async () => {
      const prList = [
        {
          number: 10,
          title: "My PR",
          html_url: "https://github.com/owner/repo/pull/10",
          state: "open",
          draft: false,
          head: { ref: "feature-branch", sha: "abc123" },
          base: { ref: "main" },
          mergeable_state: "clean",
          updated_at: "2024-01-01T00:00:00Z",
          comments: 2,
          review_comments: 1,
        },
      ];
      const checkRuns = { check_runs: [{ name: "CI", status: "completed", conclusion: "success" }] };
      const reviews = [{ user: { login: "alice" }, state: "APPROVED" }];

      // Fetch sequence: prList → check-runs for PR 10 → reviews for PR 10
      mockFetch([
        { ok: true, body: prList },
        { ok: true, body: checkRuns },
        { ok: true, body: reviews },
      ]);

      const res = await cli.prListOpen("tok");
      expect(res.ok).toBe(true);

      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        number: 10,
        title: "My PR",
        url: "https://github.com/owner/repo/pull/10",
        state: "OPEN",
        isDraft: false,
        headRefName: "feature-branch",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        comments: 3,
        statusCheckRollup: [{ name: "CI", status: "completed", conclusion: "success" }],
      });
    });

    it("sets reviewDecision to CHANGES_REQUESTED when any reviewer requested changes", async () => {
      const prList = [{ number: 1, title: "PR", html_url: "https://g.c/p/1", state: "open", draft: false,
        head: { ref: "f", sha: "s1" }, base: { ref: "main" }, mergeable_state: "blocked",
        updated_at: "2024-01-01T00:00:00Z", comments: 0, review_comments: 0 }];
      const reviews = [
        { user: { login: "alice" }, state: "APPROVED" },
        { user: { login: "bob" }, state: "CHANGES_REQUESTED" },
      ];

      mockFetch([{ ok: true, body: prList }, { ok: true, body: [] }, { ok: true, body: reviews }]);

      const res = await cli.prListOpen("tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0].reviewDecision).toBe("CHANGES_REQUESTED");
      expect(parsed[0].mergeStateStatus).toBe("BLOCKED");
    });

    it("leaves statusCheckRollup empty and reviewDecision null when sub-requests fail", async () => {
      const prList = [{ number: 2, title: "PR", html_url: "https://g.c/p/2", state: "open", draft: false,
        head: { ref: "f", sha: "s2" }, base: { ref: "main" }, mergeable_state: "clean",
        updated_at: "2024-01-01T00:00:00Z", comments: 0, review_comments: 0 }];

      mockFetch([
        { ok: true, body: prList },
        { ok: false, status: 500, body: { message: "error" } },
        { ok: false, status: 500, body: { message: "error" } },
      ]);

      const res = await cli.prListOpen("tok");
      expect(res.ok).toBe(true);
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0].statusCheckRollup).toEqual([]);
      expect(parsed[0].reviewDecision).toBeNull();
    });

    it("returns error without token", async () => {
      const res = await cli.prListOpen();
      expect(res.ok).toBe(false);
    });
  });

  describe("prListOpenMatching", () => {
    it("filters by base and head, returns number and url", async () => {
      const prList = [{ number: 5, html_url: "https://g.c/p/5" }];
      mockFetch([{ ok: true, body: prList }]);

      const res = await cli.prListOpenMatching("main", "feature", "tok");
      expect(res.ok).toBe(true);
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toEqual([{ number: 5, url: "https://g.c/p/5" }]);

      // Verify head is encoded as owner:branch
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("head=owner%3Afeature");
      expect(calledUrl).toContain("base=main");
    });
  });

  describe("prCreate", () => {
    it("returns PR URL on success", async () => {
      mockFetch([{ ok: true, body: { number: 99, html_url: "https://g.c/p/99" } }]);
      const res = await cli.prCreate("main", "feat", "My PR", "body", "tok");
      expect(res.ok).toBe(true);
      expect(res.stdout).toBe("https://g.c/p/99");
    });

    it("returns error message from GitHub on failure", async () => {
      mockFetch([{ ok: false, status: 422, body: { message: "Validation Failed" } }]);
      const res = await cli.prCreate("main", "feat", "PR", "", "tok");
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain("Validation Failed");
    });
  });

  describe("runList", () => {
    it("maps workflow_runs to expected shape", async () => {
      const runs = {
        workflow_runs: [
          { id: 111, name: "CI", status: "completed", conclusion: "failure",
            event: "push", head_branch: "main", html_url: "https://g.c/r/111", updated_at: "2024-01-02T00:00:00Z" },
        ],
      };
      mockFetch([{ ok: true, body: runs }]);

      const res = await cli.runList("tok");
      expect(res.ok).toBe(true);
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0]).toMatchObject({
        databaseId: 111,
        name: "CI",
        workflowName: "CI",
        status: "completed",
        conclusion: "failure",
        event: "push",
        headBranch: "main",
      });
    });
  });

  describe("prListMerged", () => {
    it("filters out non-merged closed PRs and maps fields", async () => {
      const prs = [
        { number: 7, title: "Merged", html_url: "https://g.c/p/7", merged_at: "2024-01-01T00:00:00Z",
          head: { ref: "feat" }, base: { ref: "main" }, merged_by: { login: "alice" } },
        { number: 8, title: "Closed not merged", html_url: "https://g.c/p/8", merged_at: null,
          head: { ref: "other" }, base: { ref: "main" }, merged_by: null },
      ];
      mockFetch([{ ok: true, body: prs }]);

      const res = await cli.prListMerged("tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toMatchObject({
        number: 7,
        headRefName: "feat",
        baseRefName: "main",
        mergedAt: "2024-01-01T00:00:00Z",
        mergedBy: { login: "alice" },
      });
    });
  });

  describe("runViewJobs", () => {
    it("maps jobs and adds databaseId field", async () => {
      const data = {
        jobs: [
          { id: 999, name: "build", status: "completed", conclusion: "failure",
            steps: [{ name: "Run tests", status: "completed", conclusion: "failure" }] },
        ],
      };
      mockFetch([{ ok: true, body: data }]);

      const res = await cli.runViewJobs(123, "tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed.jobs[0]).toMatchObject({
        id: 999,
        databaseId: 999,
        name: "build",
        conclusion: "failure",
        steps: [{ name: "Run tests", conclusion: "failure" }],
      });
    });
  });

  describe("runViewLogFailed", () => {
    it("returns raw log text as stdout", async () => {
      mockFetch([{ ok: true, body: "2024-01-01T00:00:00Z ERROR: something failed" }]);
      const res = await cli.runViewLogFailed(1, 999, "tok");
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("ERROR: something failed");
    });
  });

  describe("prMerge", () => {
    it("fetches PR, merges, and deletes branch", async () => {
      // Sequence: GET pr details → PUT merge → DELETE branch
      mockFetch([
        { ok: true, body: { number: 10, head: { ref: "feat-branch" } } },
        { ok: true, body: { sha: "abc", merged: true, message: "Pull Request successfully merged" } },
        { ok: true, status: 204, body: "" },
      ]);

      const res = await cli.prMerge(10, "tok");
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("successfully merged");

      // DELETE call should target the branch ref
      const deleteCall = fetchMock.mock.calls[2];
      expect(deleteCall[0]).toContain("git/refs/heads/feat-branch");
      expect(deleteCall[1].method).toBe("DELETE");
    });

    it("returns error with GitHub message on merge conflict", async () => {
      mockFetch([
        { ok: true, body: { number: 10, head: { ref: "feat" } } },
        { ok: false, status: 405, body: { message: "Pull Request is not mergeable" } },
      ]);

      const res = await cli.prMerge(10, "tok");
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain("Pull Request is not mergeable");
    });

    it("succeeds even if branch deletion fails", async () => {
      mockFetch([
        { ok: true, body: { number: 10, head: { ref: "feat" } } },
        { ok: true, body: { merged: true } },
        { ok: false, status: 422, body: { message: "Reference does not exist" } },
      ]);

      const res = await cli.prMerge(10, "tok");
      expect(res.ok).toBe(true);
    });

    it("returns error without token", async () => {
      const res = await cli.prMerge(10);
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/token required/i);
    });
  });

  describe("createGitHostCli with preferApi=true", () => {
    it("returns GithubApiHostCli for github provider when preferApi=true", () => {
      const cli = createGitHostCli("github", vi.fn(), "/repo", null, "owner/repo", true);
      expect(cli).toBeInstanceOf(GithubApiHostCli);
    });

    it("falls back to GithubHostCli when repoTarget is missing", () => {
      const runner = vi.fn();
      const cli = createGitHostCli("github", runner, "/repo", null, null, true);
      // Falls back to CLI — confirm it calls gh
      cli.version();
      expect(runner).toHaveBeenCalledWith("gh", ["--version"], expect.anything());
    });
  });
});

// ─── GitlabApiHostCli tests ───────────────────────────────────────────────────

describe("GitlabApiHostCli", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(responses: Array<{ ok: boolean; status?: number; body: unknown }>) {
    let idx = 0;
    fetchMock.mockImplementation(async () => {
      const resp = responses[idx++] ?? responses[responses.length - 1];
      return {
        ok: resp.ok,
        status: resp.status ?? (resp.ok ? 200 : 400),
        text: async () => (typeof resp.body === "string" ? resp.body : JSON.stringify(resp.body)),
      };
    });
  }

  const cli = new GitlabApiHostCli("gitlab.com", "group/project");

  it("uses PRIVATE-TOKEN header", async () => {
    mockFetch([{ ok: true, body: { id: 1, username: "user" } }]);
    await cli.version("gl-token");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["PRIVATE-TOKEN"]).toBe("gl-token");
  });

  describe("prListOpen", () => {
    it("maps GitLab MR fields to expected shape", async () => {
      const mrs = [
        {
          iid: 42,
          title: "Test MR",
          web_url: "https://gitlab.com/g/p/-/merge_requests/42",
          draft: false,
          work_in_progress: false,
          source_branch: "feat",
          target_branch: "main",
          has_conflicts: false,
          detailed_merge_status: "mergeable",
          updated_at: "2024-01-01T00:00:00Z",
          user_notes_count: 3,
        },
      ];
      mockFetch([{ ok: true, body: mrs }]);

      const res = await cli.prListOpen("tok");
      expect(res.ok).toBe(true);
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0]).toMatchObject({
        number: 42,
        title: "Test MR",
        url: "https://gitlab.com/g/p/-/merge_requests/42",
        state: "OPEN",
        isDraft: false,
        headRefName: "feat",
        baseRefName: "main",
        mergeStateStatus: "CLEAN",
        reviewDecision: null,
        comments: 3,
        statusCheckRollup: [],
      });
    });

    it("maps has_conflicts=true to DIRTY", async () => {
      const mrs = [{ iid: 1, title: "MR", web_url: "u", draft: false, work_in_progress: false,
        source_branch: "f", target_branch: "main", has_conflicts: true,
        detailed_merge_status: "conflict", updated_at: "2024-01-01T00:00:00Z", user_notes_count: 0 }];
      mockFetch([{ ok: true, body: mrs }]);

      const res = await cli.prListOpen("tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0].mergeStateStatus).toBe("DIRTY");
    });
  });

  describe("runList", () => {
    it("maps pipeline status to in_progress/completed with correct conclusion", async () => {
      const pipelines = [
        { id: 1, name: "pipeline", status: "running", source: "push", ref: "main", web_url: "u", updated_at: "2024-01-01T00:00:00Z" },
        { id: 2, name: "pipeline", status: "failed", source: "push", ref: "main", web_url: "u", updated_at: "2024-01-01T00:00:00Z" },
        { id: 3, name: "pipeline", status: "success", source: "push", ref: "main", web_url: "u", updated_at: "2024-01-01T00:00:00Z" },
      ];
      mockFetch([{ ok: true, body: pipelines }]);

      const res = await cli.runList("tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0]).toMatchObject({ status: "in_progress", conclusion: "neutral" });
      expect(parsed[1]).toMatchObject({ status: "completed", conclusion: "failure" });
      expect(parsed[2]).toMatchObject({ status: "completed", conclusion: "success" });
    });
  });

  describe("runViewJobs", () => {
    it("wraps job array in { jobs } and adds databaseId", async () => {
      const jobs = [
        { id: 55, name: "test", status: "failed" },
      ];
      mockFetch([{ ok: true, body: jobs }]);

      const res = await cli.runViewJobs(10, "tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed.jobs[0]).toMatchObject({ id: 55, databaseId: 55, name: "test", conclusion: "failure" });
    });
  });

  describe("prListMerged", () => {
    it("maps merged MRs with mergedBy.login from username field", async () => {
      const mrs = [
        { iid: 5, title: "merged", web_url: "u", source_branch: "f",
          target_branch: "main", merged_at: "2024-01-01T00:00:00Z",
          merged_by: { username: "alice" } },
      ];
      mockFetch([{ ok: true, body: mrs }]);

      const res = await cli.prListMerged("tok");
      const parsed = JSON.parse(res.stdout);
      expect(parsed[0].mergedBy).toEqual({ login: "alice" });
    });
  });

  describe("prMerge", () => {
    it("sends PUT with squash and branch deletion flags", async () => {
      mockFetch([{ ok: true, body: { iid: 42, state: "merged" } }]);
      const res = await cli.prMerge(42, "tok");
      expect(res.ok).toBe(true);

      const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(callBody).toMatchObject({ squash: true, should_remove_source_branch: true });
    });

    it("returns error message from GitLab on failure", async () => {
      mockFetch([{ ok: false, status: 406, body: { message: "Branch cannot be merged" } }]);
      const res = await cli.prMerge(1, "tok");
      expect(res.ok).toBe(false);
      expect(res.stderr).toContain("Branch cannot be merged");
    });

    it("returns error without token", async () => {
      const res = await cli.prMerge(1);
      expect(res.ok).toBe(false);
      expect(res.stderr).toMatch(/token required/i);
    });
  });

  describe("runViewLogFailed", () => {
    it("returns trace content as stdout", async () => {
      mockFetch([{ ok: true, body: "Step 1: npm test\nFAILED: expected 1 to equal 2" }]);
      const res = await cli.runViewLogFailed(10, 55, "tok");
      expect(res.ok).toBe(true);
      expect(res.stdout).toContain("FAILED");
    });
  });

  describe("createGitHostCli with preferApi=true", () => {
    it("returns GitlabApiHostCli for gitlab provider when preferApi=true", () => {
      const cli = createGitHostCli("gitlab", vi.fn(), "/repo", "gitlab.com", "group/project", true);
      expect(cli).toBeInstanceOf(GitlabApiHostCli);
    });

    it("uses custom hostDomain in API base URL", async () => {
      const cli = new GitlabApiHostCli("gitlab.company.com", "team/project");
      mockFetch([{ ok: true, body: { id: 1, username: "user" } }]);
      await cli.version("tok");
      const calledUrl = fetchMock.mock.calls[0][0] as string;
      expect(calledUrl).toContain("gitlab.company.com");
    });
  });
});
