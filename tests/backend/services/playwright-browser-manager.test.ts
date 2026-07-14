import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { PlaywrightBrowserManager } from "../../../src/services/playwright-browser-manager.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const ok = (stdout = "") => ({ ok: true, stdout, stderr: "", code: 0, signal: null }) as any;
const fail = (stderr: string) => ({ ok: false, stdout: "", stderr, code: 1, signal: null }) as any;

describe("PlaywrightBrowserManager", () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  const createHarness = async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-playwright-browser-"));
    tempPaths.push(root);
    const volumes = new Set<string>();
    const installed = new Set<string>();
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "image" && args[1] === "inspect") return ok("1.61.1\n");
      if (args[0] === "volume" && args[1] === "inspect") {
        return volumes.has(args[2]) ? ok() : fail("missing");
      }
      if (args[0] === "volume" && args[1] === "create") {
        volumes.add(args.at(-1)!);
        return ok(args.at(-1));
      }
      if (args[0] === "volume" && args[1] === "rm") {
        volumes.delete(args.at(-1)!);
        installed.delete(args.at(-1)!);
        return ok();
      }
      if (args[0] === "run") {
        const mount = args.find((arg) => arg.startsWith("type=volume,source=")) || "";
        const volume = mount.split(",")[1]?.split("=")[1];
        return volume && installed.has(volume) ? ok() : fail("unverified");
      }
      return ok();
    });
    const stream = vi.fn(async (_command: string, args: string[]) => {
      const mount = args.find((arg) => arg.startsWith("type=volume,source=")) || "";
      const volume = mount.split(",")[1]?.split("=")[1];
      if (volume) installed.add(volume);
      return ok("installed");
    });
    const runtime = {
      resolveImage: vi.fn(async () => "example/runtime@sha256:browser"),
      getCompatibilityKey: vi.fn(() => "runtime-abi-1"),
    } as any;
    return {
      manager: new PlaywrightBrowserManager(runtime, { run, stream }, { statePath: path.join(root, "state.json") }),
      run,
      stream,
    };
  };

  it("installs the Playwright-matched browser once and reuses the verified volume", async () => {
    const { manager, run, stream } = await createHarness();
    const first = await manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);
    const second = await manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    expect(first).toEqual(second);
    expect(first.volumeName).toContain("code-ux-playwright-browser-1.61.1");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toMatchObject({ state: "ready", installedVersion: "1.61.1" });
    expect(run.mock.calls.filter(([, args]) => args[0] === "run")).toHaveLength(1);

    manager.invalidatePreparedVolume(first.volumeName);
    await manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);
    expect(run.mock.calls.filter(([, args]) => args[0] === "run")).toHaveLength(2);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent browser downloads", async () => {
    const { manager, stream } = await createHarness();
    const [left, right] = await Promise.all([
      manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow),
      manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow),
    ]);

    expect(left.volumeName).toBe(right.volumeName);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("downloads through Playwright into a writable staging volume", async () => {
    const { manager, stream } = await createHarness();
    await manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    const args = stream.mock.calls[0]?.[1] as string[];
    expect(args).toEqual(expect.arrayContaining([
      expect.stringMatching(/^type=volume,source=code-ux-playwright-browser-1\.61\.1-[a-f0-9]{16},target=\/ms-playwright$/),
    ]));
    expect(args.at(-1)).toContain("playwright install chromium");
  });

  it("accepts the runner-resolved browser image without resolving it again", async () => {
    const { manager } = await createHarness();
    const runtime = (manager as any).runtime;

    await manager.prepare(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, {
      resolvedImage: "example/runtime@sha256:browser",
    });

    expect(runtime.resolveImage).not.toHaveBeenCalled();
  });

  it("rejects custom images because they retain their explicit setup behavior", async () => {
    const { manager } = await createHarness();
    await expect(manager.prepare({
      ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
      containerImageMode: "custom",
    })).rejects.toThrow(/Custom images/);
  });
});
