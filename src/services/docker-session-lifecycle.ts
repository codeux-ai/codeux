import { runCommandStrict } from "./cli-process-runner.js";

export interface DockerContainerSummary {
  id: string;
  name: string | null;
  status: string | null;
  hostPort?: number | null;
  labels: Record<string, string>;
}

export function sanitizeContainerNameComponent(value: string, maxLength: number): string {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").slice(0, maxLength);
}

export class DockerSessionLifecycle {
  private readonly sessionLocks = new Map<string, Promise<unknown>>();

  public async withSessionLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionLocks.get(lockKey) || Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.finally(() => gate);
    this.sessionLocks.set(lockKey, queued);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release?.();
      if (this.sessionLocks.get(lockKey) === queued) {
        this.sessionLocks.delete(lockKey);
      }
    }
  }

  public async removeContainerIfPresent(containerRef: string, cwd: string): Promise<void> {
    if (!containerRef.trim()) {
      return;
    }
    await runCommandStrict("docker", ["rm", "-f", containerRef], cwd).catch(() => undefined);
  }

  public parseDockerPsOutput(stdout: string, hasHostPort: boolean = true): DockerContainerSummary[] {
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        const id = parts[0];
        const name = parts[1];
        const rawStatus = parts[2];
        const projectId = parts[3];
        const sprintId = parts[4];
        const sessionId = parts[5];
        let parsedPort: number | null = null;

        if (hasHostPort && parts.length > 6) {
          const hostPortStr = parts[6];
          const num = hostPortStr ? parseInt(hostPortStr, 10) : NaN;
          if (!isNaN(num)) {
            parsedPort = num;
          }
        }

        return {
          id,
          name: name || null,
          status: this.normalizeDockerState(rawStatus),
          ...(hasHostPort ? { hostPort: parsedPort } : {}),
          labels: {
            "code-ux.project-id": projectId || "",
            "code-ux.sprint-id": sprintId || "",
            "code-ux.session-id": sessionId || "",
          },
        } satisfies DockerContainerSummary;
      });
  }

  public normalizeDockerState(rawStatus: string | null | undefined): string | null {
    const normalized = String(rawStatus || "").trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized.startsWith("up ")) {
      return "running";
    }
    if (normalized.startsWith("exited ")) {
      return "exited";
    }
    if (normalized.startsWith("created")) {
      return "created";
    }
    if (normalized.startsWith("restarting")) {
      return "restarting";
    }
    return normalized;
  }
}