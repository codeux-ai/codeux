import * as fs from "fs/promises";
import * as path from "path";
import { fileURLToPath } from "url";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { Logger } from "../shared/logging/logger.js";

export const DEFAULT_AGENT_FILES = [
  "planning_agent.md",
  "project_manager.md",
  "quality_assurance_agent.md",
  "worker.md",
] as const;

const DEFAULT_CONTAINER_SETUP_FILE = "setup.sh";
const DEFAULT_QUICKSPRINT_TEMPLATE_DIR = path.join("quicksprints", "templates");
const DEFAULT_ASSET_REVALIDATION_INTERVAL_MS = 5 * 60_000;

interface DefaultAssetInstallState {
  inFlight: Promise<EnsureDefaultCodeUxAssetsResult> | null;
  sourceDir: string | null;
  targetDirectorySignature: string;
  verifiedAt: number;
}

const defaultAssetInstallStates = new Map<string, DefaultAssetInstallState>();

interface EnsureDefaultCodeUxAssetsOptions {
  projectRoot?: string;
  logger?: Pick<Logger, "info" | "warn">;
  skipDefaultAgentFiles?: boolean;
}

interface ResolveBundledCodeUxDirOptions {
  projectRoot?: string;
  requireQuicksprintTemplates?: boolean;
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
  if (process.env.NODE_ENV === "test" && process.env.CODE_UX_ENABLE_DEFAULT_ASSET_INSTALL_IN_TESTS !== "1") {
    return { sourceDir: null, installed: [] };
  }

  const cacheKey = [
    getHomeCodeUxPath(),
    options.projectRoot ? path.resolve(options.projectRoot) : "runtime-defaults",
    options.skipDefaultAgentFiles ? "skip-agents" : "all-assets",
  ].join("\0");
  const now = Date.now();
  const existingState = defaultAssetInstallStates.get(cacheKey);
  if (existingState?.inFlight) {
    return await existingState.inFlight;
  }

  const installPromise = (async (): Promise<EnsureDefaultCodeUxAssetsResult> => {
    if (existingState && now - existingState.verifiedAt < DEFAULT_ASSET_REVALIDATION_INTERVAL_MS) {
      const targetDirectorySignature = existingState.sourceDir
        ? await buildDefaultAssetTargetDirectorySignature()
        : existingState.targetDirectorySignature;
      if (targetDirectorySignature === existingState.targetDirectorySignature) {
        return { sourceDir: existingState.sourceDir, installed: [] };
      }
    }
    return await installDefaultCodeUxAssets(options);
  })();
  defaultAssetInstallStates.set(cacheKey, {
    inFlight: installPromise,
    sourceDir: existingState?.sourceDir ?? null,
    targetDirectorySignature: existingState?.targetDirectorySignature ?? "",
    verifiedAt: existingState?.verifiedAt ?? 0,
  });

  try {
    const result = await installPromise;
    defaultAssetInstallStates.set(cacheKey, {
      inFlight: null,
      sourceDir: result.sourceDir,
      targetDirectorySignature: result.sourceDir
        ? await buildDefaultAssetTargetDirectorySignature()
        : "",
      verifiedAt: Date.now(),
    });
    return result;
  } catch (error) {
    if (defaultAssetInstallStates.get(cacheKey)?.inFlight === installPromise) {
      defaultAssetInstallStates.delete(cacheKey);
    }
    throw error;
  }
}

async function buildDefaultAssetTargetDirectorySignature(): Promise<string> {
  const targetPaths = [
    getHomeCodeUxPath("agents"),
    getHomeCodeUxPath("container"),
    getHomeCodeUxPath("quicksprints", "templates"),
    ...DEFAULT_AGENT_FILES.map((fileName) => getHomeCodeUxPath("agents", fileName)),
    getHomeCodeUxPath("container", DEFAULT_CONTAINER_SETUP_FILE),
  ];
  const stats = await Promise.all(targetPaths.map(async (targetPath) => {
    try {
      const stat = await fs.stat(targetPath, { bigint: true });
      return `${targetPath}:${stat.mtimeNs}:${stat.size}`;
    } catch {
      return `${targetPath}:missing`;
    }
  }));
  return stats.join("\0");
}

