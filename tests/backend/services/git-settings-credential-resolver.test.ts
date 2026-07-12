import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withResolvedGitSettingsCredentials } from "../../../src/services/credentials/git-settings-credential-resolver.js";
import type { SettingsCredentialResolver } from "../../../src/services/credentials/settings-credential-resolver.js";

const tempDirs: string[] = [];

async function createRepo(remoteUrl: string): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-git-credential-"));
  tempDirs.push(repoPath);
  await fs.mkdir(path.join(repoPath, ".git"));
  await fs.writeFile(path.join(repoPath, ".git", "config"), [
    '[remote "origin"]',
    `  url = ${remoteUrl}`,
  ].join("\n"));
  return repoPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("withResolvedGitSettingsCredentials", () => {
  it("resolves the current project-scoped host credential while legacy token fields stay sanitized", async () => {
    const repoPath = await createRepo("https://github.com/example/repo.git");
    const releasedBuffers: Buffer[] = [];
    const withCredential = vi.fn(async (_reference, _context, consumer) => {
      const secret = Buffer.from(withCredential.mock.calls.length === 1 ? "rotated-one" : "rotated-two");
      try {
        return await consumer(secret);
      } finally {
        secret.fill(0);
        releasedBuffers.push(secret);
      }
    });
    const resolver = { withCredential } as unknown as SettingsCredentialResolver;
    const git = {
      githubToken: "",
      gitlabToken: "",
      githubTokenCredentialRef: { credentialId: "github-credential", capability: "read" as const },
    };

    const first = await withResolvedGitSettingsCredentials({
      resolver,
      projectId: "project-1",
      workspaceId: "workspace-1",
      repoPath,
      consumer: "git.test.read",
      git,
    }, async (auth) => auth.githubToken);
    const second = await withResolvedGitSettingsCredentials({
      resolver,
      projectId: "project-1",
      workspaceId: "workspace-1",
      repoPath,
      consumer: "git.test.read",
      git,
    }, async (auth) => auth.githubToken);

    expect(git.githubToken).toBe("");
    expect(git.gitlabToken).toBe("");
    expect([first, second]).toEqual(["rotated-one", "rotated-two"]);
    expect(withCredential).toHaveBeenCalledTimes(2);
    expect(withCredential).toHaveBeenCalledWith(git.githubTokenCredentialRef, {
      projectId: "project-1",
      workspaceId: "workspace-1",
      consumer: "git.test.read.github",
    }, expect.any(Function));
    expect(releasedBuffers.every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
  });

  it("fails closed when a broker reference has no resolver or project scope", async () => {
    const repoPath = await createRepo("https://gitlab.com/example/repo.git");
    const request = {
      repoPath,
      consumer: "git.test.write",
      git: {
        githubToken: "",
        gitlabToken: "",
        gitlabTokenCredentialRef: { credentialId: "gitlab-credential", capability: "read" as const },
      },
    };

    await expect(withResolvedGitSettingsCredentials(request, async () => undefined))
      .rejects.toThrow("require an active project scope");
  });

  it.each(["denied", "revoked", "missing"])("does not use ambient Git auth when the configured reference is %s", async (reason) => {
    const repoPath = await createRepo("https://github.com/example/repo.git");
    const resolver = {
      withCredential: vi.fn(async () => { throw new Error(`Credential ${reason}.`); }),
    } as unknown as SettingsCredentialResolver;
    const consumer = vi.fn();

    await expect(withResolvedGitSettingsCredentials({
      resolver,
      projectId: "project-1",
      repoPath,
      consumer: "git.sprint.branch-preflight",
      git: {
        githubToken: "ambient-token",
        githubTokenCredentialRef: { credentialId: "credential-1", capability: "read" },
      },
    }, consumer)).rejects.toThrow(`Credential ${reason}.`);
    expect(consumer).not.toHaveBeenCalled();
  });
});
