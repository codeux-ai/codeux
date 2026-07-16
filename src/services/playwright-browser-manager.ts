import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CliWorkflowSettings,
  PlaywrightBrowserStatus,
} from "../contracts/app-types.js";
import { commandRunner, runStreamingCommand, type CommandResult } from "./cli-process-runner.js";
import { managedRuntimeService, type ManagedRuntimeService } from "./managed-runtime-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { getRuntimeOwnerDockerArgs } from "../shared/config/runtime-owner.js";

export const PLAYWRIGHT_BROWSERS_MOUNT = "/ms-playwright";

export interface PreparedPlaywrightBrowser {
  volumeName: string;
  version: string;
  mountPath: string;
}

export interface PlaywrightBrowserCommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
  stream(command: string, args: string[], onLine: (line: string) => void): Promise<CommandResult>;
}

const defaultCommands: PlaywrightBrowserCommandRunner = {
  run: async (command, args) => await commandRunner.run(command, args, { cwd: process.cwd(), env: process.env }),
  stream: async (command, args, onLine) => await runStreamingCommand(command, args, process.cwd(), process.env, {
    onStdoutLine: onLine,
    onStderrLine: onLine,
  }),
};

const createStatus = (): PlaywrightBrowserStatus => ({
  state: "not_installed",
  installedVersion: null,
  targetVersion: null,
  progressPercent: null,
  stepText: "Playwright browser artifacts are not prepared.",
  error: null,
  retryable: true,
  updatedAt: new Date().toISOString(),
});

export class PlaywrightBrowserManager {
  private readonly inFlight = new Map<string, Promise<PreparedPlaywrightBrowser>>();
  private readonly verificationInFlight = new Map<string, Promise<boolean>>();
  private readonly failedVerificationsInProcess = new Set<string>();
  private readonly active = new Map<string, PreparedPlaywrightBrowser>();
  private readonly verifiedInProcess = new Set<string>();
  private readonly versionByImage = new Map<string, string>();
  private readonly versionLookupsInFlight = new Map<string, Promise<string>>();
  private readonly statePath: string;
  private stateLoadPromise?: Promise<void>;
  private persistQueue: Promise<void> = Promise.resolve();
  private status = createStatus();

  constructor(
    private readonly runtime: ManagedRuntimeService = managedRuntimeService,
    private readonly commands: PlaywrightBrowserCommandRunner = defaultCommands,
    options: { statePath?: string } = {},
  ) {
    this.statePath = options.statePath ?? path.join(os.homedir(), ".code-ux", "runtime", "playwright-browser.json");
  }

  getStatus(): PlaywrightBrowserStatus {
    return { ...this.status };
  }

  invalidatePreparedVolume(volumeName: string): void {
    this.forgetVolumeVerification(volumeName);
  }

  async prepare(
    workflow: CliWorkflowSettings,
    options: { logger?: Logger; resolvedImage?: string } = {},
  ): Promise<PreparedPlaywrightBrowser> {
    if (workflow.containerImageMode === "custom") {
      throw new Error("Custom images manage their own Playwright browser installation.");
    }
    this.updateStatus({
      state: "waiting_for_docker",
      stepText: "Waiting for the managed browser runtime.",
      error: null,
    });
    let image: string;
    try {
      image = options.resolvedImage ?? await this.runtime.resolveImage(workflow, "browser");
    } catch (error) {
      this.fail("The managed browser runtime is unavailable.", error);
      throw error;
    }
    const version = await this.resolvePlaywrightVersion(image);
    const compatibilityKey = this.runtime.getCompatibilityKey(image);
    const jobKey = `${compatibilityKey}:${version}`;
    await this.loadState();

    const running = this.inFlight.get(jobKey);
    if (running) return await running;
    const cached = this.active.get(compatibilityKey);
    if (
      cached?.version === version
      && (
        this.verifiedInProcess.has(cached.volumeName)
        || await this.isVerifiedVolume(cached.volumeName, version, compatibilityKey, image)
      )
    ) {
      this.markReady(cached);
      return cached;
    }

    const promise = this.withCrossProcessLock(jobKey, async () => (
      await this.prepareInternal(image, version, compatibilityKey, options.logger)
    )).finally(() => {
      if (this.inFlight.get(jobKey) === promise) this.inFlight.delete(jobKey);
    });
    this.inFlight.set(jobKey, promise);
    return await promise;
  }

