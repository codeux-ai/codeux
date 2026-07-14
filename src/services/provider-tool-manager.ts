import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CliWorkflowSettings,
  ProviderId,
  ProviderToolStatus,
} from "../contracts/app-types.js";
import { commandRunner, runStreamingCommand, type CommandResult } from "./cli-process-runner.js";
import { managedRuntimeService, type ManagedRuntimeService } from "./managed-runtime-service.js";
import type { Logger } from "../shared/logging/logger.js";

export const PROVIDER_TOOL_MOUNT = "/opt/code-ux/provider-tool";

export const PROVIDER_TOOL_IDS = [
  "gemini",
  "codex",
  "claude-code",
  "qwen-code",
  "opencode",
  "antigravity",
] as const satisfies readonly ProviderId[];

export type ProviderToolId = typeof PROVIDER_TOOL_IDS[number];

interface NpmProviderSpec {
  kind: "npm";
  packageName: string;
  binary: string;
  allowInstallScripts?: true;
}

interface NativeProviderSpec {
  kind: "antigravity";
  binary: string;
}

type ProviderToolSpec = NpmProviderSpec | NativeProviderSpec;

interface ProviderRelease {
  version: string;
  integrity: string;
  downloadUrl?: string;
  sha512?: string;
}

export interface PreparedProviderTool {
  provider: ProviderToolId;
  volumeName: string;
  version: string;
  binary: string;
  mountPath: string;
}

interface ProviderToolCommandRunner {
  run(command: string, args: string[]): Promise<CommandResult>;
  stream(command: string, args: string[], onLine: (line: string) => void): Promise<CommandResult>;
}

const PROVIDER_SPECS: Record<ProviderToolId, ProviderToolSpec> = {
  gemini: { kind: "npm", packageName: "@google/gemini-cli", binary: "gemini" },
  codex: { kind: "npm", packageName: "@openai/codex", binary: "codex" },
  "claude-code": {
    kind: "npm",
    packageName: "@anthropic-ai/claude-code",
    binary: "claude",
    allowInstallScripts: true,
  },
  "qwen-code": { kind: "npm", packageName: "@qwen-code/qwen-code", binary: "qwen" },
  opencode: {
    kind: "npm",
    packageName: "opencode-ai",
    binary: "opencode",
    allowInstallScripts: true,
  },
  antigravity: { kind: "antigravity", binary: "agy" },
};

const ANTIGRAVITY_RELEASE_ORIGIN = "https://antigravity-cli-auto-updater-974169037036.us-central1.run.app";
const defaultCommands: ProviderToolCommandRunner = {
  run: async (command, args) => await commandRunner.run(command, args, { cwd: process.cwd(), env: process.env }),
  stream: async (command, args, onLine) => await runStreamingCommand(command, args, process.cwd(), process.env, {
    onStdoutLine: onLine,
    onStderrLine: onLine,
  }),
};

const isProviderToolId = (provider: ProviderId | string): provider is ProviderToolId => (
  (PROVIDER_TOOL_IDS as readonly string[]).includes(provider)
);

const createStatus = (provider: ProviderToolId): ProviderToolStatus => ({
  provider,
  state: "not_installed",
  installedVersion: null,
  targetVersion: null,
  progressPercent: null,
  stepText: "Provider CLI is not prepared.",
  error: null,
  retryable: true,
  updatedAt: new Date().toISOString(),
});

export class ProviderToolManager {
  private readonly inFlight = new Map<string, Promise<PreparedProviderTool>>();
  private readonly verificationInFlight = new Map<string, Promise<boolean>>();
  private readonly failedVerificationsInProcess = new Set<string>();
  private readonly active = new Map<string, PreparedProviderTool>();
  private readonly verifiedInProcess = new Set<string>();
  private readonly statePath: string;
  private stateLoadPromise?: Promise<void>;
  private persistQueue: Promise<void> = Promise.resolve();
  private readonly statuses = new Map<ProviderToolId, ProviderToolStatus>(
    PROVIDER_TOOL_IDS.map((provider) => [provider, createStatus(provider)]),
  );

