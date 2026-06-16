import * as fs from "fs/promises";
import { createHash } from "crypto";
import * as path from "path";
import { setTimeout as delay } from "timers/promises";
import { runStreamingCommand } from "../../../services/cli-process-runner.js";

export interface DockerSetupImageCacheResult {
  image: string;
  runSetupScriptAtRuntime: boolean;
}

export interface DockerSetupImageCacheInput {
  baseImage: string;
  setupScriptPath?: string;
  cacheEnabled: boolean;
  buildIfMissing?: boolean;
  runtimeRoot: string;
  repoPath: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  mapSourcePathForDaemon: (sourcePath: string, label: string) => string;
}

const BUILD_LOCK_STALE_MS = 30 * 60 * 1000;
const BUILD_LOCK_WAIT_MS = 1_000;

export class DockerSetupImageCache {
  private static readonly inProcessBuilds = new Map<string, Promise<DockerSetupImageCacheResult>>();

  async resolveImage(input: DockerSetupImageCacheInput): Promise<DockerSetupImageCacheResult> {
    const {
      baseImage,
      setupScriptPath,
      cacheEnabled,
      buildIfMissing = true,
      runtimeRoot,
      repoPath,
      signal,
      onActivity,
      mapSourcePathForDaemon,
    } = input;

    if (!setupScriptPath) {
      if (cacheEnabled) {
        onActivity("Docker setup image cache is enabled, but no setup script was available for image prebuild.");
      }
      return { image: baseImage, runSetupScriptAtRuntime: false };
    }

    if (!cacheEnabled) {
      return { image: baseImage, runSetupScriptAtRuntime: true };
    }

    let scriptContent: string;
    try {
      scriptContent = await fs.readFile(setupScriptPath, "utf8");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onActivity(`Unable to read container setup script for image cache: ${message}. Falling back to runtime setup.`);
      return { image: baseImage, runSetupScriptAtRuntime: true };
    }

    const dockerfileContent = this.buildDockerfile(baseImage);
    const cacheKey = createHash("sha1")
      .update(baseImage)
      .update("\n")
      .update(scriptContent)
      .update("\n")
      .update(dockerfileContent)
      .digest("hex")
      .slice(0, 24);
    const imageTag = this.buildImageTag(baseImage, cacheKey);
    const cacheDir = path.join(runtimeRoot, "setup-image-cache", cacheKey);

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "setup.sh"), scriptContent, "utf8");
    await fs.writeFile(path.join(cacheDir, "Dockerfile"), this.buildDockerfile(baseImage), "utf8");

    if (await this.imageExists(imageTag, repoPath, signal)) {
      onActivity(`Using cached Docker setup image ${imageTag}.`);
      return { image: imageTag, runSetupScriptAtRuntime: false };
    }

    if (!buildIfMissing) {
      onActivity(`Cached Docker setup image ${imageTag} is missing. Falling back to runtime setup script.`);
      return { image: baseImage, runSetupScriptAtRuntime: true };
    }

    const existingBuild = DockerSetupImageCache.inProcessBuilds.get(cacheKey);
    if (existingBuild) {
      onActivity(`Waiting for cached Docker setup image ${imageTag} to finish building.`);
      return existingBuild;
    }

    const buildPromise = this.resolveMissingImage({
      imageTag,
      baseImage,
      cacheDir,
      repoPath,
      signal,
      onActivity,
      mapSourcePathForDaemon,
    });
    DockerSetupImageCache.inProcessBuilds.set(cacheKey, buildPromise);

    try {
      return await buildPromise;
    } finally {
      if (DockerSetupImageCache.inProcessBuilds.get(cacheKey) === buildPromise) {
        DockerSetupImageCache.inProcessBuilds.delete(cacheKey);
      }
    }
  }

  private buildDockerfile(baseImage: string): string {
    return [
      `FROM ${baseImage}`,
      `LABEL org.opencontainers.image.title="Code UX setup cache"`,
      `LABEL org.opencontainers.image.description="Prebuilt Code UX provider runtime setup cache"`,
      `LABEL ai.codeux.role="setup-cache"`,
      `LABEL ai.codeux.base-image="${this.escapeDockerfileLabelValue(baseImage)}"`,
      "USER root",
      "RUN if command -v apt-get >/dev/null 2>&1; then apt-get update -qy && apt-get install -qy --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*; fi",
      "COPY setup.sh /tmp/code-ux-setup.sh",
      "RUN sed -i 's/\\r//' /tmp/code-ux-setup.sh && bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh",
    ].join("\n");
  }

  private escapeDockerfileLabelValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  }

  private buildImageTag(baseImage: string, cacheKey: string): string {
    const baseSlug = baseImage
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "base";
    return `code-ux-setup-cache-${baseSlug}:${cacheKey}`;
  }

  private async resolveMissingImage(args: {
    imageTag: string;
    baseImage: string;
    cacheDir: string;
    repoPath: string;
    signal?: AbortSignal;
    onActivity: (desc: string, originator?: string) => void;
    mapSourcePathForDaemon: (sourcePath: string, label: string) => string;
  }): Promise<DockerSetupImageCacheResult> {
    const {
      imageTag,
      baseImage,
      cacheDir,
      repoPath,
      signal,
      onActivity,
      mapSourcePathForDaemon,
    } = args;
    const lockDir = `${cacheDir}.build-lock`;
    const acquiredLock = await this.acquireBuildLock(lockDir, imageTag, repoPath, signal, onActivity);

    if (!acquiredLock) {
      if (await this.imageExists(imageTag, repoPath, signal)) {
        onActivity(`Using cached Docker setup image ${imageTag}.`);
        return { image: imageTag, runSetupScriptAtRuntime: false };
      }
      onActivity(`Cached Docker setup image ${imageTag} is still missing after waiting for another build. Falling back to runtime setup script.`);
      return { image: baseImage, runSetupScriptAtRuntime: true };
    }

    try {
      if (await this.imageExists(imageTag, repoPath, signal)) {
        onActivity(`Using cached Docker setup image ${imageTag}.`);
        return { image: imageTag, runSetupScriptAtRuntime: false };
      }

      const dockerCacheDir = mapSourcePathForDaemon(cacheDir, "setup image cache");
      onActivity(`Building cached Docker setup image ${imageTag} from ${baseImage}.`);

      const buildResult = await runStreamingCommand(
        "docker",
        ["build", "-t", imageTag, dockerCacheDir],
        repoPath,
        process.env,
        {
          signal,
          onStdoutLine: (line) => onActivity(`[docker-build] ${line}`),
          onStderrLine: (line) => onActivity(`[docker-build] ${line}`),
        }
      );

      if (!buildResult.ok) {
        onActivity(`Cached Docker setup image build failed for ${imageTag}. Falling back to runtime setup script.`);
        return { image: baseImage, runSetupScriptAtRuntime: true };
      }

      onActivity(`Built cached Docker setup image ${imageTag}.`);
      return { image: imageTag, runSetupScriptAtRuntime: false };
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async acquireBuildLock(
    lockDir: string,
    imageTag: string,
    repoPath: string,
    signal: AbortSignal | undefined,
    onActivity: (desc: string, originator?: string) => void,
  ): Promise<boolean> {
    let loggedWait = false;
    for (;;) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error ? signal.reason : new Error("Docker setup image build was aborted.");
      }

      try {
        await fs.mkdir(lockDir);
        return true;
      } catch (error) {
        if (!this.isFileAlreadyExistsError(error)) {
          throw error;
        }
      }

      if (await this.imageExists(imageTag, repoPath, signal)) {
        return false;
      }

      await this.removeStaleBuildLock(lockDir);
      if (!loggedWait) {
        onActivity(`Waiting for cached Docker setup image ${imageTag} to finish building.`);
        loggedWait = true;
      }
      await delay(BUILD_LOCK_WAIT_MS, undefined, { signal });
    }
  }

  private async removeStaleBuildLock(lockDir: string): Promise<void> {
    try {
      const stats = await fs.stat(lockDir);
      if (Date.now() - stats.mtimeMs >= BUILD_LOCK_STALE_MS) {
        await fs.rm(lockDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort stale lock cleanup. The next loop will retry mkdir.
    }
  }

  private async imageExists(imageTag: string, repoPath: string, signal?: AbortSignal): Promise<boolean> {
    const inspectResult = await runStreamingCommand("docker", ["image", "inspect", imageTag], repoPath, process.env, { signal });
    return inspectResult.ok;
  }

  private isFileAlreadyExistsError(error: unknown): boolean {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "EEXIST";
  }
}
