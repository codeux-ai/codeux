import { execFile } from "node:child_process";
import type { ActiveDispatchRegistry } from "./active-dispatch-registry.js";
import { SERVER_SHUTDOWN_STOP_REASON } from "./active-dispatch-registry.js";
import type { Logger } from "../shared/logging/logger.js";
import { getRuntimeOwnerId, RUNTIME_OWNER_LABEL } from "../shared/config/runtime-owner.js";
import { AsyncSemaphore } from "../shared/async-semaphore.js";

export type ShutdownCommandRunner = (command: string, args: string[], cwd: string) => Promise<{ stdout: string }>;

interface ShutdownContainerServiceDeps {
  activeDispatchRegistry: ActiveDispatchRegistry;
  logger?: Logger;
  commandRunner?: ShutdownCommandRunner;
}

interface ShutdownContainerSummary {
  id: string;
  names: string;
  labels: Record<string, string>;
}

export interface ShutdownContainerStopResult {
  requestedDispatchStops: number;
  killedContainerIds: string[];
}

const DOCKER_SHUTDOWN_COMMAND_TIMEOUT_MS = 5_000;
const DOCKER_SHUTDOWN_REMOVE_BATCH_SIZE = 8;
const DOCKER_SHUTDOWN_REMOVE_CONCURRENCY = 4;

export class ShutdownContainerService {
  private readonly removalSemaphore = new AsyncSemaphore(DOCKER_SHUTDOWN_REMOVE_CONCURRENCY);

  constructor(private readonly deps: ShutdownContainerServiceDeps) {}

  async stopRunningContainers(reason = SERVER_SHUTDOWN_STOP_REASON): Promise<ShutdownContainerStopResult> {
    const requestedDispatchStops = await this.requestActiveDispatchStops(reason);
    return await this.stopRemainingContainers(requestedDispatchStops);
  }

