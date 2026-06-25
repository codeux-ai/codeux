import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import * as fs from "fs/promises";
import { ProviderRunInput } from "./provider-runner.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { CliProviderId } from "./provider-command-specs.js";

export const CONTAINER_WORKSPACE_ROOT = "/workspace";
export const CONTAINER_RUNTIME_HOME = pathPosix.join(CONTAINER_WORKSPACE_ROOT, ".code-ux-home");
export const QWEN_OPENAI_LOG_DIRNAME = "qwen-openai-logs";
export const CONTAINER_QWEN_OPENAI_LOG_DIR = pathPosix.join(CONTAINER_RUNTIME_HOME, QWEN_OPENAI_LOG_DIRNAME);

export function resolveCodexOutputPath(input: Pick<ProviderRunInput, "provider" | "workflowSettings" | "sessionId">): string | null {
  if (input.provider !== "codex") {
    return null;
  }
  return input.workflowSettings.executionMode === "DOCKER"
    ? pathPosix.join("/workspace", `provider-last-message-${input.sessionId}.txt`)
    : path.join(os.tmpdir(), `provider-last-message-${input.sessionId}.txt`);
}

export async function cleanupCodexOutputPath(
  outputPath: string | null,
  executionMode: CliWorkflowSettings["executionMode"],
  preparedCwd: string,
  removeWorkspaceDir?: (cwd: string, targetPath: string) => Promise<void>,
): Promise<void> {
  if (!outputPath) {
    return;
  }
  if (executionMode === "DOCKER" && removeWorkspaceDir) {
    await removeWorkspaceDir(preparedCwd, outputPath).catch(() => undefined);
  } else if (executionMode !== "DOCKER") {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}

export function resolveQwenHostLogDir(sessionId: string): string {
  const safeSession = (sessionId || "session").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "code-ux-qwen-openai-logs", safeSession);
}

export async function resetQwenOpenAiLogDir(
  cwd: string,
  executionMode: CliWorkflowSettings["executionMode"],
  sessionId: string,
  removeWorkspaceDir?: (cwd: string, targetPath: string) => Promise<void>,
): Promise<void> {
  if (executionMode === "DOCKER") {
    if (removeWorkspaceDir) {
      await removeWorkspaceDir(cwd, CONTAINER_QWEN_OPENAI_LOG_DIR).catch(() => undefined);
    }
    return;
  }
  const logDir = resolveQwenHostLogDir(sessionId);
  await fs.rm(logDir, { recursive: true, force: true }).catch(() => undefined);
  await fs.mkdir(logDir, { recursive: true }).catch(() => undefined);
}

export function resolveAntigravityHostLogPath(sessionId: string): string {
  const safeSession = (sessionId || "session").replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(os.tmpdir(), "code-ux-antigravity-logs", `${safeSession}.log`);
}

export function resolveAntigravityContainerLogPath(sessionId: string): string {
  const safeSession = (sessionId || "session").replace(/[^A-Za-z0-9_-]/g, "_");
  return pathPosix.join(CONTAINER_RUNTIME_HOME, "antigravity-logs", `${safeSession}.log`);
}

export async function cleanupProviderRuntimeArtifacts(
  provider: CliProviderId,
  executionMode: CliWorkflowSettings["executionMode"],
  sessionId: string,
  cwd: string,
  antigravityLogPath: string | null,
  removeWorkspaceDir?: (cwd: string, targetPath: string) => Promise<void>,
): Promise<void> {
  if (provider === "qwen-code" && executionMode !== "DOCKER") {
    await fs.rm(resolveQwenHostLogDir(sessionId), { recursive: true, force: true }).catch(() => undefined);
  }
  if (provider === "antigravity" && antigravityLogPath) {
    if (executionMode === "DOCKER" && removeWorkspaceDir) {
      await removeWorkspaceDir(cwd, antigravityLogPath).catch(() => undefined);
    } else if (executionMode !== "DOCKER") {
      await fs.rm(antigravityLogPath, { force: true }).catch(() => undefined);
    }
  }
}
