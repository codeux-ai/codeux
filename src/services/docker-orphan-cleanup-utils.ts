import { runCommandStrict } from "./cli-process-runner.js";
import type { Logger } from "../shared/logging/logger.js";

export async function pruneOrphanedDockerVolumes(args: {
  prefix: string;
  liveIds: Set<string>;
  logger?: Logger;
  logLabel: string;
}): Promise<number> {
  const result = await runCommandStrict(
    "docker",
    ["volume", "ls", "-q"],
    process.cwd(),
  ).catch(() => null);

  if (!result?.ok) {
    return 0;
  }

  const { prefix, liveIds, logger, logLabel } = args;

  const orphans = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((name) => name.startsWith(prefix) && !liveIds.has(name.slice(prefix.length)));

  if (orphans.length > 0) {
    await runCommandStrict("docker", ["volume", "rm", "-f", ...orphans], process.cwd()).catch(() => undefined);
  }

  if (orphans.length > 0) {
    logger?.info(logLabel, { prunedCount: orphans.length });
  }

  return orphans.length;
}

export async function removeContainersByIds(containerIds: string[]): Promise<void> {
  if (containerIds.length > 0) {
    await runCommandStrict("docker", ["rm", "-f", "-v", ...containerIds], process.cwd()).catch(() => undefined);
  }
}
