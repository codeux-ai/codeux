import { initLocalRepo } from "../../infrastructure/git/local-repo-initializer.js";
import { createGitHubRepo, createGitLabRepo } from "../../infrastructure/git/remote-repo-creator.js";
import type { CreateProjectInput, ProjectSummary } from "../../contracts/project-management-types.js";

export async function initializeProject(
  input: CreateProjectInput,
  deps: {
    createProject: (i: CreateProjectInput) => ProjectSummary | Promise<ProjectSummary>;
    getGithubToken: () => string;
  }
): Promise<ProjectSummary> {
  const mode = input.initMode ?? "existing";

  if (mode === "new-local") {
    await initLocalRepo(input.sourceRef, input.defaultBranch ?? "main");
    return deps.createProject({ ...input, sourceType: "local", initMode: undefined });
  }

  if (mode === "new-remote") {
    if (!input.remoteProvider) throw new Error("remoteProvider is required for new-remote init mode");
    const cloneParentDir = input.cloneDir ?? process.cwd();
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