  /**
   * Signals active workflows before shutdown starts draining helper pools. Keeping this operation
   * separate lets the server overlap workflow cancellation with helper quiescence instead of
   * waiting for commands that have not yet been told to stop.
   */
  async requestActiveDispatchStops(reason = SERVER_SHUTDOWN_STOP_REASON): Promise<number> {
    const handles = this.deps.activeDispatchRegistry.listHandles();
    await Promise.all(handles.map(async (handle) => {
      const result = await Promise.resolve(handle.requestStop(reason)).catch((error: unknown) => {
        this.deps.logger?.warn("Failed to request active dispatch stop during shutdown", {
          dispatchId: handle.dispatchId,
          sessionId: handle.sessionId ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (result && !result.accepted) {
        this.deps.logger?.warn("Active dispatch stop was not accepted during shutdown", {
          dispatchId: handle.dispatchId,
          sessionId: handle.sessionId ?? null,
          message: result.message,
        });
      }
    }));
    return handles.length;
  }

  /** Removes owner-scoped containers after active dispatch cancellation has already been sent. */
  async stopRemainingContainers(requestedDispatchStops: number): Promise<ShutdownContainerStopResult> {
    const containers = await this.listCodeUxContainers();
    const killedContainerIds: string[] = [];

    if (containers.length > 0) {
      // `docker run --rm` cannot remove a container interrupted between daemon
      // creation and process start. Force-remove every owner-scoped container so
      // running, exited, dead, and never-started generations share one cleanup path.
      // Small bounded-parallel batches keep restart latency low without letting a full 16-task
      // wave turn one oversized Docker request into a five-second timeout. A failed batch falls
      // back to isolated removals so one daemon race cannot hide the other container outcomes.
      const batches = this.toContainerBatches(containers);
      const removed = await Promise.all(batches.map((batch) => this.removeContainerBatch(batch)));
      killedContainerIds.push(...removed.flat());
    }

    if (requestedDispatchStops > 0 || killedContainerIds.length > 0) {
      this.deps.logger?.info("Stopped Code UX containers during shutdown", {
        requestedDispatchStops,
        killedContainerIds,
      });
    }

    return {
      requestedDispatchStops,
      killedContainerIds,
    };
  }

  private async listCodeUxContainers(): Promise<ShutdownContainerSummary[]> {
    const result = await this.runCommand("docker", ["ps", "-a", "--format", "{{json .}}"])
      .catch((error: unknown) => {
        this.deps.logger?.warn("Failed to inspect Docker containers during shutdown", {
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
    if (!result?.stdout.trim()) {
      return [];
    }

    return result.stdout
      .split(/\r?\n/)
      .map((line) => this.parseDockerPsJsonLine(line))
      .filter((container): container is ShutdownContainerSummary => {
        if (!container) {
          return false;
        }
        return this.isCodeUxContainer(container);
      });
  }

  private isCodeUxContainer(container: ShutdownContainerSummary): boolean {
    // Multiple isolated Code UX runtimes can share one Docker daemon (for example a live app and
    // a local stress test). Never let one runtime's shutdown kill another runtime's containers.
    if (container.labels[RUNTIME_OWNER_LABEL] !== getRuntimeOwnerId()) {
      return false;
    }
    if (Object.keys(container.labels).some((key) => key.startsWith("code-ux."))) {
      return true;
    }
    return container.names.split(",").some((name) => name.trim().startsWith("code-ux-"));
  }

  private parseDockerPsJsonLine(line: string): ShutdownContainerSummary | null {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed) as { ID?: unknown; Names?: unknown; Labels?: unknown };
      const id = typeof parsed.ID === "string" ? parsed.ID.trim() : "";
      if (!id) {
        return null;
      }
      return {
        id,
        names: typeof parsed.Names === "string" ? parsed.Names : "",
        labels: this.parseLabelString(typeof parsed.Labels === "string" ? parsed.Labels : ""),
      };
    } catch {
      return null;
    }
  }

  private parseLabelString(rawLabels: string): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const pair of rawLabels.split(",")) {
      const trimmed = pair.trim();
      if (!trimmed) {
        continue;
      }
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) {
        labels[trimmed] = "";
      } else {
        labels[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1);
      }
    }
    return labels;
  }

  private isIdempotentContainerRemovalError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return /no such container|is not running|removal of container .* is already in progress/i.test(message);
  }

  private toContainerBatches(containers: ShutdownContainerSummary[]): ShutdownContainerSummary[][] {
    const batches: ShutdownContainerSummary[][] = [];
    for (let index = 0; index < containers.length; index += DOCKER_SHUTDOWN_REMOVE_BATCH_SIZE) {
      batches.push(containers.slice(index, index + DOCKER_SHUTDOWN_REMOVE_BATCH_SIZE));
    }
    return batches;
  }

  private async removeContainerBatch(batch: ShutdownContainerSummary[]): Promise<string[]> {
    const ids = batch.map((container) => container.id);
    try {
      await this.runRemovalCommand(ids);
      return ids;
    } catch (error) {
      if (this.isIdempotentContainerRemovalError(error)) {
        return ids;
      }
    }

    const results = await Promise.all(batch.map(async (container) => {
      try {
        await this.runRemovalCommand([container.id]);
        return container.id;
      } catch (error) {
        if (this.isIdempotentContainerRemovalError(error)) {
          return container.id;
        }
        this.deps.logger?.warn("Failed to kill Code UX container during shutdown", {
          containerIds: [container.id],
          containerNames: [container.names],
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    }));
    return results.filter((id): id is string => id !== null);
  }

  private async runRemovalCommand(containerIds: string[]): Promise<void> {
    await this.removalSemaphore.run(async () => {
      await this.runCommand("docker", ["rm", "-f", "-v", ...containerIds]);
    });
  }

  private async runCommand(command: string, args: string[]): Promise<{ stdout: string }> {
    if (this.deps.commandRunner) {
      return this.deps.commandRunner(command, args, process.cwd());
    }
    return await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile(command, args, {
        cwd: process.cwd(),
        timeout: DOCKER_SHUTDOWN_COMMAND_TIMEOUT_MS,
        windowsHide: true,
      }, (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: String(stdout || "") });
      });
    });
  }
}
