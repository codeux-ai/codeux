import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exec } from "child_process";
import { fixDockerHostEnvironment } from "../../../src/shared/docker-env-helper.js";

vi.mock("child_process", () => {
  return {
    exec: vi.fn(),
  };
});

describe("docker-env-helper", () => {
  let originalPlatform: string;
  let originalDockerHost: string | undefined;

  beforeEach(() => {
    originalPlatform = process.platform;
    originalDockerHost = process.env.DOCKER_HOST;
    delete process.env.DOCKER_HOST;
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    if (originalDockerHost !== undefined) {
      process.env.DOCKER_HOST = originalDockerHost;
    } else {
      delete process.env.DOCKER_HOST;
    }
  });

  it("should do nothing if platform is Linux", async () => {
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });

    await fixDockerHostEnvironment();

    expect(exec).not.toHaveBeenCalled();
    expect(process.env.DOCKER_HOST).toBeUndefined();
  });

  it("should do nothing if platform is macOS (darwin)", async () => {
    Object.defineProperty(process, "platform", {
      value: "darwin",
      configurable: true,
    });

    await fixDockerHostEnvironment();

    expect(exec).not.toHaveBeenCalled();
    expect(process.env.DOCKER_HOST).toBeUndefined();
  });

  it("should do nothing if DOCKER_HOST is already set on win32", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.DOCKER_HOST = "tcp://1.2.3.4:2375";

    await fixDockerHostEnvironment();

    expect(exec).not.toHaveBeenCalled();
    expect(process.env.DOCKER_HOST).toBe("tcp://1.2.3.4:2375");
  });

  it("should do nothing if active context (docker ps) succeeds on win32", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    // Mock exec to succeed on the first call (docker ps)
    vi.mocked(exec).mockImplementation(((cmd: string, cb: any) => {
      cb(null, { stdout: "container123\n" });
      return {} as any;
    }) as any);

    await fixDockerHostEnvironment();

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("docker ps -q", expect.any(Function));
    expect(process.env.DOCKER_HOST).toBeUndefined();
  });

  it("should fallback to default pipe if active context fails but default pipe succeeds on win32", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    // Mock exec: first call fails (active context), second call succeeds (fallback)
    vi.mocked(exec).mockImplementation(((cmd: string, cb: any) => {
      if (cmd === "docker ps -q") {
        cb(new Error("unreachable pipe"), null);
      } else if (cmd === "docker -H npipe:////./pipe/docker_engine ps -q") {
        cb(null, { stdout: "" });
      }
      return {} as any;
    }) as any);

    await fixDockerHostEnvironment();

    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec).toHaveBeenNthCalledWith(1, "docker ps -q", expect.any(Function));
    expect(exec).toHaveBeenNthCalledWith(2, "docker -H npipe:////./pipe/docker_engine ps -q", expect.any(Function));
    expect(process.env.DOCKER_HOST).toBe("npipe:////./pipe/docker_engine");
  });

  it("should do nothing if both active context and default pipe fail on win32", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    // Mock exec: both calls fail
    vi.mocked(exec).mockImplementation(((cmd: string, cb: any) => {
      cb(new Error("unreachable"), null);
      return {} as any;
    }) as any);

    await fixDockerHostEnvironment();

    expect(exec).toHaveBeenCalledTimes(2);
    expect(process.env.DOCKER_HOST).toBeUndefined();
  });
});
