import { describe, it, expect, vi, beforeEach } from "vitest";
import { DockerService } from "../../../src/services/docker-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

describe("DockerService", () => {
  let dockerService: DockerService;

  beforeEach(() => {
    vi.clearAllMocks();
    dockerService = new DockerService();
  });

  describe("listContainers", () => {
    it("should report docker availability when docker ps succeeds", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      } as any);

      await expect(dockerService.isAvailable()).resolves.toBe(true);
      expect(runCommandStrict).toHaveBeenCalledWith("docker", ["ps", "-q"], process.cwd(), process.env, expect.any(Object));
    });

    it("should report docker as unavailable when docker ps fails", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("Cannot connect to the Docker daemon"));

      await expect(dockerService.isAvailable()).resolves.toBe(false);
    });

    it("should return an empty array if docker daemon is unavailable", async () => {
      vi.mocked(runCommandStrict).mockRejectedValue(new Error("Cannot connect to the Docker daemon"));

      const containers = await dockerService.listContainers();

      expect(containers).toEqual([]);
      expect(runCommandStrict).toHaveBeenCalledWith("docker", ["ps", "--format", "{{json .}}"], process.cwd(), process.env, expect.any(Object));
    });

    it("should return an empty array if there are no running containers", async () => {
      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toEqual([]);
    });

    it("should parse multiple containers and their labels correctly", async () => {
      const dockerOutputLine1 = JSON.stringify({
        ID: "e2c4587a829f",
        Image: "nginx:latest",
        Command: "\"nginx -g 'daemon of…\"",
        CreatedAt: "2023-10-27 10:00:00 +0000 UTC",
        RunningFor: "2 hours ago",
        Ports: "0.0.0.0:80->80/tcp",
        Status: "Up 2 hours",
        Size: "0B",
        Names: "web-server",
        Labels: "env=production,code-ux.session-id=123,mylabel",
        Mounts: "",
        Networks: "bridge",
        State: "running",
      });

      const dockerOutputLine2 = JSON.stringify({
        ID: "a1b2c3d4e5f6",
        Image: "redis:alpine",
        Command: "\"docker-entrypoint.s…\"",
        CreatedAt: "2023-10-27 11:00:00 +0000 UTC",
        RunningFor: "1 hour ago",
        Ports: "6379/tcp",
        Status: "Up 1 hour",
        Size: "0B",
        Names: "cache-db",
        Labels: "project=dashboard,code-ux.command=test",
        Mounts: "",
        Networks: "bridge",
        State: "running",
      });

      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: `${dockerOutputLine1}\n${dockerOutputLine2}\n`,
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toHaveLength(2);

      expect(containers[0]).toEqual({
        id: "e2c4587a829f",
        names: "web-server",
        image: "nginx:latest",
        status: "Up 2 hours",
        state: "running",
        runningFor: "2 hours ago",
        createdAt: "2023-10-27 10:00:00 +0000 UTC",
        labels: {
          env: "production",
          "code-ux.session-id": "123",
          mylabel: "",
        },
      });

      expect(containers[1]).toEqual({
        id: "a1b2c3d4e5f6",
        names: "cache-db",
        image: "redis:alpine",
        status: "Up 1 hour",
        state: "running",
        runningFor: "1 hour ago",
        createdAt: "2023-10-27 11:00:00 +0000 UTC",
        labels: {
          project: "dashboard",
          "code-ux.command": "test",
        },
      });
    });

    it("should handle partially malformed JSON output gracefully", async () => {
      const dockerOutputLine1 = JSON.stringify({
        ID: "e2c4587a829f",
        Names: "valid-container",
        State: "running",
        Labels: "code-ux.workspace=true",
      });
      const malformedLine = "This is not json";

      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: `\n${dockerOutputLine1}\n${malformedLine}\n\n`, // Adding blank lines to test branch coverage
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toHaveLength(1);
      expect(containers[0].id).toBe("e2c4587a829f");
      expect(containers[0].names).toBe("valid-container");
    });

    it("should map empty strings for missing optional properties", async () => {
      const incompleteContainer = JSON.stringify({
        ID: "some-id",
        Labels: "justakey,code-ux.test,", // Tests labels[pair] = "" and trailing commas
      });

      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: `${incompleteContainer}\n`,
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toHaveLength(1);
      expect(containers[0]).toEqual({
        id: "some-id",
        names: "",
        image: "",
        status: "",
        state: "",
        runningFor: "",
        createdAt: "",
        labels: {
          justakey: "",
          "code-ux.test": "",
        },
      });
    });

    it("should handle error parsing individual JSON lines", async () => {
      const dockerOutputLine1 = JSON.stringify({
        ID: "e2c4587a829f",
        Names: "valid-container",
        Labels: "code-ux.xyz=1",
      });
      // The catch block intercepts the parsing error
      const malformedLine = "{ invalid json }";

      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: `${dockerOutputLine1}\n${malformedLine}\n`,
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toHaveLength(1);
      expect(containers[0].id).toBe("e2c4587a829f");
      expect(containers[0].names).toBe("valid-container");
    });

    it("should filter out containers that do not have a code-ux label", async () => {
      const codeUxContainer = JSON.stringify({
        ID: "container1",
        Names: "code-ux-runner",
        Labels: "env=prod,code-ux.session-id=456",
      });

      const unrelatedContainer = JSON.stringify({
        ID: "container2",
        Names: "system-db",
        Labels: "env=prod,project=system",
      });

      const noLabelsContainer = JSON.stringify({
        ID: "container3",
        Names: "no-labels-container",
      });

      vi.mocked(runCommandStrict).mockResolvedValue({
        exitCode: 0,
        stdout: `${codeUxContainer}\n${unrelatedContainer}\n${noLabelsContainer}\n`,
        stderr: "",
        durationMs: 10,
      });

      const containers = await dockerService.listContainers();

      expect(containers).toHaveLength(1);
      expect(containers[0].id).toBe("container1");
      expect(containers[0].names).toBe("code-ux-runner");
    });
  });
});
