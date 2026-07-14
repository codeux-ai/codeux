import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { CliWorkflowSettings, ManagedRuntimeStatus } from "../contracts/app-types.js";
import { commandRunner, runStreamingCommand, type CommandResult } from "./cli-process-runner.js";
import type { Logger } from "../shared/logging/logger.js";

export type ManagedRuntimeRole = "base" | "browser";

interface ManagedRuntimePersistedState {
  active: Partial<Record<ManagedRuntimeRole, string>>;
  previous: Partial<Record<ManagedRuntimeRole, string>>;
  checkedAt: string | null;
}

interface ManagedRuntimeCommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
  stream(command: string, args: string[], onLine: (line: string) => void): Promise<CommandResult>;
}

const DEFAULT_RUNTIME_REPOSITORY = "ghcr.io/codeux-ai/codeux-runtime";
const DEFAULT_RUNTIME_CHANNEL = "1";
const FALLBACK_CUSTOM_IMAGE = "node:24-trixie-slim";

const defaultCommandRunner: ManagedRuntimeCommandRunner = {
  run: async (command, args) => await commandRunner.run(command, args, { cwd: process.cwd(), env: process.env }),
  stream: async (command, args, onLine) => await runStreamingCommand(command, args, process.cwd(), process.env, {
    onStdoutLine: onLine,
    onStderrLine: onLine,
  }),
};

const createInitialStatus = (): ManagedRuntimeStatus => ({
  state: "idle",
  activeVersion: null,
  targetVersion: null,
  baseImage: null,
  browserImage: null,
  progressPercent: null,
  stepText: "Managed runtime has not been checked yet.",
  error: null,
  rollbackAvailable: false,
  checkedAt: null,
});

export class ManagedRuntimeService {
  private readonly statePath: string;
  private readonly repository: string;
  private readonly channel: string;
  private readonly inFlight = new Map<ManagedRuntimeRole, Promise<string>>();
  private readonly imageChecks = new Map<string, Promise<boolean>>();
  private readonly verifiedInProcess = new Set<string>();
  private stateLoadPromise?: Promise<void>;
  private readonly updateWarnings: string[] = [];
  private persistQueue: Promise<void> = Promise.resolve();
  private persisted: ManagedRuntimePersistedState = { active: {}, previous: {}, checkedAt: null };
  private status = createInitialStatus();

  constructor(
    private readonly commands: ManagedRuntimeCommandRunner = defaultCommandRunner,
    options: { statePath?: string; repository?: string; channel?: string } = {},
  ) {
    this.statePath = options.statePath ?? path.join(os.homedir(), ".code-ux", "runtime", "managed-runtime.json");
    this.repository = options.repository ?? process.env.CODE_UX_MANAGED_RUNTIME_REPOSITORY?.trim() ?? DEFAULT_RUNTIME_REPOSITORY;
    this.channel = options.channel ?? process.env.CODE_UX_MANAGED_RUNTIME_CHANNEL?.trim() ?? DEFAULT_RUNTIME_CHANNEL;
  }

  getStatus(): ManagedRuntimeStatus {
    return { ...this.status };
  }

  invalidateImage(image: string): void {
    this.verifiedInProcess.delete(image);
  }

  getCompatibilityKey(image: string): string {
    const compatibilitySource = image.startsWith(`${this.repository}:`) || image.startsWith(`${this.repository}@`)
      ? `managed-runtime-abi-1:${process.arch}`
      : `custom-image:${image}`;
    return createHash("sha256").update(compatibilitySource).digest("hex").slice(0, 20);
  }

  async resolveImage(settings: CliWorkflowSettings, role: ManagedRuntimeRole): Promise<string> {
    if (settings.containerImageMode === "custom") {
      return settings.containerImage.trim() || FALLBACK_CUSTOM_IMAGE;
    }
    return await this.ensureRole(role, false);
  }

