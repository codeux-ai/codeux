import os from "os";
import * as path from "path";

export const CODE_UX_DIRNAME = ".code-ux";
export const CODE_UX_SERVICE_NAME = "code-ux";
export const CODE_UX_DISPLAY_NAME = "Code UX";

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

export function getCodeUxSubtasksDir(repoPath: string, sprintNumber: number): string {
  return getRepoCodeUxPath(repoPath, "sprints", `sprint${sprintNumber}-subtasks`);
}

export function getRepoDebugLogPath(repoPath: string): string {
  return getRepoCodeUxPath(repoPath, "debug.log");
}