  constructor(
    private readonly runtime: ManagedRuntimeService = managedRuntimeService,
    private readonly commands: ProviderToolCommandRunner = defaultCommands,
    private readonly fetchImpl: typeof fetch = fetch,
    options: { statePath?: string } = {},
  ) {
    this.statePath = options.statePath ?? path.join(os.homedir(), ".code-ux", "runtime", "provider-tools.json");
  }

  getStatuses(): ProviderToolStatus[] {
    return PROVIDER_TOOL_IDS.map((provider) => ({ ...this.statuses.get(provider)! }));
  }

  getStatus(provider: ProviderId | string): ProviderToolStatus | null {
    return isProviderToolId(provider) ? { ...this.statuses.get(provider)! } : null;
  }

  invalidatePreparedVolume(volumeName: string): void {
    this.forgetVolumeVerification(volumeName);
  }

  async prepare(
    provider: ProviderId | string,
    workflow: CliWorkflowSettings,
    options: { logger?: Logger; checkForUpdate?: boolean; resolvedImage?: string } = {},
  ): Promise<PreparedProviderTool> {
    if (!isProviderToolId(provider)) {
      throw new Error(`Provider '${provider}' does not use a managed CLI tool.`);
    }
    this.updateStatus(provider, {
      state: "waiting_for_docker",
      stepText: `Waiting for the runtime needed to prepare ${provider}.`,
      error: null,
    });
    let image: string;
    try {
      image = options.resolvedImage ?? await this.runtime.resolveImage(workflow, "base");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.updateStatus(provider, {
        state: "failed",
        stepText: `The runtime for ${provider} is unavailable.`,
        error: message.slice(0, 700),
      });
      throw error;
    }
    const compatibilityKey = this.runtime.getCompatibilityKey(image);
    const jobKey = `${provider}:${compatibilityKey}`;
    await this.loadState();
    const cached = this.active.get(jobKey);
    if (cached && !options.checkForUpdate && await this.isVerifiedVolume(cached.volumeName, provider, cached.version, image)) {
      this.updateStatus(provider, {
        state: "ready",
        installedVersion: cached.version,
        targetVersion: cached.version,
        progressPercent: 100,
        stepText: `${provider} ${cached.version} is ready.`,
        error: null,
      });
      return cached;
    }
    // A background stable-channel check must not make an invocation wait when the previous
    // immutable volume is already verified. Update preparation writes a new versioned volume and
    // switches only future calls, so returning the current cache here is race-safe.
    const existing = this.inFlight.get(jobKey);
    if (existing) return await existing;

    const promise = this.withCrossProcessLock(jobKey, async () => (
      await this.prepareInternal(provider, image, compatibilityKey, options.logger)
    )).finally(() => {
      if (this.inFlight.get(jobKey) === promise) this.inFlight.delete(jobKey);
    });
    this.inFlight.set(jobKey, promise);
    return await promise;
  }

