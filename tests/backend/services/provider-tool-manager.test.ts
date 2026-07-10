import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderToolManager } from "../../../src/services/provider-tool-manager.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const ok = (stdout = "") => ({ ok: true, stdout, stderr: "", code: 0, signal: null }) as any;
const fail = (stderr: string) => ({ ok: false, stdout: "", stderr, code: 1, signal: null }) as any;

describe("ProviderToolManager", () => {
  const tempPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(tempPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  const createHarness = async (options: { throwOnFirstMissingInspect?: boolean } = {}) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-provider-tools-"));
    tempPaths.push(root);
    const volumes = new Set<string>();
    const installed = new Set<string>();
    let missingInspectThrown = false;
    const run = vi.fn(async (_command: string, args: string[]) => {
      if (args[0] === "volume" && args[1] === "inspect") {
        if (!volumes.has(args[2]) && options.throwOnFirstMissingInspect && !missingInspectThrown) {
          missingInspectThrown = true;
          throw new Error("missing volume");
        }
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
        return volume && installed.has(volume) ? ok("1.2.3") : fail("unverified");
      }
      return ok();
    });
    const stream = vi.fn(async (_command: string, args: string[]) => {
      const mount = args.find((arg) => arg.startsWith("type=volume,source=")) || "";
      const volume = mount.split(",")[1]?.split("=")[1];
      if (volume) installed.add(volume);
      return ok("installed");
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      version: "1.2.3",
      dist: { integrity: "sha512-test" },
    }), { status: 200, headers: { "content-type": "application/json" } })) as any;
    const runtime = {
      resolveImage: vi.fn(async () => "example/runtime@sha256:base"),
      getCompatibilityKey: vi.fn(() => "runtime-abi-1"),
    } as any;
    return {
      manager: new ProviderToolManager(runtime, { run, stream }, fetchImpl, { statePath: path.join(root, "state.json") }),
      run,
      stream,
      fetchImpl,
    };
  };

  it("installs a stable npm provider once and reuses its verified read-only volume", async () => {
    const { manager, stream, fetchImpl } = await createHarness();
    const first = await manager.prepare("codex", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);
    const second = await manager.prepare("codex", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    expect(first).toEqual(second);
    expect(first.volumeName).toContain("code-ux-provider-tool-codex-1.2.3");
    expect(stream).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(manager.getStatus("codex")).toMatchObject({ state: "ready", installedVersion: "1.2.3" });
  });

  it.each([
    ["claude-code", "@anthropic-ai/claude-code"],
    ["opencode", "opencode-ai"],
  ] as const)("allows only the trusted %s package lifecycle scripts", async (provider, packageName) => {
    const { manager, stream } = await createHarness();

    await manager.prepare(provider, DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    const shell = (stream.mock.calls[0]?.[1] as string[]).at(-1) || "";
    expect(shell).toContain(`--allow-scripts='${packageName}'`);
    expect(shell).toContain(`'${packageName}@1.2.3'`);
    expect(shell).not.toContain(`--allow-scripts='${packageName}@1.2.3'`);
  });

  it.each([
    ["gemini", "@google/gemini-cli"],
    ["codex", "@openai/codex"],
    ["qwen-code", "@qwen-code/qwen-code"],
  ] as const)("does not grant lifecycle-script permission to %s", async (provider, packageName) => {
    const { manager, stream } = await createHarness();

    await manager.prepare(provider, DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    const shell = (stream.mock.calls[0]?.[1] as string[]).at(-1) || "";
    expect(shell).toContain(`'${packageName}@1.2.3'`);
    expect(shell).not.toContain("--allow-scripts=");
  });

  it("reports the provider package and resolved version when installation fails", async () => {
    const { manager, stream, run } = await createHarness();
    stream.mockResolvedValueOnce(fail("postinstall failed for current platform"));

    await expect(manager.prepare("claude-code", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow)).rejects.toThrow(
      "Unable to install claude-code from @anthropic-ai/claude-code@1.2.3. postinstall failed for current platform",
    );
    expect(manager.getStatus("claude-code")).toMatchObject({
      state: "failed",
      error: expect.stringContaining("@anthropic-ai/claude-code@1.2.3"),
    });
    expect(run).toHaveBeenCalledWith("docker", expect.arrayContaining(["volume", "rm", "-f"]));
  });

  it("deduplicates concurrent preparation requests", async () => {
    const { manager, stream } = await createHarness();
    const [left, right] = await Promise.all([
      manager.prepare("gemini", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow),
      manager.prepare("gemini", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow),
    ]);
    expect(left.volumeName).toBe(right.volumeName);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("treats a thrown missing-volume probe as a first installation", async () => {
    const { manager } = await createHarness({ throwOnFirstMissingInspect: true });

    const prepared = await manager.prepare("codex", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    expect(prepared.version).toBe("1.2.3");
    expect(manager.getStatus("codex")?.state).toBe("ready");
  });

  it("installs Antigravity from the checksummed release archive", async () => {
    const { manager, stream, fetchImpl } = await createHarness();
    fetchImpl.mockResolvedValueOnce(new Response(JSON.stringify({
      version: "1.2.3",
      url: "https://storage.googleapis.com/antigravity-public/release.tar.gz",
      sha512: "a".repeat(128),
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await manager.prepare("antigravity", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);

    const installArgs = stream.mock.calls[0]?.[1] as string[];
    const shell = installArgs.at(-1) || "";
    expect(shell).toContain("sha512sum -c -");
    expect(shell).toContain("release.tar.gz");
    expect(shell).not.toContain("install.sh");
  });

  it("rejects hosted and unknown providers", async () => {
    const { manager } = await createHarness();
    await expect(manager.prepare("jules", DEFAULT_DASHBOARD_SETTINGS.cliWorkflow)).rejects.toThrow(/does not use/);
  });

  it("checks only active managed provider families", async () => {
    const { manager, fetchImpl } = await createHarness();
    await manager.checkActiveProviders(["codex", "jules", "codex"], DEFAULT_DASHBOARD_SETTINGS.cliWorkflow);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(manager.getStatus("gemini")?.state).toBe("not_installed");
  });
});