export async function readDefaultContainerSetupScript(
  options: Pick<EnsureDefaultCodeUxAssetsOptions, "projectRoot" | "logger"> = {},
): Promise<string | null> {
  const sourceDir = await resolveBundledCodeUxDir({ projectRoot: options.projectRoot });
  if (!sourceDir) {
    options.logger?.warn("Code UX default container setup script was not found.");
    return null;
  }

  try {
    return await fs.readFile(path.join(sourceDir, "container", DEFAULT_CONTAINER_SETUP_FILE), "utf8");
  } catch (error) {
    options.logger?.warn("Failed to read Code UX default container setup script.", {
      sourceDir,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function installDefaultCodeUxAssets(
  options: EnsureDefaultCodeUxAssetsOptions,
): Promise<EnsureDefaultCodeUxAssetsResult> {
  const sourceDir = await resolveBundledCodeUxDir({ projectRoot: options.projectRoot });
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

  const quicksprintTemplateDir = path.join(sourceDir, DEFAULT_QUICKSPRINT_TEMPLATE_DIR);
  const quicksprintTemplateFiles = await fs.readdir(quicksprintTemplateDir).catch(() => []);
  for (const fileName of quicksprintTemplateFiles) {
    if (!isQuicksprintTemplateFile(fileName)) {
      continue;
    }
    const asset = await copyIfMissing(
      path.join(quicksprintTemplateDir, fileName),
      getHomeCodeUxPath("quicksprints", "templates", fileName),
    );
    if (asset) installed.push(asset);
  }

  if (installed.length > 0) {
    options.logger?.info("Seeded missing Code UX default assets into the user directory.", {
      sourceDir,
      installedCount: installed.length,
    });
  }

  return { sourceDir, installed };
}

export async function resolveBundledCodeUxDir(
  options: ResolveBundledCodeUxDirOptions = {},
): Promise<string | null> {
  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    options.projectRoot ? path.join(options.projectRoot, ".code-ux") : "",
    path.resolve(serviceDir, "../../.code-ux"),
    resourcesPath ? path.join(resourcesPath, ".code-ux-defaults") : "",
    resourcesPath ? path.join(resourcesPath, ".code-ux") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await hasRequiredDefaultAssets(candidate, {
      requireQuicksprintTemplates: options.requireQuicksprintTemplates ?? true,
    })) {
      return candidate;
    }
  }

  return null;
}

async function hasRequiredDefaultAssets(
  candidate: string,
  options: { requireQuicksprintTemplates: boolean },
): Promise<boolean> {
  const requiredPaths = [
    ...DEFAULT_AGENT_FILES.map((fileName) => path.join(candidate, "agents", fileName)),
    path.join(candidate, "container", DEFAULT_CONTAINER_SETUP_FILE),
  ];
  if (options.requireQuicksprintTemplates) {
    requiredPaths.push(path.join(candidate, DEFAULT_QUICKSPRINT_TEMPLATE_DIR));
  }

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

function isQuicksprintTemplateFile(fileName: string): boolean {
  return fileName.toLowerCase().endsWith(".md");
}

async function copyOrUpdateSetupScript(
  sourcePath: string,
  targetPath: string,
  mode?: number,
): Promise<InstalledAsset | null> {
  const sourceContent = await fs.readFile(sourcePath, "utf8");
  let needsUpdate = true;
  try {
    const targetContent = await fs.readFile(targetPath, "utf8");
    needsUpdate = targetContent !== sourceContent && isLegacyManagedSetupScript(targetContent);
  } catch {
    needsUpdate = true;
  }

  if (!needsUpdate) {
    return null;
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, sourceContent, "utf8");
  if (mode && process.platform !== "win32") {
    await fs.chmod(targetPath, mode);
  }
  return { sourcePath, targetPath };
}

function isLegacyManagedSetupScript(content: string): boolean {
  return content.includes('echo "[setup] Starting container bootstrap..."')
    && content.includes('echo "[setup] Installing @openai/codex..."');
}
