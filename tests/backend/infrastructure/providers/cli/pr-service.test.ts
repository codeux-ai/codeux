import { describe, expect, it, vi } from "vitest";
import { PrService } from "../../../../../src/infrastructure/providers/cli/pr-service.js";
import * as cliProcessRunner from "../../../../../src/services/cli-process-runner.js";

vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
    runCommandStrict: vi.fn(),
}));

describe("PrService", () => {
    const defaultArgs = { taskId: "t", provider: "codex" as any, title: "title", featureBranch: "feat", workerBranch: "worker" };

    describe("resolveOrCreateFeaturePr", () => {
        it("returns existing PR url", async () => {
            vi.mocked(cliProcessRunner.runCommandStrict).mockResolvedValueOnce({ stdout: JSON.stringify([{ url: "http://pr" }]), stderr: "", exitCode: 0 } as any);
            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path");
            expect(res).toBe("http://pr");
        });

        it("creates new PR if existing not found", async () => {
            vi.mocked(cliProcessRunner.runCommandStrict)
                .mockRejectedValueOnce(new Error("not found"))
                .mockResolvedValueOnce({ stdout: "http://newpr\n", stderr: "", exitCode: 0 } as any);
            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr(defaultArgs, "/path", "token");
            expect(res).toBe("http://newpr");
        });

        it("creates new PR with task and sprint descriptions", async () => {
            vi.mocked(cliProcessRunner.runCommandStrict)
                .mockRejectedValueOnce(new Error("not found"))
                .mockResolvedValueOnce({ stdout: "http://newpr2\n", stderr: "", exitCode: 0 } as any);
            const service = new PrService();
            const res = await service.resolveOrCreateFeaturePr({
                ...defaultArgs,
                taskDescription: "test task desc",
                sprintDescription: "test sprint desc"
            }, "/path", "token");
            expect(res).toBe("http://newpr2");
            expect(cliProcessRunner.runCommandStrict).toHaveBeenCalledWith(
                "gh",
                expect.arrayContaining([expect.stringContaining("test task desc")]),
                "/path",
                expect.any(Object)
            );
            expect(cliProcessRunner.runCommandStrict).toHaveBeenCalledWith(
                "gh",
                expect.arrayContaining([expect.stringContaining("test sprint desc")]),
                "/path",
                expect.any(Object)
            );
        });

        it("returns undefined if create fails", async () => {
            vi.mocked(cliProcessRunner.runCommandStrict).mockRejectedValue(new Error("fail"));
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
