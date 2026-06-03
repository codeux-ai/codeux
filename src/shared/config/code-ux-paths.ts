import os from "os";
import * as path from "path";
import { createRequire } from "module";

const { version } = createRequire(import.meta.url)("../../../package.json") as { version: string };

export const CODE_UX_DIRNAME = ".code-ux";
export const CODE_UX_SERVICE_NAME = "code-ux";
export const CODE_UX_DISPLAY_NAME = "Code UX";
export const CODE_UX_VERSION: string = version;
export const CODEX_UX_DIRNAME = ".codex-ux";

export function getRelativeCodeUxPath(...segments: string[]): string {
  return path.join(CODE_UX_DIRNAME, ...segments);
}

export function getRepoCodeUxDir(repoPath: string): string {
  return path.join(repoPath, CODE_UX_DIRNAME);
}

export function getRepoCodeUxPath(repoPath: string, ...segments: string[]): string {
  return path.join(getRepoCodeUxDir(repoPath), ...segments);
}

export function getHomeCodeUxDir(): string {
  return path.join(os.homedir(), CODE_UX_DIRNAME);
}

export function getHomeCodeUxPath(...segments: string[]): string {
  return path.join(getHomeCodeUxDir(), ...segments);
}

export function getHomeCodexUxDir(): string {
  return path.join(os.homedir(), CODEX_UX_DIRNAME);
}

export function getHomeCodexUxProjectsPath(): string {
  return path.join(getHomeCodexUxDir(), "projects");
}

export function getHomeCodexUxProjectPath(projectSlug: string): string {
  return path.join(getHomeCodexUxProjectsPath(), projectSlug);
}

export function getCodeUxSubtasksDir(repoPath: string, sprintNumber: number): string {
  return getRepoCodeUxPath(repoPath, "sprints", `sprint${sprintNumber}-subtasks`);
}

export function getRepoDebugLogPath(repoPath: string): string {
  return getRepoCodeUxPath(repoPath, "debug.log");
}
