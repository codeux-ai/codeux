import * as fs from "fs/promises";
import * as path from "path";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { runCommandStrict } from "./cli-process-runner.js";
import type { CreateProjectInput } from "../contracts/project-management-types.js";

const isPathWithin = (basePath: string, targetPath: string): boolean => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

export function deriveGitCloneRepoName(sourceRef: string): string {
  const cleaned = sourceRef
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const segment = cleaned.split(/[/:]/).filter(Boolean).pop() || cleaned;
  const safe = segment
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safe) {
    throw new Error(`Cannot derive repository directory name from Git URL: ${sourceRef}`);
  }
  return safe;
}

export function getDefaultProjectCloneRoot(): string {
  return getHomeCodeUxPath("projects");
}

function buildGitAuthEnv(sourceRef: string, githubToken?: string): NodeJS.ProcessEnv {
  const token = githubToken?.trim();
  if (!token || !sourceRef.includes("github.com")) {
    return process.env;
  }

  const existingCount = Number.parseInt(process.env.GIT_CONFIG_COUNT || "0", 10);
  const index = Number.isFinite(existingCount) && existingCount >= 0 ? existingCount : 0;
  return {
    ...process.env,
    GIT_CONFIG_COUNT: String(index + 1),
    [`GIT_CONFIG_KEY_${index}`]: "http.https://github.com/.extraheader",
    [`GIT_CONFIG_VALUE_${index}`]: `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
  };
}

function normalizeRemoteForCompare(value: string): string {
  return value.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function isDirectoryEmpty(targetPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(targetPath);
    return entries.length === 0;
  } catch {
    return false;
  }
}

async function getExactGitWorktreeRoot(targetPath: string): Promise<string | null> {
  try {
    const result = await runCommandStrict("git", ["rev-parse", "--show-toplevel"], targetPath);
    const root = result.stdout.trim();
    return root ? path.resolve(root) : null;
  } catch {
    return null;
  }
}

async function ensureExistingCloneMatchesRemote(
  targetPath: string,
  sourceRef: string,
  options: { githubToken?: string } = {},
): Promise<void> {
  const root = await getExactGitWorktreeRoot(targetPath);
  if (root !== path.resolve(targetPath)) {
    throw new Error(`Git project checkout path exists but is not a repository root: ${targetPath}`);
  }

  const remote = (await runCommandStrict("git", ["remote", "get-url", "origin"], targetPath)).stdout.trim();
  if (remote && normalizeRemoteForCompare(remote) !== normalizeRemoteForCompare(sourceRef)) {
    throw new Error(`Git project checkout at ${targetPath} already uses origin ${remote}, expected ${sourceRef}`);
  }

  await runCommandStrict("git", ["fetch", "origin", "--prune"], targetPath, buildGitAuthEnv(sourceRef, options.githubToken));
}

export async function prepareGitProjectCreateInput(
  input: CreateProjectInput,
  options: { githubToken?: string } = {},
): Promise<CreateProjectInput> {
  if (input.sourceType !== "git") {
    return input;
  }

  const sourceRef = input.sourceRef.trim();
  if (!sourceRef) {
    throw new Error("Git project sourceRef is required.");
  }

  const cloneRoot = path.resolve(input.cloneDir?.trim() || getDefaultProjectCloneRoot());
  const repoName = deriveGitCloneRepoName(sourceRef);
  const targetPath = path.resolve(cloneRoot, repoName);

  if (!isPathWithin(cloneRoot, targetPath)) {
    throw new Error(`Resolved Git clone path is outside the clone root: ${targetPath}`);
  }

  await fs.mkdir(cloneRoot, { recursive: true });

  if (await directoryExists(targetPath)) {
    if (await isDirectoryEmpty(targetPath)) {
      await runCommandStrict("git", ["clone", sourceRef, targetPath], cloneRoot, buildGitAuthEnv(sourceRef, options.githubToken));
    } else {
      await ensureExistingCloneMatchesRemote(targetPath, sourceRef, options);
    }
  } else {
    await runCommandStrict("git", ["clone", sourceRef, targetPath], cloneRoot, buildGitAuthEnv(sourceRef, options.githubToken));
  }

  return {
    ...input,
    sourceRef,
    cloneDir: cloneRoot,
  };
}
