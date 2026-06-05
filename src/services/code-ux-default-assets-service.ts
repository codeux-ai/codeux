import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { Logger } from "../shared/logging/logger.js";

const DEFAULT_AGENT_FILES = [
  "planning_agent.md",
  "iris.md",
  "quality_assurance_agent.md",
  "worker.md",
] as const;

const DEFAULT_CONTAINER_SETUP_FILE = "setup.sh";

interface EnsureDefaultCodeUxAssetsOptions {
  projectRoot?: string;
  logger?: Pick<Logger, "info" | "warn">;
  skipDefaultAgentFiles?: boolean;
}

interface InstalledAsset {
  sourcePath: string;
  targetPath: string;
}

export interface EnsureDefaultCodeUxAssetsResult {
  sourceDir: string | null;
  installed: InstalledAsset[];
}

export async function ensureDefaultCodeUxAssetsInstalled(
  options: EnsureDefaultCodeUxAssetsOptions = {},
): Promise<EnsureDefaultCodeUxAssetsResult> {
  return await installDefaultCodeUxAssets(options);
}

async function installDefaultCodeUxAssets(
  options: EnsureDefaultCodeUxAssetsOptions,
): Promise<EnsureDefaultCodeUxAssetsResult> {
  if (process.env.NODE_ENV === "test" && process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS !== "1") {
    return { sourceDir: null, installed: [] };
  }

  const sourceDir = await resolveBundledCodeUxDir(options.projectRoot);
  if (!sourceDir) {
    options.logger?.warn("Code UX default assets were not found; user defaults were not seeded.");
    return { sourceDir: null, installed: [] };
  }

  const installed: InstalledAsset[] = [];

  if (!options.skipDefaultAgentFiles) {
    for (const fileName of DEFAULT_AGENT_FILES) {
      const asset = await copyIfMissing(
        path.join(sourceDir, "agents", fileName),
        getHomeCodeUxPath("agents", fileName),
      );
      if (asset) installed.push(asset);
    }
  }

  const setupAsset = await copyOrUpdateSetupScript(
    path.join(sourceDir, "container", DEFAULT_CONTAINER_SETUP_FILE),
    getHomeCodeUxPath("container", DEFAULT_CONTAINER_SETUP_FILE),
    0o755,
  );
  if (setupAsset) installed.push(setupAsset);

  if (installed.length > 0) {
    options.logger?.info("Seeded missing Code UX default assets into the user directory.", {
      sourceDir,
      installedCount: installed.length,
    });
  }

  return { sourceDir, installed };
}

async function resolveBundledCodeUxDir(projectRoot?: string): Promise<string | null> {
  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    projectRoot ? path.join(projectRoot, ".code-ux") : "",
    path.resolve(serviceDir, "../../.code-ux"),
    resourcesPath ? path.join(resourcesPath, ".code-ux-defaults") : "",
    resourcesPath ? path.join(resourcesPath, ".code-ux") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await hasRequiredDefaultAssets(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function hasRequiredDefaultAssets(candidate: string): Promise<boolean> {
  const requiredPaths = [
    ...DEFAULT_AGENT_FILES.map((fileName) => path.join(candidate, "agents", fileName)),
    path.join(candidate, "container", DEFAULT_CONTAINER_SETUP_FILE),
  ];

  for (const requiredPath of requiredPaths) {
    try {
      await fs.access(requiredPath);
    } catch {
      return false;
    }
  }

  return true;
}

async function copyIfMissing(
  sourcePath: string,
  targetPath: string,
  mode?: number,
): Promise<InstalledAsset | null> {
  try {
    await fs.access(targetPath);
    return null;
  } catch {
    // Missing target; copy below.
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  if (mode && process.platform !== "win32") {
    await fs.chmod(targetPath, mode);
  }
  return { sourcePath, targetPath };
}

async function copyOrUpdateSetupScript(
  sourcePath: string,
  targetPath: string,
  mode?: number,
): Promise<InstalledAsset | null> {
  let needsUpdate = false;
  try {
    const targetContent = await fs.readFile(targetPath, "utf8");
    if (!targetContent.includes("gnome-keyring-daemon")) {
      needsUpdate = true;
    }
  } catch {
    needsUpdate = true;
  }

  if (!needsUpdate) {
    return null;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourcePath, targetPath);
  if (mode && process.platform !== "win32") {
    await fs.chmod(targetPath, mode);
  }
  return { sourcePath, targetPath };
}
