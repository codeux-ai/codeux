import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrService } from "../../../../../src/infrastructure/providers/cli/pr-service.js";
import { GitStatusQueryClient } from "../../../../../src/infrastructure/git/git-status-query-client.js";

vi.mock("../../../../../src/infrastructure/git/git-status-query-client.js");


describe("PrService", () => {
    const defaultArgs = { taskId: "t", provider: "codex" as any, title: "title", featureBranch: "feat", workerBranch: "worker" };
    const githubRemote = "https://github.com/owner/repo.git\n";
    const gitlabRemote = "https://gitlab.com/group/project.git\n";


    describe("resolveOrCreateFeaturePr", () => {
        beforeEach(() => {
            vi.mocked(GitStatusQueryClient).mockClear();
        });

        it("returns existing PR url", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockResolvedValue({ ok: true, stdout: JSON.stringify([{ url: "http://pr" }]) })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path");
            expect(res).toBe("http://pr");
        });

        it("creates new PR if existing not found", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "http://newpr\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path", "token");
            expect(res).toBe("http://newpr");
            expect(mockClient.setProvider).toHaveBeenCalledWith("github", "github.com", "owner/repo", true);
            expect(mockClient.ghPrCreate).toHaveBeenCalledWith("feat", "worker", expect.any(String), expect.any(String), "token");
        });

        it("creates new PR with task and sprint descriptions", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "http://newpr2\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr({
                ...defaultArgs,
                taskDescription: "test task desc",
                sprintDescription: "test sprint desc"
            }, "/path", "token");
            expect(res).toBe("http://newpr2");
            expect(mockClient.ghPrCreate).toHaveBeenCalledWith(
                "feat",
                "worker",
                expect.any(String),
                expect.stringContaining("test task desc"),
                "token"
            );
            expect(mockClient.ghPrCreate).toHaveBeenCalledWith(
                "feat",
                "worker",
                expect.any(String),
                expect.stringContaining("test sprint desc"),
                "token"
            );
        });

        it("uses the configured GitHub token in API mode without requiring gh", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockResolvedValue({ ok: true, stdout: "[]" }),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "https://github.com/owner/repo/pull/1\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path", {
                githubToken: "gh-token",
                gitlabToken: "gl-token",
            });

            expect(res).toBe("https://github.com/owner/repo/pull/1");
            expect(mockClient.gitRemoteUrl).toHaveBeenCalledWith("origin", undefined);
            expect(mockClient.setProvider).toHaveBeenCalledWith("github", "github.com", "owner/repo", true);
            expect(mockClient.ghPrListOpenMatching).toHaveBeenCalledWith("feat", "worker", "gh-token");
            expect(mockClient.ghPrCreate).toHaveBeenCalledWith("feat", "worker", expect.any(String), expect.any(String), "gh-token");
        });

        it("uses the configured GitLab token in API mode without requiring glab", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: gitlabRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockResolvedValue({ ok: true, stdout: "[]" }),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "https://gitlab.com/group/project/-/merge_requests/1\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path", {
                githubToken: "gh-token",
                gitlabToken: "gl-token",
            });

            expect(res).toBe("https://gitlab.com/group/project/-/merge_requests/1");
            expect(mockClient.setProvider).toHaveBeenCalledWith("gitlab", "gitlab.com", "group/project", true);
            expect(mockClient.ghPrListOpenMatching).toHaveBeenCalledWith("feat", "worker", "gl-token");
            expect(mockClient.ghPrCreate).toHaveBeenCalledWith("feat", "worker", expect.any(String), expect.any(String), "gl-token");
        });

        it("throws with context if create fails", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockRejectedValue(new Error("fail"))
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            await expect(service.resolveOrCreateFeaturePr(defaultArgs, "/path"))
                .rejects
                .toThrow("Failed to create feature PR for worker into feat: fail");
        });

        it("throws when create exits without a PR url", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: githubRemote }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "created\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            await expect(service.resolveOrCreateFeaturePr(defaultArgs, "/path"))
                .rejects
                .toThrow("git host backend did not return a pull request URL");
        });
    });

    describe("hasUnpushedCommits", () => {
        it("checks remote worker ref first", async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({}) // verify worker ref true
                .mockResolvedValueOnce({ stdout: "1" }); // rev-list count 1

            const service = new PrService();
            const res = await service.hasUnpushedCommits("/path", "w", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/w"], "/path");
        });

        it("checks remote feature ref if worker ref not found", async () => {
            const runner = vi.fn()
                .mockRejectedValueOnce(new Error()) // worker ref false
                .mockResolvedValueOnce({}) // feature ref true
                .mockResolvedValueOnce({ stdout: "2" }); // rev-list count

            const service = new PrService();
            const res = await service.hasUnpushedCommits("/path", "w", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/f"], "/path");
        });

        it("returns false if both not found", async () => {
            const runner = vi.fn().mockRejectedValue(new Error());
            const service = new PrService();
            const res = await service.hasUnpushedCommits("/path", "w", "f", runner);
            expect(res).toBe(false);
        });
    });

    describe("hasWorkerBranchCommitsAgainstFeature", () => {
        it("checks remote feature ref first", async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ stdout: "1" });

            const service = new PrService();
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "worker", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/f"], "/path");
        });

        it("checks local feature ref if remote not found", async () => {
            const runner = vi.fn()
                .mockRejectedValueOnce(new Error())
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ stdout: "2" });

            const service = new PrService();
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "worker", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/heads/f"], "/path");
        });

        it("returns false if rev-list throws", async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new Error());

            const service = new PrService();
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "worker", "f", runner);
            expect(res).toBe(false);
        });
    });
});
