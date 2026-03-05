import { describe, expect, it, vi, beforeEach } from "vitest";
import { JulesSourceResolver } from "../../../src/services/jules-source-resolver.js";
import { commandRunner } from "../../../src/shared/subprocess/command-runner.js";

vi.mock("../../../src/shared/subprocess/command-runner.js", () => {
    return {
        commandRunner: {
            runStrict: vi.fn()
        }
    };
});

describe("JulesSourceResolver", () => {
    let mockApi: any;

    beforeEach(() => {
        mockApi = {
            getSource: vi.fn(),
            listAllSources: vi.fn(),
        };
        vi.clearAllMocks();
    });

    it("parses valid github URLs", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "git@github.com:owner/repo.git", stderr: "", exitCode: 0 } as any);
        mockApi.listAllSources.mockResolvedValue([{ id: "sources/github/owner/repo" }]);

        const resolver = new JulesSourceResolver(mockApi);
        const res = await resolver.resolveSourceId({ repoPath: "/repo" });
        expect(res).toBe("sources/github/owner/repo");
    });

    it("handles cached values", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "git@github.com:owner/repo.git", stderr: "", exitCode: 0 } as any);
        mockApi.listAllSources.mockResolvedValue([{ id: "sources/github/owner/repo" }]);

        const resolver = new JulesSourceResolver(mockApi);
        await resolver.resolveSourceId({ repoPath: "/repo" });
        const res2 = await resolver.resolveSourceId({ repoPath: "/repo" });
        expect(mockApi.listAllSources).toHaveBeenCalledTimes(1); // Cached
        expect(res2).toBe("sources/github/owner/repo");
    });

    it("throws if requested source doesn't match", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "https://github.com/owner/repo.git", stderr: "", exitCode: 0 } as any);
        mockApi.getSource.mockResolvedValue({ id: "sources/github/other/repo" });

        const resolver = new JulesSourceResolver(mockApi);
        await expect(resolver.resolveSourceId({ repoPath: "/repo", requestedSourceId: "sources/other/repo" })).rejects.toThrow("Provided source_id");
    });

    it("returns requested source if matches by object", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "https://github.com/owner/repo.git", stderr: "", exitCode: 0 } as any);
        mockApi.getSource.mockResolvedValue({ githubRepo: { owner: "owner", repo: "repo" }, id: "custom" });

        const resolver = new JulesSourceResolver(mockApi);
        const res = await resolver.resolveSourceId({ repoPath: "/repo", requestedSourceId: "custom" });
        expect(res).toBe("sources/custom");
    });

    it("throws on invalid url", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "invalid", stderr: "", exitCode: 0 } as any);
        const resolver = new JulesSourceResolver(mockApi);
        await expect(resolver.resolveSourceId({ repoPath: "/repo" })).rejects.toThrow("Unable to parse repository");
    });

    it("throws on missing source id/name after matching", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "https://github.com/owner/repo.git", stderr: "", exitCode: 0 } as any);
        mockApi.listAllSources.mockResolvedValue([{ githubRepo: { owner: "owner", repo: "repo" } }]);

        const resolver = new JulesSourceResolver(mockApi);
        await expect(resolver.resolveSourceId({ repoPath: "/repo" })).rejects.toThrow("has no usable id/name");
    });

    it("handles invalid url throw", async () => {
        vi.mocked(commandRunner.runStrict).mockResolvedValue({ stdout: "http://[invalid]", stderr: "", exitCode: 0 } as any);
        const resolver = new JulesSourceResolver(mockApi);
        await expect(resolver.resolveSourceId({ repoPath: "/repo" })).rejects.toThrow("Unable to parse repository");
    });

});