  async checkActiveProviders(
    providers: Iterable<ProviderId>,
    workflow: CliWorkflowSettings,
    logger?: Logger,
    options: { minimumUpdateIntervalMs?: number } = {},
  ): Promise<void> {
    const active = Array.from(new Set(Array.from(providers).filter(isProviderToolId)));
    const minimumUpdateIntervalMs = Math.max(0, Math.floor(options.minimumUpdateIntervalMs ?? 0));
    const stateIsFresh = minimumUpdateIntervalMs > 0
      ? await this.isPersistedStateFresh(minimumUpdateIntervalMs)
      : false;
    const concurrency = 2;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(concurrency, active.length) }, async () => {
      while (cursor < active.length) {
        const provider = active[cursor++];
        await this.prepare(provider, workflow, { logger, checkForUpdate: !stateIsFresh }).catch((error: unknown) => {
          logger?.warn("Provider CLI update failed; retaining the last verified volume.", {
            provider,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    });
    await Promise.all(workers);
  }

  private async isPersistedStateFresh(maxAgeMs: number): Promise<boolean> {
    const stat = await fs.stat(this.statePath).catch(() => null);
    if (!stat) return false;
    // Filesystem mtimes can land a few milliseconds ahead of the process clock after an
    // atomic rename (notably on virtualized CI filesystems). A future mtime is necessarily
    // fresh; clamping it avoids a redundant registry request immediately after persistence.
    const ageMs = Math.max(0, Date.now() - stat.mtimeMs);
    return ageMs < maxAgeMs;
  }

  private async prepareInternal(
    provider: ProviderToolId,
    image: string,
    compatibilityKey: string,
    logger?: Logger,
  ): Promise<PreparedProviderTool> {
    const previousCandidate = this.findActive(provider, compatibilityKey);
    const previous = previousCandidate
      && await this.isVerifiedVolume(previousCandidate.volumeName, provider, previousCandidate.version, image)
      ? previousCandidate
      : null;
    this.updateStatus(provider, {
      state: "checking_update",
      stepText: `Checking ${provider} for updates.`,
      error: null,
      progressPercent: 5,
      installedVersion: previous?.version ?? this.statuses.get(provider)?.installedVersion ?? null,
    });
    try {
      const release = await this.resolveRelease(provider);
      this.updateStatus(provider, { targetVersion: release.version, progressPercent: 15 });
      const volumeName = this.buildVolumeName(provider, release.version, release.integrity, compatibilityKey);
      if (await this.isVerifiedVolume(volumeName, provider, release.version, image)) {
        const prepared = this.preparedTool(provider, volumeName, release.version);
        this.active.set(`${provider}:${compatibilityKey}`, prepared);
        await this.persistState();
        this.updateStatus(provider, {
          state: "ready",
          installedVersion: release.version,
          targetVersion: release.version,
          progressPercent: 100,
          stepText: `${provider} ${release.version} is ready.`,
          error: null,
        });
        return prepared;
      }

      this.updateStatus(provider, { state: "queued", stepText: `Preparing ${provider} ${release.version}.`, progressPercent: 20 });
      this.forgetVolumeVerification(volumeName);
      await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
      const create = await this.commands.run("docker", [
        "volume", "create",
        "--label", "code-ux.managed=true",
        "--label", "ai.codeux.asset=provider-tool",
        "--label", `ai.codeux.provider=${provider}`,
        "--label", `ai.codeux.version=${this.labelValue(release.version)}`,
        "--label", `ai.codeux.compatibility=${compatibilityKey}`,
        volumeName,
      ]);
      if (!create.ok) throw new Error(`Unable to create Docker volume for ${provider}.`);

      this.updateStatus(provider, { state: "downloading", stepText: `Downloading ${provider} ${release.version}.`, progressPercent: 30 });
      const install = await this.installProvider(provider, release, image, volumeName);
      if (!install.ok) {
        this.forgetVolumeVerification(volumeName);
        await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
        throw new Error(this.describeInstallFailure(provider, release, install));
      }

      this.updateStatus(provider, { state: "verifying", stepText: `Verifying ${provider} ${release.version}.`, progressPercent: 90 });
      if (!await this.isVerifiedVolume(volumeName, provider, release.version, image)) {
        this.forgetVolumeVerification(volumeName);
        await this.commands.run("docker", ["volume", "rm", "-f", volumeName]);
        throw new Error(`${provider} installation did not produce a valid verified marker.`);
      }

      const prepared = this.preparedTool(provider, volumeName, release.version);
      this.active.set(`${provider}:${compatibilityKey}`, prepared);
      await this.persistState();
      this.updateStatus(provider, {
        state: "ready",
        installedVersion: release.version,
        targetVersion: release.version,
        progressPercent: 100,
        stepText: `${provider} ${release.version} is ready.`,
        error: null,
      });
      logger?.info("Provider CLI prepared.", { provider, version: release.version, volumeName });
      return prepared;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (previous) {
        this.updateStatus(provider, {
          state: "ready",
          installedVersion: previous.version,
          progressPercent: 100,
          stepText: `${provider} ${previous.version} is ready; update check failed.`,
          error: message,
        });
        return previous;
      }
      this.updateStatus(provider, {
        state: "failed",
        stepText: `Failed to prepare ${provider}.`,
        error: message.slice(0, 700),
        progressPercent: null,
      });
      throw error;
    }
  }

  private async resolveRelease(provider: ProviderToolId): Promise<ProviderRelease> {
    const spec = PROVIDER_SPECS[provider];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      if (spec.kind === "npm") {
        const packagePath = encodeURIComponent(spec.packageName);
        const response = await this.fetchImpl(`https://registry.npmjs.org/${packagePath}/latest`, {
          signal: controller.signal,
          headers: { Accept: "application/json" },
        });
        if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status} for ${provider}.`);
        const payload = await response.json() as { version?: unknown; dist?: { integrity?: unknown; shasum?: unknown } };
        if (typeof payload.version !== "string" || !payload.version.trim()) {
          throw new Error(`npm registry did not return a stable version for ${provider}.`);
        }
        const integrity = typeof payload.dist?.integrity === "string"
          ? payload.dist.integrity
          : typeof payload.dist?.shasum === "string" ? payload.dist.shasum : payload.version;
        return { version: payload.version, integrity };
      }

      const platform = process.arch === "arm64" ? "linux_arm64" : "linux_amd64";
      const response = await this.fetchImpl(`${ANTIGRAVITY_RELEASE_ORIGIN}/manifests/${platform}.json`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Antigravity release service returned HTTP ${response.status}.`);
      const payload = await response.json() as { version?: unknown; url?: unknown; sha512?: unknown };
      if (
        typeof payload.version !== "string"
        || typeof payload.url !== "string"
        || typeof payload.sha512 !== "string"
        || !/^https:\/\//.test(payload.url)
        || !/^[a-fA-F0-9]{128}$/.test(payload.sha512)
      ) {
        throw new Error("Antigravity release manifest is incomplete.");
      }
      return {
        version: payload.version,
        integrity: `sha512-${payload.sha512.toLowerCase()}`,
        downloadUrl: payload.url,
        sha512: payload.sha512.toLowerCase(),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async installProvider(
    provider: ProviderToolId,
    release: ProviderRelease,
    image: string,
    volumeName: string,
  ): Promise<CommandResult> {
    const spec = PROVIDER_SPECS[provider];
    const allowScripts = spec.kind === "npm" && spec.allowInstallScripts
      ? ` --allow-scripts=${this.shellQuote(spec.packageName)}`
      : "";
    const installCommand = spec.kind === "npm"
      ? `npm install --global --prefix ${PROVIDER_TOOL_MOUNT}${allowScripts} ${this.shellQuote(`${spec.packageName}@${release.version}`)} --no-audit --no-fund`
      : this.buildAntigravityInstallCommand(release);
    const marker = JSON.stringify({
      schemaVersion: 1,
      provider,
      version: release.version,
      integrity: release.integrity,
      verifiedAt: new Date().toISOString(),
    });
    const shell = [
      "set -euo pipefail",
      `mkdir -p ${PROVIDER_TOOL_MOUNT}/bin`,
      installCommand,
      `reported_version="$(${PROVIDER_TOOL_MOUNT}/bin/${spec.binary} --version 2>&1)"`,
      `printf '%s' "$reported_version" | grep -F ${this.shellQuote(release.version)} >/dev/null`,
      `printf '%s\\n' ${this.shellQuote(marker)} > ${PROVIDER_TOOL_MOUNT}/.codeux-provider-tool.json`,
      `chmod -R a+rX ${PROVIDER_TOOL_MOUNT}`,
    ].join(" && ");
    return await this.commands.stream("docker", [
      "run", "--rm",
      "--label", "code-ux.managed=true",
      "--label", `ai.codeux.provider-installer=${provider}`,
      "-e", "DISABLE_AUTOUPDATER=1",
      "-e", "OPENCODE_DISABLE_AUTOUPDATE=true",
      "-e", "AGY_CLI_DISABLE_AUTO_UPDATE=true",
      "--mount", `type=volume,source=${volumeName},target=${PROVIDER_TOOL_MOUNT}`,
      image, "bash", "-lc", shell,
    ], (line) => {
      const safe = line.trim().replace(/https?:\/\/\S+/g, "[provider source]").slice(0, 300);
      if (safe) this.updateStatus(provider, { state: "installing", stepText: safe, progressPercent: 60 });
    });
  }

  private describeInstallFailure(
    provider: ProviderToolId,
    release: ProviderRelease,
    result: CommandResult,
  ): string {
    const spec = PROVIDER_SPECS[provider];
    const source = spec.kind === "npm"
      ? `${spec.packageName}@${release.version}`
      : `Antigravity ${release.version}`;
    const detail = (result.stderr || result.stdout || "The installer exited without diagnostic output.").trim();
    return `Unable to install ${provider} from ${source}. ${detail}`.slice(0, 700);
  }

  private buildAntigravityInstallCommand(release: ProviderRelease): string {
    if (!release.downloadUrl || !release.sha512) {
      throw new Error("Antigravity release metadata is incomplete.");
    }
    const archivePath = "/tmp/codeux-antigravity.tar.gz";
    const extractedPath = "/tmp/antigravity";
    return [
      `curl -fsSL --proto '=https' --tlsv1.2 -o ${archivePath} ${this.shellQuote(release.downloadUrl)}`,
      `printf '%s  %s\\n' ${this.shellQuote(release.sha512)} ${archivePath} | sha512sum -c -`,
      `tar -xzf ${archivePath} -C /tmp antigravity`,
      `install -m 0755 ${extractedPath} ${PROVIDER_TOOL_MOUNT}/bin/agy`,
    ].join(" && ");
  }

  private async isVerifiedVolume(
    volumeName: string,
    provider: ProviderToolId,
    version: string,
    image: string,
  ): Promise<boolean> {
    if (this.verifiedInProcess.has(volumeName)) return true;
    const verificationKey = `${volumeName}\0${provider}\0${version}\0${image}`;
    if (this.failedVerificationsInProcess.has(verificationKey)) return false;
    const existing = this.verificationInFlight.get(verificationKey);
    if (existing) return await existing;
    const verification = this.verifyVolume(volumeName, provider, version, image).finally(() => {
      if (this.verificationInFlight.get(verificationKey) === verification) {
        this.verificationInFlight.delete(verificationKey);
      }
    });
    this.verificationInFlight.set(verificationKey, verification);
    return await verification;
  }

  private async verifyVolume(
    volumeName: string,
    provider: ProviderToolId,
    version: string,
    image: string,
  ): Promise<boolean> {
    const verificationKey = `${volumeName}\0${provider}\0${version}\0${image}`;
    const inspect = await this.commands.run("docker", ["volume", "inspect", volumeName]).catch(() => null);
    if (!inspect?.ok) {
      this.failedVerificationsInProcess.add(verificationKey);
      return false;
    }
    const spec = PROVIDER_SPECS[provider];
    const verifyScript = [
      `const fs=require('fs')`,
      `const marker=JSON.parse(fs.readFileSync('${PROVIDER_TOOL_MOUNT}/.codeux-provider-tool.json','utf8'))`,
      `if(marker.provider!==${JSON.stringify(provider)}||marker.version!==${JSON.stringify(version)})process.exit(2)`,
    ].join(";");
    const verify = await this.commands.run("docker", [
      "run", "--rm", "--network", "none",
      "--mount", `type=volume,source=${volumeName},target=${PROVIDER_TOOL_MOUNT},readonly`,
      image, "bash", "-lc",
      `node -e ${this.shellQuote(verifyScript)} && ${PROVIDER_TOOL_MOUNT}/bin/${spec.binary} --version >/dev/null`,
    ]);
    if (verify.ok) {
      this.verifiedInProcess.add(volumeName);
      this.failedVerificationsInProcess.delete(verificationKey);
    } else {
      this.failedVerificationsInProcess.add(verificationKey);
    }
    return verify.ok;
  }

  private forgetVolumeVerification(volumeName: string): void {
    this.verifiedInProcess.delete(volumeName);
    const prefix = `${volumeName}\0`;
    for (const key of this.failedVerificationsInProcess) {
      if (key.startsWith(prefix)) this.failedVerificationsInProcess.delete(key);
    }
  }

  private preparedTool(provider: ProviderToolId, volumeName: string, version: string): PreparedProviderTool {
    return {
      provider,
      volumeName,
      version,
      binary: PROVIDER_SPECS[provider].binary,
      mountPath: PROVIDER_TOOL_MOUNT,
    };
  }

  private findActive(provider: ProviderToolId, compatibilityKey: string): PreparedProviderTool | null {
    return this.active.get(`${provider}:${compatibilityKey}`) ?? null;
  }

  private async loadState(): Promise<void> {
    if (!this.stateLoadPromise) {
      this.stateLoadPromise = (async () => {
        try {
          const parsed = JSON.parse(await fs.readFile(this.statePath, "utf8")) as Record<string, PreparedProviderTool>;
          for (const [key, tool] of Object.entries(parsed)) {
            if (!tool || !isProviderToolId(tool.provider) || typeof tool.volumeName !== "string" || typeof tool.version !== "string") continue;
            this.active.set(key, tool);
            this.updateStatus(tool.provider, {
              state: "ready",
              installedVersion: tool.version,
              targetVersion: tool.version,
              progressPercent: 100,
              stepText: `${tool.provider} ${tool.version} is ready.`,
              error: null,
            });
          }
        } catch {
          // First successful preparation creates the state file.
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
    const lockRoot = path.join(path.dirname(this.statePath), "provider-tool-locks");
    await fs.mkdir(lockRoot, { recursive: true });
    const lockName = createHash("sha256").update(key).digest("hex");
    const lockPath = path.join(lockRoot, `${lockName}.lock`);
    const deadline = Date.now() + 15 * 60_000;
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
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST") throw error;
        const stat = await fs.stat(lockPath).catch(() => null);
        if (stat && Date.now() - stat.mtimeMs > 15 * 60_000) {
          await fs.rm(lockPath, { force: true }).catch(() => undefined);
          continue;
        }
        if (Date.now() >= deadline) {
          throw new Error("Timed out waiting for another Code UX process to prepare the provider CLI.");
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }

  private buildVolumeName(provider: ProviderToolId, version: string, integrity: string, compatibilityKey: string): string {
    const versionPart = this.labelValue(version).slice(0, 32);
    const digest = createHash("sha256").update(`${integrity}\0${compatibilityKey}`).digest("hex").slice(0, 16);
    return `code-ux-provider-tool-${provider}-${versionPart}-${digest}`.slice(0, 120);
  }

  private labelValue(value: string): string {
    return value.replace(/[^a-zA-Z0-9_.-]+/g, "-");
  }

  private shellQuote(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`;
  }

  private updateStatus(provider: ProviderToolId, update: Partial<ProviderToolStatus>): void {
    this.statuses.set(provider, {
      ...this.statuses.get(provider)!,
      ...update,
      updatedAt: new Date().toISOString(),
    });
  }
}

export const providerToolManager = new ProviderToolManager();

export const getActiveProviderTypes = (settings: { defaults: { aiProvider: { providers: Record<string, { provider: ProviderId; enabled: boolean }> } } }): ProviderId[] => (
  Array.from(new Set(
    Object.values(settings.defaults.aiProvider.providers)
      .filter((provider) => provider.enabled)
      .map((provider) => provider.provider),
  ))
);
