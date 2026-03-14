import { createHash } from "crypto";
import * as path from "path";
import { resolveConfiguredPath } from "../../../services/cli-docker-utils.js";
import { getHomeSprintOsPath } from "../../../shared/config/sprint-os-paths.js";

export const getDockerRuntimeBaseRoot = (): string => getHomeSprintOsPath("runtime", "docker");

export const resolveDockerRuntimeRoot = (repoPath: string): string => {
  const configured = (process.env.JULES_DOCKER_RUNTIME_ROOT || "").trim();
  if (configured.length > 0) {
    return resolveConfiguredPath(repoPath, configured);
  }
  const repoHash = createHash("sha1").update(path.resolve(repoPath)).digest("hex").slice(0, 12);
  return getHomeSprintOsPath("runtime", "docker", repoHash);
};

export const getCodexRuntimeHomePath = (runtimeRoot: string, sessionId: string): string =>
  path.join(runtimeRoot, `home-codex-${sessionId}`);
