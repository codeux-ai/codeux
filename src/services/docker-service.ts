import { runCommandStrict } from "./cli-process-runner.js";
import type { DockerContainer } from "../contracts/app-types.js";

export type DockerContainerWithMeta = DockerContainer & { createdAt?: string };

export class DockerService {
  async isAvailable(): Promise<boolean> {
    try {
      await runCommandStrict("docker", ["ps", "-q"], process.cwd(), process.env, { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  async listContainers(): Promise<DockerContainerWithMeta[]> {
    try {
      const result = await runCommandStrict("docker", ["ps", "--format", "{{json .}}"], process.cwd(), process.env, { timeout: 10000 });

      if (!result.stdout.trim()) {
        return [];
      }

      const lines = result.stdout.trim().split("\n");
      const containers: DockerContainerWithMeta[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const parsed = JSON.parse(line.trim());

          let labels: Record<string, string> = {};
          if (parsed.Labels) {
            const labelPairs = parsed.Labels.split(",");
            for (const pair of labelPairs) {
              const eqIndex = pair.indexOf("=");
              if (eqIndex !== -1) {
                const key = pair.substring(0, eqIndex);
                const value = pair.substring(eqIndex + 1);
                labels[key] = value;
              } else if (pair) {
                labels[pair] = "";
              }
            }
          }

          containers.push({
            id: parsed.ID || "",
            names: parsed.Names || "",
            image: parsed.Image || "",
            status: parsed.Status || "",
            state: parsed.State || "",
            runningFor: parsed.RunningFor || "",
            createdAt: parsed.CreatedAt || "",
            labels,
          });
        } catch (e) {
          // Ignore parse errors for individual lines to be robust
        }
      }

      return containers.filter((container) =>
        Object.keys(container.labels || {}).some((key) => key.startsWith("code-ux."))
      );
    } catch (error) {
      // Return empty array if Docker is unavailable or command fails
      return [];
    }
  }

  async stopContainer(id: string, timeoutSec: number = 30): Promise<void> {
    try {
      await runCommandStrict(
        "docker",
        ["stop", "-t", timeoutSec.toString(), id],
        process.cwd(),
        process.env,
        { timeout: (timeoutSec + 5) * 1000 }
      );
    } catch (error) {
      try {
        await runCommandStrict("docker", ["kill", id], process.cwd(), process.env, { timeout: 10000 });
      } catch {
        // Ignore kill errors if it's already gone or inaccessible
      }
    }
  }

  async removeContainer(id: string): Promise<void> {
    try {
      await runCommandStrict("docker", ["rm", "-f", id], process.cwd(), process.env, { timeout: 15000 });
    } catch {
      // Ignore remove errors
    }
  }

  async getContainerStats(id: string): Promise<Record<string, unknown> | null> {
    try {
      const result = await runCommandStrict(
        "docker",
        ["stats", "--no-stream", "--format", "{{json .}}", id],
        process.cwd(),
        process.env,
        { timeout: 15000 }
      );
      if (result.stdout.trim()) {
        return JSON.parse(result.stdout.trim()) as Record<string, unknown>;
      }
    } catch {
      // Ignore stats errors
    }
    return null;
  }

  async getContainerEvents(id: string, since: string): Promise<Record<string, unknown>[]> {
    try {
      const result = await runCommandStrict(
        "docker",
        ["events", "--filter", `container=${id}`, "--since", since, "--until", "0s", "--format", "{{json .}}"],
        process.cwd(),
        process.env,
        { timeout: 10000 }
      );

      const lines = result.stdout.trim().split("\n");
      const events: Record<string, unknown>[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line.trim()) as Record<string, unknown>);
        } catch {
          // ignore parse errors
        }
      }
      return events;
    } catch {
      return [];
    }
  }
}
