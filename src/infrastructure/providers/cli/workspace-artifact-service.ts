import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { LEARNINGS_FILENAME } from "../../../contracts/memory-types.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import type { IWorkspaceManager } from "./workspace-manager.js";

export interface AppliedWorkspacePatchResult {
  hasChanges: boolean;
  commitSha?: string;
  stats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export class WorkspaceArtifactService {
  constructor(private readonly workspaceManager: IWorkspaceManager) {}

  async exportBinaryPatch(workspaceRef: string, baseRef: string): Promise<string> {
    const diffArgs = ["diff", "--binary", baseRef, "--", ".", `:(exclude)${LEARNINGS_FILENAME}`];
    const untrackedResult = await this.workspaceManager.runWorkspaceCommand(
      workspaceRef,
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { trimOutput: false },
    );
    const untrackedPaths = untrackedResult.stdout
      .split("\0")
      .filter((candidate) => candidate.length > 0 && candidate !== LEARNINGS_FILENAME);

    // Git patch payloads are whitespace-sensitive. Preserve raw command output so
    // EOF-only whitespace lines and no-newline markers survive host-side apply.
    if (untrackedPaths.length === 0) {
      const result = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        diffArgs,
        { trimOutput: false },
      );
      return result.stdout;
    }

    const tempIndexPath = `.sprint-os-export-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.index`;
    const tempIndexEnv = {
      ...process.env,
      GIT_INDEX_FILE: tempIndexPath,
    };

    try {
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["read-tree", "HEAD"],
        { env: tempIndexEnv },
      );
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        ["add", "--intent-to-add", "--", ...untrackedPaths],
        { env: tempIndexEnv },
      );
      const result = await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "git",
        diffArgs,
        { env: tempIndexEnv, trimOutput: false },
      );
      return result.stdout;
    } finally {
      await this.workspaceManager.runWorkspaceCommand(
        workspaceRef,
        "rm",
        ["-f", tempIndexPath],
      ).catch(() => undefined);
    }
  }

  async applyPatchToBranch(args: {
    repoPath: string;
    baseRef: string;
    workerBranch: string;
    patchText: string;
    commitMessage: string;
  }): Promise<AppliedWorkspacePatchResult> {
    if (!args.patchText.trim()) {
      return { hasChanges: false };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-patch-"));
    const patchPath = path.join(tempDir, "workspace.patch");
    const indexPath = path.join(tempDir, "workspace.index");

    try {
      await fs.writeFile(patchPath, args.patchText, "utf8");

      const indexEnv = {
        ...process.env,
        GIT_INDEX_FILE: indexPath,
      };

      await runCommandStrict("git", ["read-tree", args.baseRef], args.repoPath, indexEnv);
      await runCommandStrict("git", ["apply", "--cached", "--binary", patchPath], args.repoPath, indexEnv);

      const treeSha = (await runCommandStrict("git", ["write-tree"], args.repoPath, indexEnv)).stdout.trim();
      const baseTree = (await runCommandStrict("git", ["rev-parse", `${args.baseRef}^{tree}`], args.repoPath)).stdout.trim();

      if (!treeSha || treeSha === baseTree) {
        return { hasChanges: false };
      }

      const commitSha = (await runCommandStrict(
        "git",
        ["commit-tree", treeSha, "-p", args.baseRef, "-m", args.commitMessage],
        args.repoPath,
      )).stdout.trim();

      await runCommandStrict("git", ["update-ref", `refs/heads/${args.workerBranch}`, commitSha], args.repoPath);
      await runCommandStrict(
        "git",
        ["push", "-u", "origin", `refs/heads/${args.workerBranch}:refs/heads/${args.workerBranch}`],
        args.repoPath,
      );

      const diffOutput = (await runCommandStrict(
        "git",
        ["diff", "--numstat", args.baseRef, commitSha],
        args.repoPath,
      )).stdout;

      let filesChanged = 0;
      let insertions = 0;
      let deletions = 0;

      for (const line of diffOutput.trim().split("\n")) {
        if (!line) continue;
        const parts = line.split("\t");
        if (parts.length < 2) continue;
        filesChanged++;
        if (parts[0] !== "-" && parts[1] !== "-") {
          const ins = Number.parseInt(parts[0], 10);
          const del = Number.parseInt(parts[1], 10);
          if (Number.isFinite(ins)) insertions += ins;
          if (Number.isFinite(del)) deletions += del;
        }
      }

      return {
        hasChanges: true,
        commitSha,
        stats: {
          filesChanged,
          insertions,
          deletions,
        },
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
