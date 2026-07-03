import { execFile } from "node:child_process";
import type { ActiveDispatchRegistry } from "./active-dispatch-registry.js";
import { SERVER_SHUTDOWN_STOP_REASON } from "./active-dispatch-registry.js";
import type { Logger } from "../shared/logging/logger.js";

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

export class ShutdownContainerService {
  constructor(private readonly deps: ShutdownContainerServiceDeps) {}

  async stopRunningContainers(reason = SERVER_SHUTDOWN_STOP_REASON): Promise<ShutdownContainerStopResult> {
    const requestedDispatchStops = await this.requestActiveDispatchStops(reason);
    const containers = await this.listRunningCodeUxContainers();
    const killedContainerIds: string[] = [];

    for (const container of containers) {
      await this.runCommand("docker", ["kill", container.id])
        .then(() => {
          killedContainerIds.push(container.id);
        })
        .catch((error: unknown) => {
          this.deps.logger?.warn("Failed to kill Code UX container during shutdown", {
            containerId: container.id,
            containerName: container.names,
            error: error instanceof Error ? error.message : String(error),
          });
        });
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

  private async requestActiveDispatchStops(reason: string): Promise<number> {
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

  private async listRunningCodeUxContainers(): Promise<ShutdownContainerSummary[]> {
    const result = await this.runCommand("docker", ["ps", "--format", "{{json .}}"])
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
        return Object.keys(container.labels).some((key) => key.startsWith("code-ux."));
      });
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
