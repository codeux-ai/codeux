import * as fs from "fs/promises";
import { createHash } from "crypto";
import * as path from "path";
import { setTimeout as delay } from "timers/promises";
import { runStreamingCommand } from "../../../services/cli-process-runner.js";

export interface DockerSetupImageCacheResult {
  image: string;
  runSetupScriptAtRuntime: boolean;
}

export type DockerSetupImageCacheProgressKind =
  | "cache_miss"
  | "lock_wait"
  | "build_start"
  | "build_step"
  | "build_success"
  | "build_failure_fallback";

export interface DockerSetupImageCacheProgress {
  kind: DockerSetupImageCacheProgressKind;
  imageTag: string;
  baseImage: string;
  message: string;
  progressPercent: number;
  stepText?: string;
  rawLine?: string;
}

export interface DockerSetupImageCacheInput {
  baseImage: string;
  setupScriptPath?: string;
  cacheEnabled: boolean;
  installPlaywrightBrowsers?: boolean;
  buildIfMissing?: boolean;
  runtimeRoot: string;
  repoPath: string;
  signal?: AbortSignal;
  onActivity: (desc: string, originator?: string) => void;
  onProgress?: (progress: DockerSetupImageCacheProgress) => void;
  mapSourcePathForDaemon: (sourcePath: string, label: string) => string;
}

const BUILD_LOCK_STALE_MS = 30 * 60 * 1000;
const BUILD_LOCK_WAIT_MS = 1_000;
const PLAYWRIGHT_CACHED_BROWSERS_PATH = "/ms-playwright";

interface InProcessBuild {
  promise: Promise<DockerSetupImageCacheResult>;
  subscribers: Set<(progress: DockerSetupImageCacheProgress) => void>;
}

class DockerBuildProgressTracker {
  private lastPercent = 0;
  private indeterminatePercent = 10;

  parse(line: string): { stepText: string; progressPercent: number } {
    const trimmed = line.trim();
    const numberedStep = trimmed.match(/^Step\s+(\d+)\s*\/\s*(\d+)\s*:\s*(.+)$/i);
    if (numberedStep) {
      return this.fromKnownTotal(numberedStep[3].trim(), Number(numberedStep[1]), Number(numberedStep[2]));
    }

    const buildKitStep = trimmed.match(/^#\d+\s+\[(?:(?:[^\]]+)\s+)?(\d+)\s*\/\s*(\d+)\]\s+(.+)$/);
    if (buildKitStep) {
      return this.fromKnownTotal(buildKitStep[3].trim(), Number(buildKitStep[1]), Number(buildKitStep[2]));
    }

    const buildKitInternal = trimmed.match(/^#\d+\s+\[(.+)\]\s+(.+)$/);
    if (buildKitInternal) {
      return {
        stepText: `${buildKitInternal[1].trim()}: ${buildKitInternal[2].trim()}`,
        progressPercent: this.nextIndeterminatePercent(),
      };
    }

    return {
      stepText: trimmed,
      progressPercent: this.nextIndeterminatePercent(),
    };
  }

  private fromKnownTotal(stepText: string, current: number, total: number): { stepText: string; progressPercent: number } {
    const boundedCurrent = Number.isFinite(current) && current > 0 ? current : 1;
    const boundedTotal = Number.isFinite(total) && total > 0 ? total : boundedCurrent;
    const percent = Math.min(95, Math.max(10, Math.round((boundedCurrent / boundedTotal) * 90)));
    this.lastPercent = Math.max(this.lastPercent, percent);
    return { stepText, progressPercent: this.lastPercent };
  }

  private nextIndeterminatePercent(): number {
    this.indeterminatePercent = Math.min(90, this.indeterminatePercent + 3);
    this.lastPercent = Math.max(this.lastPercent, this.indeterminatePercent);
    return this.lastPercent;
  }
}

export class DockerSetupImageCache {
  private static readonly inProcessBuilds = new Map<string, InProcessBuild>();

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
      onProgress,
      mapSourcePathForDaemon,
    } = input;
    const installPlaywrightBrowsers = input.installPlaywrightBrowsers === true;

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

    const dockerfileContent = this.buildDockerfile(baseImage, installPlaywrightBrowsers);
    const cacheKey = createHash("sha1")
      .update(baseImage)
      .update("\n")
      .update(installPlaywrightBrowsers ? "playwright=1" : "playwright=0")
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
    await fs.writeFile(path.join(cacheDir, "Dockerfile"), dockerfileContent, "utf8");

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
      this.subscribeToBuild(existingBuild, onProgress);
      this.emitProgress(onProgress, {
        kind: "lock_wait",
        imageTag,
        baseImage,
        message: `Waiting for cached Docker setup image ${imageTag} to finish building.`,
        progressPercent: 1,
      });
      return existingBuild.promise;
    }