  private async prepareInternal(
    image: string,
    version: string,
    compatibilityKey: string,
    logger?: Logger,
  ): Promise<PreparedPlaywrightBrowser> {
    this.updateStatus({
      state: "checking_update",
      targetVersion: version,
      progressPercent: 10,
      stepText: `Checking Playwright browser ${version}.`,
      error: null,
    });
    const volumeName = this.buildVolumeName(version, compatibilityKey);
    try {
      if (await this.isVerifiedVolume(volumeName, version, compatibilityKey, image)) {
        const prepared = this.prepared(volumeName, version);
        this.active.set(compatibilityKey, prepared);
        await this.persistState();
        this.markReady(prepared);
        return prepared;
      }

      this.updateStatus({ state: "queued", progressPercent: 20, stepText: `Preparing Playwright browser ${version}.` });
      this.forgetVolumeVerification(volumeName);
      await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
      const created = await this.commands.run("docker", [
        "volume", "create",
        "--label", "code-ux.managed=true",
        ...getRuntimeOwnerDockerArgs(),
        "--label", "ai.codeux.asset=playwright-browser",
        "--label", `ai.codeux.version=${this.labelValue(version)}`,
        "--label", `ai.codeux.compatibility=${compatibilityKey}`,
        volumeName,
      ]);
      if (!created.ok) throw new Error("Unable to create the Playwright browser Docker volume.");

      this.updateStatus({ state: "downloading", progressPercent: 30, stepText: `Downloading Playwright browser ${version}.` });
      const marker = JSON.stringify({
        schemaVersion: 1,
        version,
        compatibilityKey,
        installedAt: new Date().toISOString(),
      });
      const install = await this.commands.stream("docker", [
        "run", "--rm",
        "--label", "code-ux.managed=true",
        ...getRuntimeOwnerDockerArgs(),
        "--label", "ai.codeux.browser-installer=playwright",
        "--mount", `type=volume,source=${volumeName},target=${PLAYWRIGHT_BROWSERS_MOUNT}`,
        image,
        "bash", "-lc",
        [
          "set -euo pipefail",
          "playwright install chromium",
          `printf '%s\\n' ${this.shellQuote(marker)} > ${PLAYWRIGHT_BROWSERS_MOUNT}/.codeux-playwright-browser.json`,
          `chmod -R a+rX ${PLAYWRIGHT_BROWSERS_MOUNT}`,
        ].join(" && "),
      ], (line) => {
        const safe = line.trim().replace(/https?:\/\/\S+/g, "[browser source]").slice(0, 300);
        if (safe) this.updateStatus({ state: "installing", progressPercent: 60, stepText: safe });
      });
      if (!install.ok) {
        await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
        throw new Error((install.stderr || install.stdout || "Unable to install the Playwright browser.").trim().slice(0, 700));
      }

      this.updateStatus({ state: "verifying", progressPercent: 90, stepText: `Verifying Playwright browser ${version}.` });
      if (!await this.isVerifiedVolume(volumeName, version, compatibilityKey, image)) {
        this.forgetVolumeVerification(volumeName);
        await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
        throw new Error("Playwright browser verification failed.");
      }
      const prepared = this.prepared(volumeName, version);
      this.active.set(compatibilityKey, prepared);
      await this.persistState();
      this.markReady(prepared);
      return prepared;
    } catch (error) {
      this.fail("Playwright browser preparation failed.", error);
      logger?.warn("Playwright browser preparation failed; no unverified volume will be mounted.", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async resolvePlaywrightVersion(image: string): Promise<string> {
    const cached = this.versionByImage.get(image);
    if (cached) return cached;
    const existing = this.versionLookupsInFlight.get(image);
    if (existing) return await existing;
    const lookup = this.inspectPlaywrightVersion(image).finally(() => {
      if (this.versionLookupsInFlight.get(image) === lookup) this.versionLookupsInFlight.delete(image);
    });
    this.versionLookupsInFlight.set(image, lookup);
    return await lookup;
  }

  private async inspectPlaywrightVersion(image: string): Promise<string> {
    const inspected = await this.commands.run("docker", [
      "image", "inspect", "--format",
      "{{index .Config.Labels \"ai.codeux.playwright-version\"}}",
      image,
    ]);
    const version = inspected.stdout.trim();
    if (!inspected.ok || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      throw new Error("Managed browser runtime does not declare a valid Playwright version.");
    }
    this.versionByImage.set(image, version);
    this.updateStatus({ targetVersion: version });
    return version;
  }

  private async isVerifiedVolume(
    volumeName: string,
    version: string,
    compatibilityKey: string,
    image: string,
  ): Promise<boolean> {
    if (this.verifiedInProcess.has(volumeName)) return true;
    const verificationKey = `${volumeName}\0${version}\0${compatibilityKey}\0${image}`;
    if (this.failedVerificationsInProcess.has(verificationKey)) return false;
    const existing = this.verificationInFlight.get(verificationKey);
    if (existing) return await existing;
    const verification = this.verifyVolume(volumeName, version, compatibilityKey, image).finally(() => {
      if (this.verificationInFlight.get(verificationKey) === verification) {
        this.verificationInFlight.delete(verificationKey);
      }
    });
    this.verificationInFlight.set(verificationKey, verification);
    return await verification;
  }

  private async verifyVolume(
    volumeName: string,
    version: string,
    compatibilityKey: string,
    image: string,
  ): Promise<boolean> {
    const verificationKey = `${volumeName}\0${version}\0${compatibilityKey}\0${image}`;
    const inspect = await this.commands.run("docker", ["volume", "inspect", volumeName]).catch(() => null);
    if (!inspect?.ok) {
      this.failedVerificationsInProcess.add(verificationKey);
      return false;
    }
    const markerCheck = [
      "const fs=require('fs')",
      `const marker=JSON.parse(fs.readFileSync('${PLAYWRIGHT_BROWSERS_MOUNT}/.codeux-playwright-browser.json','utf8'))`,
      `if(marker.version!==${JSON.stringify(version)}||marker.compatibilityKey!==${JSON.stringify(compatibilityKey)})process.exit(2)`,
    ].join(";");
    const verified = await this.commands.run("docker", [
      "run", "--rm", "--network", "none",
      "--mount", `type=volume,source=${volumeName},target=${PLAYWRIGHT_BROWSERS_MOUNT},readonly`,
      image,
      "bash", "-lc",
      [
        `node -e ${this.shellQuote(markerCheck)}`,
        `test -n "$(find ${PLAYWRIGHT_BROWSERS_MOUNT} -type f -path '*/chrome-linux*/chrome' -print -quit)"`,
        "playwright screenshot --browser chromium about:blank /tmp/codeux-browser-check.png >/dev/null",
        "test -s /tmp/codeux-browser-check.png",
      ].join(" && "),
    ]);
    if (verified.ok) {
      this.verifiedInProcess.add(volumeName);
      this.failedVerificationsInProcess.delete(verificationKey);
    } else {
      this.failedVerificationsInProcess.add(verificationKey);
    }
    return verified.ok;
  }

  private forgetVolumeVerification(volumeName: string): void {
    this.verifiedInProcess.delete(volumeName);
    const prefix = `${volumeName}\0`;
    for (const key of this.failedVerificationsInProcess) {
      if (key.startsWith(prefix)) this.failedVerificationsInProcess.delete(key);
    }
  }

  private async loadState(): Promise<void> {
    if (!this.stateLoadPromise) {
      this.stateLoadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8")) as Record<string, PreparedPlaywrightBrowser>;
          for (const [key, browser] of Object.entries(parsed)) {
            if (!browser || typeof browser.volumeName !== "string" || typeof browser.version !== "string") continue;
            this.active.set(key, browser);
            this.markReady(browser);
          }
        } catch {
          // The first successful preparation creates the state file.
        }
      })();
    }
    await this.stateLoadPromise;
  }

