import os from "os";
import * as path from "path";

export const CODEX_UX_DIRNAME = ".codex-ux";

export function getHomeCodexUxDir(): string {
  return path.join(os.homedir(), CODEX_UX_DIRNAME);
}

export function getHomeCodexUxProjectsPath(): string {
  return path.join(getHomeCodexUxDir(), "projects");
}

export function getHomeCodexUxProjectPath(projectSlug: string): string {
  return path.join(getHomeCodexUxProjectsPath(), projectSlug);
}
