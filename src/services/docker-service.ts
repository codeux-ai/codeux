import { runCommandStrict } from "./cli-process-runner.js";
import type { DockerContainer } from "../contracts/app-types.js";

export class DockerService {
  async isAvailable(): Promise<boolean> {
    try {
      await runCommandStrict("docker", ["ps", "-q"], process.cwd());
      return true;
    } catch {
      return false;
    }
  }

  async listContainers(): Promise<DockerContainer[]> {
    try {
      const result = await runCommandStrict("docker", ["ps", "--format", "{{json .}}"], process.cwd());

      if (!result.stdout.trim()) {
        return [];
      }

      const lines = result.stdout.trim().split("\n");
      const containers: DockerContainer[] = [];

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
            labels,
          });
        } catch (e) {
          // Ignore parse errors for individual lines to be robust
        }
      }

      return containers;
    } catch (error) {
      // Return empty array if Docker is unavailable or command fails
      return [];
    }
  }
}
