import { initLocalRepo } from "../../infrastructure/git/local-repo-initializer.js";
import * as path from "node:path";
import * as os from "node:os";
import { createGitHubRepo, createGitLabRepo } from "../../infrastructure/git/remote-repo-creator.js";
import { validateSafeRepoName, validateSafeClonePath, validateNonEmptyDir } from "../../utils/path-validator.js";
import type { CreateProjectInput, ProjectSummary } from "../../contracts/project-management-types.js";
import { getHomeCodeUxPath } from "../../shared/config/code-ux-paths.js";

function resolveCloneParentDir(cloneDir?: string): string {
  const trimmed = cloneDir?.trim();
  if (!trimmed) {
    return getHomeCodeUxPath("projects");
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(os.homedir(), trimmed);
}

function resolveNewLocalProjectDir(sourceRef: string, cloneDir?: string): { targetDir: string; allowedRoot: string } {
  const trimmed = sourceRef.trim();
  if (!trimmed) {
    throw new Error("Local project directory cannot be empty");
  }
  const trimmedCloneDir = cloneDir?.trim();
  if (trimmedCloneDir) {
    const allowedRoot = path.isAbsolute(trimmedCloneDir)
      ? trimmedCloneDir
      : path.resolve(os.homedir(), trimmedCloneDir);
    return {
      targetDir: path.isAbsolute(trimmed) ? trimmed : path.resolve(allowedRoot, trimmed),
      allowedRoot,
    };
  }
  if (path.isAbsolute(trimmed)) {
    return { targetDir: trimmed, allowedRoot: trimmed };
  }
  return {
    targetDir: path.resolve(os.homedir(), trimmed),
    allowedRoot: os.homedir(),
  };
}

export async function initializeProject(
  input: CreateProjectInput,
  deps: {
    createProject: (i: CreateProjectInput) => ProjectSummary | Promise<ProjectSummary>;
    getGithubToken: () => string;
    getGitlabToken?: () => string;
  }
): Promise<ProjectSummary> {
  const mode = input.initMode ?? "existing";

  if (mode === "new-local") {
    const { targetDir, allowedRoot } = resolveNewLocalProjectDir(input.sourceRef, input.cloneDir);
    // Use the validator's own resolved, root-checked path for every subsequent
    // operation rather than re-deriving it from the raw request input.
    const safeSourceRef = validateSafeClonePath(targetDir, allowedRoot);
    validateNonEmptyDir(safeSourceRef, allowedRoot);
    await initLocalRepo(safeSourceRef, input.defaultBranch ?? "main", input.name);
    return deps.createProject({
      ...input,
      sourceType: "local",
      sourceRef: safeSourceRef,
      initMode: undefined,
    });
  }

  if (mode === "new-remote") {
    if (!input.remoteProvider) throw new Error("remoteProvider is required for new-remote init mode");
    validateSafeRepoName(input.sourceRef);
    const cloneParentDir = resolveCloneParentDir(input.cloneDir);

    // The allowed root is the resolved clone parent, including the home Code UX default.
    const allowedRoot = cloneParentDir;
    validateSafeClonePath(cloneParentDir, allowedRoot);
    const targetDir = path.resolve(cloneParentDir, input.sourceRef);
    validateNonEmptyDir(targetDir);
    let result;
    if (input.remoteProvider === "github") {
      result = await createGitHubRepo({
        repoName: input.sourceRef,
        isPrivate: input.isPrivate ?? true,
        cloneParentDir,
        hostToken: deps.getGithubToken(),
      });
    } else {
      result = await createGitLabRepo({
        repoName: input.sourceRef,
        isPrivate: input.isPrivate ?? true,
        cloneParentDir,
        hostToken: deps.getGitlabToken?.() ?? "",
        defaultBranch: input.defaultBranch,
      });
    }
    return deps.createProject({
      ...input,
      sourceType: "git",
      sourceRef: result.remoteUrl,
      cloneDir: cloneParentDir,
      initMode: undefined,
    });
  }

  // "existing" or absent — original behavior
  return deps.createProject(input);
}
