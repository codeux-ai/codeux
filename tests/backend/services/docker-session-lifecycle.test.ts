import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerSessionLifecycle, sanitizeContainerNameComponent } from "../../../src/services/docker-session-lifecycle.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
  commandRunner: vi.fn(),
}));

describe("docker-session-lifecycle", () => {
  let lifecycle: DockerSessionLifecycle;

  beforeEach(() => {
    lifecycle = new DockerSessionLifecycle();
    vi.clearAllMocks();
  });

  describe("sanitizeContainerNameComponent", () => {
    it("lowercases and removes invalid characters", () => {
      expect(sanitizeContainerNameComponent("My_PrOjEcT_123!@#", 24)).toBe("my_project_123-");
    });

    it("truncates to maxLength", () => {
      expect(sanitizeContainerNameComponent("abcdefghijklmnopqrstuvwxyz", 10)).toBe("abcdefghij");
    });
  });

  describe("withSessionLock", () => {
    it("serializes operations on the same key", async () => {
      const log: number[] = [];
      const op1 = lifecycle.withSessionLock("key1", async () => {
        log.push(1);
        await new Promise((resolve) => setTimeout(resolve, 50));
        log.push(2);
      });
      const op2 = lifecycle.withSessionLock("key1", async () => {
        log.push(3);
      });

      await Promise.all([op1, op2]);
      expect(log).toEqual([1, 2, 3]);
    });

    it("allows concurrent operations on different keys", async () => {
      let op1Started = false;
      const op1 = lifecycle.withSessionLock("key1", async () => {
        op1Started = true;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      const op2 = lifecycle.withSessionLock("key2", async () => {
        expect(op1Started).toBe(true);
      });

      await Promise.all([op1, op2]);
    });
  });

  describe("removeContainerIfPresent", () => {
    it("ignores empty container references", async () => {
      await lifecycle.removeContainerIfPresent("   ", "/tmp");
      expect(runCommandStrict).not.toHaveBeenCalled();
    });

    it("calls docker rm -f with the container ref", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({ exitCode: 0, stdout: "", stderr: "", durationMs: 1 });
      await lifecycle.removeContainerIfPresent("my-container", "/tmp");
      expect(runCommandStrict).toHaveBeenCalledWith("docker", ["rm", "-f", "my-container"], "/tmp");
    });

    it("swallows errors if docker rm fails", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("Container not found"));
      await expect(lifecycle.removeContainerIfPresent("my-container", "/tmp")).resolves.toBeUndefined();
    });
  });

  describe("parseDockerPsOutput", () => {
    it("parses valid rows with host port", () => {
      const stdout = "id1\tname1\tUp 5 minutes\tpj1\tsp1\tss1\t8080\nid2\t\tExited (0)\tpj2\tsp2\tss2\t";
      const result = lifecycle.parseDockerPsOutput(stdout, true);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: "id1", name: "name1", status: "running", hostPort: 8080,
        labels: { "code-ux.project-id": "pj1", "code-ux.sprint-id": "sp1", "code-ux.session-id": "ss1" }
      });
      expect(result[1]).toEqual({
        id: "id2", name: null, status: "exited", hostPort: null,
        labels: { "code-ux.project-id": "pj2", "code-ux.sprint-id": "sp2", "code-ux.session-id": "ss2" }
      });
    });

    it("parses valid rows without host port", () => {
      const stdout = "id1\tname1\tUp 5 minutes\tpj1\tsp1\tss1";
      const result = lifecycle.parseDockerPsOutput(stdout, false);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: "id1", name: "name1", status: "running",
        labels: { "code-ux.project-id": "pj1", "code-ux.sprint-id": "sp1", "code-ux.session-id": "ss1" }
      });
      expect(result[0]).not.toHaveProperty("hostPort");
    });

    it("handles empty output gracefully", () => {
      expect(lifecycle.parseDockerPsOutput("")).toEqual([]);
    });

    it("tolerates malformed rows", () => {
      const stdout = "id1\tname1";
      const result = lifecycle.parseDockerPsOutput(stdout, true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("id1");
      expect(result[0].name).toBe("name1");
      expect(result[0].status).toBe(null);
      expect(result[0].hostPort).toBe(null);
      expect(result[0].labels).toEqual({ "code-ux.project-id": "", "code-ux.sprint-id": "", "code-ux.session-id": "" });
    });
  });

  describe("normalizeDockerState", () => {
    it("normalizes 'Up x minutes' to 'running'", () => {
      expect(lifecycle.normalizeDockerState("Up 5 minutes")).toBe("running");
    });
    it("normalizes 'Exited (0)' to 'exited'", () => {
      expect(lifecycle.normalizeDockerState("Exited (0) about a minute ago")).toBe("exited");
    });
    it("normalizes 'Created' to 'created'", () => {
      expect(lifecycle.normalizeDockerState("Created")).toBe("created");
    });
    it("normalizes 'Restarting (1)' to 'restarting'", () => {
      expect(lifecycle.normalizeDockerState("Restarting (1) 2 seconds ago")).toBe("restarting");
    });
    it("returns null for empty or nullish strings", () => {
      expect(lifecycle.normalizeDockerState("  ")).toBe(null);
      expect(lifecycle.normalizeDockerState(null)).toBe(null);
      expect(lifecycle.normalizeDockerState(undefined)).toBe(null);
    });
    it("returns lowercased raw string if no known prefix matches", () => {
      expect(lifecycle.normalizeDockerState("Dead")).toBe("dead");
    });
  });
});