  async checkForUpdates(
    logger?: Logger,
    options: { minimumIntervalMs?: number } = {},
  ): Promise<void> {
    await this.loadState();
    const minimumIntervalMs = Math.max(0, Math.floor(options.minimumIntervalMs ?? 0));
    const lastCheckedMs = this.persisted.checkedAt ? Date.parse(this.persisted.checkedAt) : Number.NaN;
    if (
      minimumIntervalMs > 0
      && Number.isFinite(lastCheckedMs)
      && Date.now() - lastCheckedMs >= 0
      && Date.now() - lastCheckedMs < minimumIntervalMs
    ) {
      this.reflectImagesInStatus();
      this.updateStatus({
        state: "ready",
        stepText: "Managed runtime cache is current.",
        error: null,
        checkedAt: this.persisted.checkedAt,
        progressPercent: 100,
      });
      return;
    }
    this.updateWarnings.length = 0;
    this.updateStatus({
      state: "checking_update",
      targetVersion: this.channel,
      stepText: "Checking the managed runtime for updates.",
      error: null,
      progressPercent: 0,
    });
    const results = await Promise.allSettled([
      this.ensureRole("base", true, logger),
      this.ensureRole("browser", true, logger),
    ]);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    const checkedAt = new Date().toISOString();
    this.persisted.checkedAt = checkedAt;
    await this.persistState().catch(() => undefined);
    if (failures.length > 0 || this.updateWarnings.length > 0) {
      const message = [
        ...failures.map((failure) => failure.reason instanceof Error ? failure.reason.message : String(failure.reason)),
        ...this.updateWarnings,
      ].join("; ");
      this.updateStatus({
        state: "update_failed",
        stepText: "Managed runtime update failed; the last verified images remain active.",
        error: message,
        checkedAt,
        progressPercent: null,
      });
      logger?.warn("Managed runtime update check failed; retaining verified runtime.", { error: message });
      return;
    }
    this.updateStatus({
      state: "ready",
      stepText: "Managed runtime is ready.",
      error: null,
      checkedAt,
      progressPercent: 100,
    });
  }

  private async ensureRole(role: ManagedRuntimeRole, forcePull: boolean, logger?: Logger): Promise<string> {
    await this.loadState();
    const current = this.persisted.active[role];
    if (!forcePull && current) {
      if (this.verifiedInProcess.has(current) || await this.imageExists(current)) {
        this.verifiedInProcess.add(current);
        this.reflectImagesInStatus();
        return current;
      }
      this.verifiedInProcess.delete(current);
    }
    const existing = this.inFlight.get(role);
    if (existing) {
      return await existing;
    }
    const promise = this.pullAndVerify(role, logger).finally(() => {
      if (this.inFlight.get(role) === promise) {
        this.inFlight.delete(role);
      }
    });
    this.inFlight.set(role, promise);
    return await promise;
  }

