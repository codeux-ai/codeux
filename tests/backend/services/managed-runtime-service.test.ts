import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ManagedRuntimeService } from "../../../src/services/managed-runtime-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const ok = (stdout = "") => ({ ok: true, stdout, stderr: "", code: 0, signal: null }) as any;
const fail = (stderr: string) => ({ ok: false, stdout: "", stderr, code: 1, signal: null }) as any;

describe("ManagedRuntimeService", () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  it("pulls both stable channel images, resolves immutable digests, and reuses them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-managed-runtime-"));
    tempPaths.push(root);
    const stream = vi.fn(async () => ok("pulled"));
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "image" && args.includes("--format") && args.some((arg) => arg.includes("RepoDigests"))) {
        const role = args.at(-1)?.endsWith("-browser") ? "browser" : "base";
        return ok(`example/runtime@sha256:${role.padEnd(64, "0")}\n`);
      }
      if (args[0] === "image" && args.includes("--format")) {
        const role = args.at(-1)?.includes("browser") ? "browser" : "base";
        return ok(`1 ${role}\n`);
      }
      if (args[0] === "run") return ok("v24.4.1\n");
      if (args[0] === "image" && args[1] === "inspect") return ok("[]");
      return ok();
    });
    const service = new ManagedRuntimeService({ run, stream }, {
      statePath: path.join(root, "state.json"),
      repository: "example/runtime",
      channel: "1",
    });

    await service.checkForUpdates();

    expect(service.getStatus()).toMatchObject({ state: "ready", progressPercent: 100 });
    expect(service.getStatus().baseImage).toContain("@sha256:base");
    expect(service.getStatus().browserImage).toContain("@sha256:browser");
    const image = await service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "browser");
    const secondImage = await service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "browser");
    expect(image).toContain("@sha256:browser");
    expect(secondImage).toBe(image);
    expect(stream).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.filter(([, args]) => args[0] === "image" && args[1] === "inspect" && !args.includes("--format")))
      .toHaveLength(0);
  });

  it("reports an update failure while retaining persisted verified digests", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-managed-runtime-offline-"));
    tempPaths.push(root);
    const statePath = path.join(root, "state.json");
    await fs.writeFile(statePath, JSON.stringify({
      active: {
        base: "example/runtime@sha256:cached-base",
        browser: "example/runtime@sha256:cached-browser",
      },
      previous: {},
      checkedAt: null,
    }));
    const service = new ManagedRuntimeService({
      stream: vi.fn(async () => fail("offline")),
      run: vi.fn(async () => ok("[]")),
    }, { statePath, repository: "example/runtime" });

    await service.checkForUpdates();

    expect(service.getStatus()).toMatchObject({
      state: "update_failed",
      baseImage: "example/runtime@sha256:cached-base",
      browserImage: "example/runtime@sha256:cached-browser",
    });
  });

  it("skips automatic registry pulls while the persisted cache check is fresh", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-managed-runtime-fresh-"));
    tempPaths.push(root);
    const statePath = path.join(root, "state.json");
    const checkedAt = new Date().toISOString();
    await fs.writeFile(statePath, JSON.stringify({
      active: {
        base: "example/runtime@sha256:cached-base",
        browser: "example/runtime@sha256:cached-browser",
      },
      previous: {},
      checkedAt,
    }));
    const stream = vi.fn(async () => ok("pulled"));
    const service = new ManagedRuntimeService({
      stream,
      run: vi.fn(async () => ok("[]")),
    }, { statePath, repository: "example/runtime" });

    await service.checkForUpdates(undefined, { minimumIntervalMs: 6 * 60 * 60 * 1_000 });

    expect(stream).not.toHaveBeenCalled();
    expect(service.getStatus()).toMatchObject({
      state: "ready",
      checkedAt,
      baseImage: "example/runtime@sha256:cached-base",
      browserImage: "example/runtime@sha256:cached-browser",
    });
  });

  it("preserves explicit custom images without pulling", async () => {
    const stream = vi.fn(async () => ok());
    const service = new ManagedRuntimeService({ run: vi.fn(async () => ok()), stream });
    const image = await service.resolveImage({
      ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
      containerImageMode: "custom",
      containerImage: "registry.example/custom:42",
    }, "base");
    expect(image).toBe("registry.example/custom:42");
    expect(stream).not.toHaveBeenCalled();
  });

  it("checks a persisted image once per process before trusting it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-managed-runtime-persisted-"));
    tempPaths.push(root);
    const statePath = path.join(root, "state.json");
    await fs.writeFile(statePath, JSON.stringify({
      active: { base: "example/runtime@sha256:cached-base" },
      previous: {},
      checkedAt: null,
    }));
    const run = vi.fn(async () => ok("[]"));
    const service = new ManagedRuntimeService({ run, stream: vi.fn(async () => ok()) }, {
      statePath,
      repository: "example/runtime",
    });

    await service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "base");
    await service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "base");

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("docker", ["image", "inspect", "example/runtime@sha256:cached-base"]);

    service.invalidateImage("example/runtime@sha256:cached-base");
    await service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "base");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("rejects a channel image with the wrong runtime labels", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-managed-runtime-labels-"));
    tempPaths.push(root);
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args.some((arg) => arg.includes("RepoDigests"))) {
        return ok(`example/runtime@sha256:${"a".repeat(64)}\n`);
      }
      if (args[0] === "image" && args.includes("--format")) return ok("2 base\n");
      return ok("v24.4.1\n");
    });
    const service = new ManagedRuntimeService({ run, stream: vi.fn(async () => ok("pulled")) }, {
      statePath: path.join(root, "state.json"),
      repository: "example/runtime",
    });

    await expect(service.resolveImage(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, "base"))
      .rejects.toThrow(/labels are invalid/);
  });
});
