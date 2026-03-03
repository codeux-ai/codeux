import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "child_process";
import { JulesSourceResolver } from "../../../src/services/jules-source-resolver.js";

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("JulesSourceResolver", () => {
  const execFileSyncMock = vi.mocked(execFileSync);
  const listAllSources = vi.fn();
  const getSource = vi.fn();
  let resolver: JulesSourceResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    execFileSyncMock.mockReturnValue("git@github.com:acme/example-repo.git\n" as any);
    resolver = new JulesSourceResolver({
      listAllSources,
      getSource,
    } as any);
  });

  it("auto-resolves source from repository remote", async () => {
    listAllSources.mockResolvedValue([
      {
        id: "sources/1",
        name: "sources/1",
        githubRepo: {
          owner: "acme",
          repo: "example-repo",
        },
      },
    ]);

    const sourceId = await resolver.resolveSourceId({ repoPath: "/tmp/repo" });
    expect(sourceId).toBe("sources/1");
    expect(getSource).not.toHaveBeenCalled();
  });

  it("validates explicit source_id against repository remote", async () => {
    getSource.mockResolvedValue({
      id: "sources/77",
      name: "sources/77",
      githubRepo: {
        owner: "acme",
        repo: "example-repo",
      },
    });

    const sourceId = await resolver.resolveSourceId({ repoPath: "/tmp/repo", requestedSourceId: "77" });
    expect(sourceId).toBe("sources/77");
  });

  it("fails when explicit source_id points to another repository", async () => {
    getSource.mockResolvedValue({
      id: "sources/88",
      name: "sources/88",
      githubRepo: {
        owner: "acme",
        repo: "other-repo",
      },
    });

    await expect(resolver.resolveSourceId({ repoPath: "/tmp/repo", requestedSourceId: "88" })).rejects.toThrow(
      "does not match repository"
    );
  });

  it("matches github owner/repo encoded in source name", async () => {
    listAllSources.mockResolvedValue([
      {
        id: "sources/github/acme/example-repo",
        name: "sources/github/acme/example-repo",
      },
    ]);

    const sourceId = await resolver.resolveSourceId({ repoPath: "/tmp/repo" });
    expect(sourceId).toBe("sources/github/acme/example-repo");
  });
});
