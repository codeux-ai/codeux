import { describe, expect, it, vi, beforeEach } from "vitest";
import { PrService } from "../../../../../src/infrastructure/providers/cli/pr-service.js";
import { GitStatusQueryClient } from "../../../../../src/infrastructure/git/git-status-query-client.js";

vi.mock("../../../../../src/infrastructure/git/git-status-query-client.js");


describe("PrService", () => {
    const defaultArgs = { taskId: "t", provider: "codex" as any, title: "title", featureBranch: "feat", workerBranch: "worker" };


    describe("resolveOrCreateFeaturePr", () => {
        beforeEach(() => {
            vi.mocked(GitStatusQueryClient).mockClear();
        });

        it("returns existing PR url", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" }),
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
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockResolvedValue({ ok: true, stdout: "http://newpr\n" })
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path", "token");
            expect(res).toBe("http://newpr");
        });

        it("creates new PR with task and sprint descriptions", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" }),
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

        it("returns undefined if create fails", async () => {
            const mockClient = {
                gitRemoteUrl: vi.fn().mockResolvedValue({ ok: true, stdout: "origin\thttps://github.com/owner/repo.git (fetch)\n" }),
                setProvider: vi.fn(),
                ghPrListOpenMatching: vi.fn().mockRejectedValue(new Error("not found")),
                ghPrCreate: vi.fn().mockRejectedValue(new Error("fail"))
            };
            vi.mocked(GitStatusQueryClient).mockImplementation(function() { Object.assign(this, mockClient); } as any);

            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path");
            expect(res).toBeUndefined();
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
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/remotes/origin/f"], "/path");
        });

        it("checks local feature ref if remote not found", async () => {
            const runner = vi.fn()
                .mockRejectedValueOnce(new Error())
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ stdout: "2" });

            const service = new PrService();
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "f", runner);
            expect(res).toBe(true);
            expect(runner).toHaveBeenCalledWith("git", ["show-ref", "--verify", "--quiet", "refs/heads/f"], "/path");
        });

        it("returns false if rev-list throws", async () => {
            const runner = vi.fn()
                .mockResolvedValueOnce({})
                .mockRejectedValueOnce(new Error());

            const service = new PrService();
            const res = await service.hasWorkerBranchCommitsAgainstFeature("/path", "f", runner);
            expect(res).toBe(false);
        });
    });
});
