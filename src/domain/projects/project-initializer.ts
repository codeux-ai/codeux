import { initLocalRepo } from "../../infrastructure/git/local-repo-initializer.js";
import * as path from "node:path";
import * as os from "node:os";
import { createGitHubRepo, createGitLabRepo } from "../../infrastructure/git/remote-repo-creator.js";
import { validateSafeRepoName, validateSafeClonePath, validateNonEmptyDir } from "../../utils/path-validator.js";
import type { CreateProjectInput, ProjectSummary } from "../../contracts/project-management-types.js";
import { getHomeCodeUxPath } from "../../shared/config/code-ux-paths.js";
import {
  DEFAULT_DESIGN_GUIDANCE_SETTINGS,
  DESIGN_GUIDANCE_NONE_ID,
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

/**
 * Project creation always starts with both reusable guidance catalogs disabled.
 * Keep unrelated catalog and visibility overrides, but do not let a caller's
 * create-time selections bypass the explicit None baseline.
 */
function withProjectCreationDesignGuidance(input: CreateProjectInput): CreateProjectInput {
  const existingGuidance = input.settingsOverrides?.designGuidance;
  return {
    ...input,
    settingsOverrides: {
      ...input.settingsOverrides,
      designGuidance: {
        ...DEFAULT_DESIGN_GUIDANCE_SETTINGS,
        ...existingGuidance,
        selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
        selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
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

function withProjectCreationDefaults(input: CreateProjectInput): CreateProjectInput {
  return withProjectManagerDashboardDefault(withProjectCreationDesignGuidance(input));
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
    return deps.createProject(withProjectCreationDefaults({
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
    return deps.createProject(withProjectCreationDefaults({
      ...input,
      sourceType: "git",
      sourceRef: result.remoteUrl,
      cloneDir: cloneParentDir,
      initMode: mode,
    }));
  }

  // "existing" or absent — original behavior
  return deps.createProject(withProjectCreationDefaults({ ...input, initMode: "existing" }));
}
