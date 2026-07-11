import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ProjectInitializationState,
  ProjectSummary,
} from "../contracts/project-management-types.js";
import { runCommandStrict } from "./cli-process-runner.js";

const INSPECTION_TIMEOUT_MS = 5_000;
const EXPECTED_TRACKED_FILES = [".gitignore", "README.md"];

type ProjectLookup = Pick<ProjectSummary, "id" | "baseDir" | "initializationMode">;

export class ProjectInitializationStateService {
  constructor(
    private readonly getProject: (projectId: string) => ProjectLookup | null,
  ) {}

  async getProjectInitializationState(projectId: string): Promise<ProjectInitializationState> {
    const project = this.getProject(projectId);
    if (!project) {
      return unavailableState(projectId, "existing");
    }

    if (project.initializationMode === "existing") {
      return unavailableState(project.id, project.initializationMode);
    }

    try {
      const repositoryState = await inspectRepository(project.baseDir);
      return {
        projectId: project.id,
        initializationMode: project.initializationMode,
        repositoryState,
        canCreateInitialAppQuickactions: repositoryState === "initial",
      };
    } catch {
      return unavailableState(project.id, project.initializationMode);
    }
  }
}

function unavailableState(
  projectId: string,
  initializationMode: ProjectInitializationState["initializationMode"],
): ProjectInitializationState {
  return {
    projectId,
    initializationMode,
    repositoryState: "unavailable",
    canCreateInitialAppQuickactions: false,
  };
}

async function inspectRepository(repoPath: string): Promise<"initial" | "modified"> {
  const resolvedRepoPath = path.resolve(repoPath);
  const root = (await runGit(resolvedRepoPath, ["rev-parse", "--show-toplevel"])).trim();
  if (path.resolve(root) !== resolvedRepoPath) {
    return "modified";
  }

  const status = await runGit(resolvedRepoPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (status.length > 0) {
    return "modified";
  }

  const commitCount = Number.parseInt(
    (await runGit(resolvedRepoPath, ["rev-list", "--count", "HEAD"])).trim(),
    10,
  );
  if (commitCount !== 1) {
    return "modified";
  }

  const trackedFiles = splitNullDelimited(
    await runGit(resolvedRepoPath, ["ls-tree", "-r", "-z", "--name-only", "HEAD"]),
  ).sort();
  if (!sameStringArray(trackedFiles, EXPECTED_TRACKED_FILES)) {
    return "modified";
  }

  const rootEntries = (await fs.readdir(resolvedRepoPath)).filter((entry) => entry !== ".git").sort();
  if (!sameStringArray(rootEntries, EXPECTED_TRACKED_FILES)) {
    return "modified";
  }

  const readme = await runGit(resolvedRepoPath, ["show", "HEAD:README.md"]);
  if (!/^# [^\r\n]+\r?\n\r?\nInitialized with Code UX\.\r?\n?$/.test(readme)) {
    return "modified";
  }

  const gitignore = await runGit(resolvedRepoPath, ["show", "HEAD:.gitignore"]);
  const gitignoreEntries = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  return gitignoreEntries.length === 1 && (gitignoreEntries[0] === ".code-ux/" || gitignoreEntries[0] === ".code-ux")
    ? "initial"
    : "modified";
}

async function runGit(repoPath: string, args: string[]): Promise<string> {
  const result = await runCommandStrict("git", args, repoPath, process.env, {
    timeout: INSPECTION_TIMEOUT_MS,
    trimOutput: false,
  });
  return result.stdout;
}

function splitNullDelimited(value: string): string[] {
  return value.split("\0").filter(Boolean);
}

function sameStringArray(left: string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