    onActivity(`Cached Docker setup image ${imageTag} is missing. Building it now; the first build may take a few minutes, and future invocations will use the cached image.`);
    this.emitProgress(onProgress, {
      kind: "cache_miss",
      imageTag,
      baseImage,
      message: `Docker setup image cache miss for ${imageTag}. First build may take a few minutes; future invocations use the cached image.`,
      progressPercent: 0,
    });
    const subscribers = new Set<(progress: DockerSetupImageCacheProgress) => void>();
    this.subscribeToBuild({ subscribers }, onProgress);
    const emitProgress = (progress: DockerSetupImageCacheProgress): void => {
      for (const subscriber of subscribers) {
        subscriber(progress);
      }
    };
    const buildPromise = this.resolveMissingImage({
      imageTag,
      baseImage,
      cacheDir,
      repoPath,
      signal,
      onActivity,
      onProgress: emitProgress,
      mapSourcePathForDaemon,
    });
    DockerSetupImageCache.inProcessBuilds.set(cacheKey, { promise: buildPromise, subscribers });

    try {
      return await buildPromise;
    } finally {
      if (DockerSetupImageCache.inProcessBuilds.get(cacheKey)?.promise === buildPromise) {
        DockerSetupImageCache.inProcessBuilds.delete(cacheKey);
      }
    }
  }

  private buildDockerfile(baseImage: string, installPlaywrightBrowsers: boolean): string {
    return [
      `FROM ${baseImage}`,
      `LABEL org.opencontainers.image.title="Code UX setup cache"`,
      `LABEL org.opencontainers.image.description="Prebuilt Code UX provider runtime setup cache"`,
      `LABEL ai.codeux.role="setup-cache"`,
      `LABEL ai.codeux.base-image="${this.escapeDockerfileLabelValue(baseImage)}"`,
      "USER root",
      `ENV CODE_UX_INSTALL_PLAYWRIGHT=${installPlaywrightBrowsers ? "1" : "0"}`,
      ...(installPlaywrightBrowsers ? [`ENV PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_CACHED_BROWSERS_PATH}`] : []),
      "RUN if command -v apt-get >/dev/null 2>&1; then apt-get update -qy && apt-get install -qy --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*; fi",
      "COPY setup.sh /tmp/code-ux-setup.sh",
      "RUN sed -i 's/\\r//' /tmp/code-ux-setup.sh && bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh && if [ \"$CODE_UX_INSTALL_PLAYWRIGHT\" = \"1\" ]; then mkdir -p \"$PLAYWRIGHT_BROWSERS_PATH\" && if ! ls -d \"$PLAYWRIGHT_BROWSERS_PATH\"/chromium-* >/dev/null 2>&1; then npx -y playwright@latest install --with-deps chromium; fi && chmod -R a+rX \"$PLAYWRIGHT_BROWSERS_PATH\"; fi && rm -rf /var/lib/apt/lists/*",
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
    onProgress?: (progress: DockerSetupImageCacheProgress) => void;
    mapSourcePathForDaemon: (sourcePath: string, label: string) => string;
  }): Promise<DockerSetupImageCacheResult> {
    const {
      imageTag,
      baseImage,
      cacheDir,
      repoPath,
      signal,
      onActivity,
      onProgress,
      mapSourcePathForDaemon,
    } = args;
    const lockDir = `${cacheDir}.build-lock`;
    const acquiredLock = await this.acquireBuildLock(lockDir, imageTag, baseImage, repoPath, signal, onActivity, onProgress);

    if (!acquiredLock) {
      if (await this.imageExists(imageTag, repoPath, signal)) {
        onActivity(`Using cached Docker setup image ${imageTag}.`);
        return { image: imageTag, runSetupScriptAtRuntime: false };
      }
      onActivity(`Cached Docker setup image ${imageTag} is still missing after waiting for another build. Falling back to runtime setup script.`);
      this.emitProgress(onProgress, {
        kind: "build_failure_fallback",
        imageTag,
        baseImage,
        message: `Docker setup image ${imageTag} was still missing after waiting. Falling back to runtime setup script.`,
        progressPercent: 100,
      });
      return { image: baseImage, runSetupScriptAtRuntime: true };
    }

    try {
      if (await this.imageExists(imageTag, repoPath, signal)) {
        onActivity(`Using cached Docker setup image ${imageTag}.`);
        return { image: imageTag, runSetupScriptAtRuntime: false };
      }

      const dockerCacheDir = mapSourcePathForDaemon(cacheDir, "setup image cache");
      onActivity(`Building cached Docker setup image ${imageTag} from ${baseImage}.`);
      this.emitProgress(onProgress, {
        kind: "build_start",
        imageTag,
        baseImage,
        message: `Building cached Docker setup image ${imageTag} from ${baseImage}.`,
        progressPercent: 5,
      });
      const progressTracker = new DockerBuildProgressTracker();
      const emitBuildLine = (line: string): void => {
        onActivity(`[docker-build] ${line}`);
        const parsed = progressTracker.parse(line);
        this.emitProgress(onProgress, {
          kind: "build_step",
          imageTag,
          baseImage,
          message: parsed.stepText ? `Docker setup image build: ${parsed.stepText}` : "Docker setup image build is progressing.",
          progressPercent: parsed.progressPercent,
          stepText: parsed.stepText,
          rawLine: line,
        });
      };

      const buildResult = await runStreamingCommand(
        "docker",
        ["build", "-t", imageTag, dockerCacheDir],
        repoPath,
        process.env,
        {
          signal,
          onStdoutLine: emitBuildLine,
          onStderrLine: emitBuildLine,
        }
      );

      if (!buildResult.ok) {
        onActivity(`Cached Docker setup image build failed for ${imageTag}. Falling back to runtime setup script. Future invocations will retry the cached image build.`);
        this.emitProgress(onProgress, {
          kind: "build_failure_fallback",
          imageTag,
          baseImage,
          message: `Docker setup image build failed for ${imageTag}. Falling back to runtime setup script.`,
          progressPercent: 100,
        });
        return { image: baseImage, runSetupScriptAtRuntime: true };
      }

      onActivity(`Built cached Docker setup image ${imageTag}.`);
      this.emitProgress(onProgress, {
        kind: "build_success",
        imageTag,
        baseImage,
        message: `Built cached Docker setup image ${imageTag}. Future invocations will use this cached image.`,
        progressPercent: 100,
      });
      return { image: imageTag, runSetupScriptAtRuntime: false };
    } finally {
      await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async acquireBuildLock(
    lockDir: string,
    imageTag: string,
    baseImage: string,
    repoPath: string,
    signal: AbortSignal | undefined,
    onActivity: (desc: string, originator?: string) => void,
    onProgress: ((progress: DockerSetupImageCacheProgress) => void) | undefined,
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
        this.emitProgress(onProgress, {
          kind: "lock_wait",
          imageTag,
          baseImage,
          message: `Waiting for cached Docker setup image ${imageTag} to finish building.`,
          progressPercent: 1,
        });
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

  private subscribeToBuild(
    build: Pick<InProcessBuild, "subscribers">,
    onProgress: ((progress: DockerSetupImageCacheProgress) => void) | undefined,
  ): void {
    if (onProgress) {
      build.subscribers.add(onProgress);
    }
  }

  private emitProgress(
    onProgress: ((progress: DockerSetupImageCacheProgress) => void) | undefined,
    progress: DockerSetupImageCacheProgress,
  ): void {
    onProgress?.({
      ...progress,
      progressPercent: Math.max(0, Math.min(100, Math.round(progress.progressPercent))),
    });
  }

  private isFileAlreadyExistsError(error: unknown): boolean {
    return typeof error === "object"
      && error !== null
      && "code" in error
      && (error as NodeJS.ErrnoException).code === "EEXIST";
  }
}
