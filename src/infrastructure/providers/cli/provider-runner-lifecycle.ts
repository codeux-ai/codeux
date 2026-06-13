import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import type { IDockerRunner } from "./docker-runner.js";
import type { CliWorkflowSettings } from "../../../contracts/app-types.js";
import type { ProviderRunInput } from "./provider-runner-types.js";

export interface PreparedProviderRun {
  cwd: string;
  codexOutputPath: string | null;
}

/**
 * Shared lifecycle helper for preparing the execution environment (Docker workspace, 
 * output paths) and ensuring cleanup after a provider run.
 */
export async function runProviderWithLifecycle<T>(
  input: ProviderRunInput,
  dockerRunner: IDockerRunner,
  callback: (prepared: PreparedProviderRun) => Promise<T>,
): Promise<T> {
  const { workflowSettings, sessionId, workspaceSessionId, cwd, repoPath, provider } = input;
  const executionMode = workflowSettings.executionMode;

  const preserveSessionWorkspace = shouldPreserveSessionWorkspace(input);
  const prepared = executionMode === "DOCKER"
    ? await dockerRunner.ensureWorkspace({
      cwd: cwd,
      repoPath: repoPath,
      sessionId: workspaceSessionId || sessionId,
      preserve: preserveSessionWorkspace,
      reuseExisting: preserveSessionWorkspace,
    })
    : { cwd: cwd, cleanup: async () => undefined };

  const codexOutputPath = resolveCodexOutputPath(input);

  if (codexOutputPath && !codexOutputPath.startsWith("/workspace/")) {
    await fs.mkdir(path.dirname(codexOutputPath), { recursive: true });
  }

  try {
    return await callback({
      cwd: prepared.cwd,
      codexOutputPath,
    });
  } finally {
    await prepared.cleanup();
    await cleanupCodexOutputPath(dockerRunner, codexOutputPath, executionMode, prepared.cwd);
  }
}

function resolveCodexOutputPath(input: ProviderRunInput): string | null {
  if (input.provider !== "codex") {
    return null;
  }
  return input.workflowSettings.executionMode === "DOCKER"
    ? pathPosix.join("/workspace", `provider-last-message-${input.sessionId}.txt`)
    : path.join(os.tmpdir(), `provider-last-message-${input.sessionId}.txt`);
}

function shouldPreserveSessionWorkspace(input: ProviderRunInput): boolean {
  return input.workflowSettings.executionMode === "DOCKER"
    && !input.cwd.startsWith("docker-volume://");
}

async function cleanupCodexOutputPath(
  dockerRunner: IDockerRunner,
  outputPath: string | null,
  executionMode: CliWorkflowSettings["executionMode"],
  preparedCwd: string,
): Promise<void> {
  if (!outputPath) {
    return;
  }
  if (executionMode === "DOCKER") {
    if (dockerRunner.removeWorkspaceDir) {
      await dockerRunner.removeWorkspaceDir(preparedCwd, outputPath).catch(() => undefined);
    }
  } else {
    await fs.rm(outputPath, { force: true }).catch(() => undefined);
  }
}
