import { runCommandStrict } from "./cli-process-runner.js";
import type { DockerContainer } from "../contracts/app-types.js";

export interface DockerContainerInventory {
  available: boolean;
  containers: DockerContainer[];
  fetchedAtMs: number;
}

interface DockerInventoryCacheState {
  snapshot: DockerContainerInventory | null;
  inFlight: Promise<DockerContainerInventory> | null;
  generation: number;
}

const DEFAULT_INVENTORY_TTL_MS = 2_000;
const FAILED_INVENTORY_TTL_MS = 2_000;

// DockerService is composed in a few independent application factories. Keep the
// inventory process-wide so those service instances do not each issue their own
// `docker ps` during the same orchestration burst.
const sharedInventoryCache: DockerInventoryCacheState = {
  snapshot: null,
  inFlight: null,
  generation: 0,
};

export class DockerService {
  async isAvailable(maxAgeMs = DEFAULT_INVENTORY_TTL_MS): Promise<boolean> {
    const inventory = await this.getContainerInventory(maxAgeMs);
    return inventory.available;
  }

  async listContainers(maxAgeMs = DEFAULT_INVENTORY_TTL_MS): Promise<DockerContainer[]> {
    const inventory = await this.getContainerInventory(maxAgeMs);
    return inventory.containers;
  }

  /**
   * Returns one coherent Docker availability/container snapshot. Availability and
   * discovery deliberately share the same command, cache, and in-flight promise;
   * callers must not need a preliminary `docker ps -q` probe.
   */
  async getContainerInventory(maxAgeMs = DEFAULT_INVENTORY_TTL_MS): Promise<DockerContainerInventory> {
    const now = Date.now();
    const snapshot = sharedInventoryCache.snapshot;
    const boundedMaxAgeMs = Math.max(0, maxAgeMs);
    const effectiveMaxAgeMs = snapshot?.available === false
      ? Math.min(boundedMaxAgeMs, FAILED_INVENTORY_TTL_MS)
      : boundedMaxAgeMs;
    if (snapshot && now - snapshot.fetchedAtMs < effectiveMaxAgeMs) {
      return snapshot;
    }
    if (sharedInventoryCache.inFlight) {
      return sharedInventoryCache.inFlight;
    }

    const generation = sharedInventoryCache.generation;
    const inFlight = this.fetchContainers().then(
      (containers): DockerContainerInventory => {
        const inventory = {
          available: true,
          containers,
          fetchedAtMs: Date.now(),
        } satisfies DockerContainerInventory;
        if (sharedInventoryCache.generation === generation) {
          sharedInventoryCache.snapshot = inventory;
        }
        return inventory;
      },
      (): DockerContainerInventory => {
        const inventory = {
          available: false,
          containers: [],
          fetchedAtMs: Date.now(),
        } satisfies DockerContainerInventory;
        if (sharedInventoryCache.generation === generation) {
          sharedInventoryCache.snapshot = inventory;
        }
        return inventory;
      },
    );
    sharedInventoryCache.inFlight = inFlight;
    void inFlight.finally(() => {
      if (sharedInventoryCache.inFlight === inFlight) {
        sharedInventoryCache.inFlight = null;
      }
    });
    return inFlight;
  }

  async removeContainers(containerIds: string[], options: { removeVolumes?: boolean } = {}): Promise<void> {
    const refs = containerIds.map((id) => id.trim()).filter(Boolean);
    if (refs.length === 0) {
      return;
    }
    this.invalidateContainerInventory();
    const args = options.removeVolumes === true
      ? ["rm", "-f", "-v", ...refs]
      : ["rm", "-f", ...refs];
    await runCommandStrict("docker", args, process.cwd()).catch(() => undefined);
  }

  invalidateContainerInventory(): void {
    sharedInventoryCache.generation += 1;
    sharedInventoryCache.snapshot = null;
    sharedInventoryCache.inFlight = null;
  }

  private async fetchContainers(): Promise<DockerContainer[]> {
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

        const labels: Record<string, string> = {};
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
      } catch {
        // Ignore parse errors for individual lines to be robust.
      }
    }

    return containers.filter((container) =>
      Object.keys(container.labels || {}).some((key) => key.startsWith("code-ux."))
    );
  }
}