  private async pullAndVerify(role: ManagedRuntimeRole, logger?: Logger): Promise<string> {
    const override = process.env[role === "base" ? "CODE_UX_MANAGED_BASE_IMAGE" : "CODE_UX_MANAGED_BROWSER_IMAGE"]?.trim();
    const channelRef = override || `${this.repository}:${this.channel}-${role}`;
    this.updateStatus({
      state: "pulling",
      targetVersion: this.channel,
      stepText: `Pulling managed ${role} runtime.`,
      error: null,
      progressPercent: null,
    });
    const pull = await this.commands.stream("docker", ["pull", channelRef], (line) => {
      const safeLine = line.trim().slice(0, 300);
      if (safeLine) this.updateStatus({ stepText: safeLine });
    });
    if (!pull.ok) {
      const cached = this.persisted.active[role];
      if (cached && await this.imageExists(cached)) {
        this.verifiedInProcess.add(cached);
        this.updateWarnings.push(`Unable to refresh managed ${role} runtime.`);
        logger?.warn("Managed runtime pull failed; using cached digest.", { role, image: cached });
        return cached;
      }
      throw new Error(`Unable to pull managed ${role} runtime: ${(pull.stderr || pull.stdout).trim().slice(0, 500)}`);
    }

    const digest = await this.resolvePulledDigest(channelRef);
    this.updateStatus({ state: "verifying", stepText: `Verifying managed ${role} runtime.`, progressPercent: 90 });
    const labels = await this.commands.run("docker", [
      "image", "inspect", "--format",
      "{{index .Config.Labels \"ai.codeux.runtime-abi\"}} {{index .Config.Labels \"ai.codeux.role\"}}",
      digest,
    ]);
    if (!labels.ok || labels.stdout.trim() !== `1 ${role}`) {
      throw new Error(`Managed ${role} runtime labels are invalid.`);
    }
    const verification = await this.commands.run("docker", ["run", "--rm", "--network", "none", digest, "node", "--version"]);
    if (!verification.ok || !verification.stdout.trim().startsWith("v24.")) {
      throw new Error(`Managed ${role} runtime verification failed.`);
    }

    const previous = this.persisted.active[role];
    if (previous && previous !== digest) {
      this.persisted.previous[role] = previous;
    }
    this.persisted.active[role] = digest;
    this.verifiedInProcess.add(digest);
    await this.persistState();
    this.reflectImagesInStatus();
    return digest;
  }

  private async resolvePulledDigest(image: string): Promise<string> {
    if (image.includes("@sha256:")) {
      return image;
    }
    const inspected = await this.commands.run("docker", ["image", "inspect", "--format", "{{join .RepoDigests \"\\n\"}}", image]);
    const digest = inspected.stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.includes("@sha256:"));
    if (!inspected.ok || !digest) {
      throw new Error(`Docker did not report an immutable digest for ${image}.`);
    }
    return digest;
  }

  private async imageExists(image: string): Promise<boolean> {
    const existing = this.imageChecks.get(image);
    if (existing) return await existing;
    const check = this.commands.run("docker", ["image", "inspect", image])
      .then((result) => {
        if (result.ok) this.verifiedInProcess.add(image);
        else this.verifiedInProcess.delete(image);
        return result.ok;
      })
      .catch(() => {
        this.verifiedInProcess.delete(image);
        return false;
      })
      .finally(() => {
        if (this.imageChecks.get(image) === check) this.imageChecks.delete(image);
      });
    this.imageChecks.set(image, check);
    return await check;
  }

  private async loadState(): Promise<void> {
    if (!this.stateLoadPromise) {
      this.stateLoadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8")) as ManagedRuntimePersistedState;
          this.persisted = {
            active: parsed.active || {},
            previous: parsed.previous || {},
            checkedAt: parsed.checkedAt || null,
          };
          this.reflectImagesInStatus();
          this.status.checkedAt = this.persisted.checkedAt;
        } catch {
          // The first successful pull creates the state file.
        }
      })();
    }
    await this.stateLoadPromise;
  }

  private persistState(): Promise<void> {
    const content = `${JSON.stringify(this.persisted, null, 2)}\n`;
    this.persistQueue = this.persistQueue.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.statePath), { recursive: true });
      const tempPath = `${this.statePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
      await fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 });
      await fs.rename(tempPath, this.statePath);
    });
    return this.persistQueue;
  }

  private reflectImagesInStatus(): void {
    this.updateStatus({
      baseImage: this.persisted.active.base ?? null,
      browserImage: this.persisted.active.browser ?? null,
      activeVersion: this.persisted.active.base?.split("@sha256:")[1]?.slice(0, 12) ?? null,
      rollbackAvailable: Boolean(this.persisted.previous.base || this.persisted.previous.browser),
    });
  }

  private updateStatus(update: Partial<ManagedRuntimeStatus>): void {
    this.status = { ...this.status, ...update };
  }
}

export const managedRuntimeService = new ManagedRuntimeService();