  private persistState(): Promise<void> {
    const content = `${JSON.stringify(Object.fromEntries(this.active), null, 2)}\n`;
    this.persistQueue = this.persistQueue.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tempPath, this.statePath);
    });
    return this.persistQueue;
  }

  private async withCrossProcessLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lockRoot = path.join(path.dirname(this.statePath), "playwright-browser-locks");
    await fs.mkdir(lockRoot, { recursive: true });
    const lockPath = path.join(lockRoot, `${createHash("sha256").update(key).digest("hex")}.lock`);
    const deadline = Date.now() + 30 * 60_000;
    while (true) {
      try {
        const handle = await fs.open(lockPath, "wx", 0o600);
        try {
          await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), key })}\n`);
          return await operation();
        } finally {
          await handle.close().catch(() => undefined);
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 30 * 60_000) {
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) throw new Error("Timed out waiting for another Code UX process to prepare Playwright.");
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  private prepared(volumeName: string, version: string): PreparedPlaywrightBrowser {
    return { volumeName, version, mountPath: PLAYWRIGHT_BROWSERS_MOUNT };
  }

  private buildVolumeName(version: string, compatibilityKey: string): string {
    const digest = createHash("sha256").update(`${version}\0${compatibilityKey}`).digest("hex").slice(0, 16);
    return `code-ux-playwright-browser-${this.labelValue(version)}-${digest}`.slice(0, 120);
  }

  private labelValue(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 40);
  }

  private shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private markReady(prepared: PreparedPlaywrightBrowser): void {
    this.updateStatus({
      state: "ready",
      installedVersion: prepared.version,
      targetVersion: prepared.version,
      progressPercent: 100,
      stepText: `Playwright browser ${prepared.version} is ready.`,
      error: null,
    });
  }

  private fail(stepText: string, error: unknown): void {
    this.updateStatus({
      state: "failed",
      progressPercent: null,
      stepText,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 700),
    });
  }

  private updateStatus(update: Partial<PlaywrightBrowserStatus>): void {
    this.status = { ...this.status, ...update, updatedAt: new Date().toISOString() };
  }
}

export const playwrightBrowserManager = new PlaywrightBrowserManager();
