import { initLocalRepo } from "../../infrastructure/git/local-repo-initializer.js";
import * as path from "node:path";
import { createGitHubRepo, createGitLabRepo } from "../../infrastructure/git/remote-repo-creator.js";
import { validateSafeRepoName, validateSafeClonePath, validateNonEmptyDir } from "../../utils/path-validator.js";
import type { CreateProjectInput, ProjectSummary } from "../../contracts/project-management-types.js";

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
    // In new-local, sourceRef is the full directory path to initialize.
    // The selected root is determined by the app, we'll enforce it to be within process.cwd()
    // unless a specific cloneDir is provided (which we will use as the root for safety if needed,
    // but the prompt says "selected root". Typically process.cwd() is the safe root for standard execution).
    // Let's pass process.cwd() as the allowed root to prevent traversal outside the workspace,
    // but the review noted "Rigid Root Assumption" because cloneDir might be outside cwd.
    // Let's use cloneDir if provided, else cwd.
    const allowedRoot = input.cloneDir ?? process.cwd();
    validateSafeClonePath(input.sourceRef, allowedRoot);
    validateNonEmptyDir(input.sourceRef);
    await initLocalRepo(input.sourceRef, input.defaultBranch ?? "main");
    return deps.createProject({ ...input, sourceType: "local", initMode: undefined });
  }

  if (mode === "new-remote") {
    if (!input.remoteProvider) throw new Error("remoteProvider is required for new-remote init mode");
    validateSafeRepoName(input.sourceRef);
    const cloneParentDir = input.cloneDir ?? process.cwd();

    // The allowed root is cloneDir if provided, otherwise cwd.
    const allowedRoot = input.cloneDir ?? process.cwd();
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
      });
    }
    return deps.createProject({
      ...input,
      sourceType: "git",
      sourceRef: result.remoteUrl,
      cloneDir: result.localPath,
      initMode: undefined,
    });
  }

  // "existing" or absent — original behavior
  return deps.createProject(input);
}
