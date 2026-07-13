import { initLocalRepo } from "../../infrastructure/git/local-repo-initializer.js";
import * as path from "node:path";
import * as os from "node:os";
import { createGitHubRepo, createGitLabRepo } from "../../infrastructure/git/remote-repo-creator.js";
import { validateSafeRepoName, validateSafeClonePath, validateNonEmptyDir } from "../../utils/path-validator.js";
import type { CreateProjectInput, GitProvider, ProjectSummary } from "../../contracts/project-management-types.js";
import { getHomeCodeUxPath } from "../../shared/config/code-ux-paths.js";
import {
  CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
  DEFAULT_DESIGN_GUIDANCE_SETTINGS,
} from "../settings/design-guidance-catalog.js";

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

function withNewProjectDesignGuidance(input: CreateProjectInput): CreateProjectInput {
  const existingGuidance = input.settingsOverrides?.designGuidance;
  return {
    ...input,
    settingsOverrides: {
      ...input.settingsOverrides,
      designGuidance: {
        ...DEFAULT_DESIGN_GUIDANCE_SETTINGS,
        ...existingGuidance,
        selectedStyleguideId: existingGuidance?.selectedStyleguideId || CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
      },
    },
  };
}

/**
 * Keep dashboard conversation ownership project-local. A null route is the
 * intentional built-in Project manager fallback, and prevents a system-level
 * Worker override from silently becoming the first contact for a newly added
 * project. Explicit create-time routing still wins.
 */
function withProjectManagerDashboardDefault(input: CreateProjectInput): CreateProjectInput {
  const existingRouting = input.settingsOverrides?.agents?.routing;
  return {
    ...input,
    settingsOverrides: {
      ...input.settingsOverrides,
      agents: {
        ...input.settingsOverrides?.agents,
        routing: {
          ...existingRouting,
          dashboardReply: existingRouting?.dashboardReply ?? { agentPresetId: null },
        },
      },
    },
  };
}

function withNewProjectDefaults(input: CreateProjectInput): CreateProjectInput {
  return withProjectManagerDashboardDefault(withNewProjectDesignGuidance(input));
}

export async function initializeProject(
  input: CreateProjectInput,
  deps: {
    createProject: (i: CreateProjectInput) => ProjectSummary | Promise<ProjectSummary>;
    withRemoteGitCredential: <T>(
      provider: Extract<GitProvider, "github" | "gitlab">,
      consumer: (hostToken?: string) => T | Promise<T>,
    ) => Promise<T>;
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
    return deps.createProject(withNewProjectDefaults({
      ...input,
      sourceType: "local",
      sourceRef: safeSourceRef,
      initMode: mode,
    }));
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
    const result = await deps.withRemoteGitCredential(input.remoteProvider, async (hostToken) => (
      input.remoteProvider === "github"
        ? await createGitHubRepo({
            repoName: input.sourceRef,
            isPrivate: input.isPrivate ?? true,
            cloneParentDir,
            hostToken,
          })
        : await createGitLabRepo({
            repoName: input.sourceRef,
            isPrivate: input.isPrivate ?? true,
            cloneParentDir,
            hostToken,
            defaultBranch: input.defaultBranch,
          })
    ));
    return deps.createProject(withNewProjectDefaults({
      ...input,
      sourceType: "git",
      sourceRef: result.remoteUrl,
      cloneDir: cloneParentDir,
      initMode: mode,
    }));
  }

  // "existing" or absent — original behavior
  return deps.createProject(withProjectManagerDashboardDefault({ ...input, initMode: "existing" }));
}
