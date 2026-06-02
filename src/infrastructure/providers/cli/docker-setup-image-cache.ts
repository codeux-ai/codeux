import * as fs from "fs/promises";
import { createHash } from "crypto";
import * as path from "path";
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

export class DockerSetupImageCache {
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
    const imageTag = `code-ux-setup-cache:${cacheKey}`;
    const cacheDir = path.join(runtimeRoot, "setup-image-cache", cacheKey);

    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(path.join(cacheDir, "setup.sh"), scriptContent, "utf8");
    await fs.writeFile(path.join(cacheDir, "Dockerfile"), this.buildDockerfile(baseImage), "utf8");

    const inspectResult = await runStreamingCommand("docker", ["image", "inspect", imageTag], repoPath, process.env, { signal });
    if (inspectResult.ok) {
      onActivity(`Using cached Docker setup image ${imageTag}.`);
      return { image: imageTag, runSetupScriptAtRuntime: false };
    }

    if (!buildIfMissing) {
      onActivity(`Cached Docker setup image ${imageTag} is missing. Falling back to runtime setup script.`);
      return { image: baseImage, runSetupScriptAtRuntime: true };
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
  }

  private buildDockerfile(baseImage: string): string {
    return [
      `FROM ${baseImage}`,
      "USER root",
      "RUN if command -v apt-get >/dev/null 2>&1; then apt-get update -qy && apt-get install -qy --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*; fi",
      "COPY setup.sh /tmp/code-ux-setup.sh",
      "RUN sed -i 's/\\r//' /tmp/code-ux-setup.sh && bash /tmp/code-ux-setup.sh && rm -f /tmp/code-ux-setup.sh",
    ].join("\n");
  }
}
