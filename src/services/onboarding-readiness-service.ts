import * as fs from "fs/promises";
import * as path from "path";
import type {
  OnboardingDependencyCheck,
  OnboardingProviderCredentialStatus,
  OnboardingRuntimeReadiness,
  ProviderId,
} from "../contracts/app-types.js";
import type { SystemSettings } from "../contracts/settings-scope-types.js";
import { commandRunner } from "../shared/subprocess/command-runner.js";
import { expandHomePath } from "../shared/config/home-path.js";

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

const defaultProviderAuthPaths: Record<ProviderId, string> = {
  jules: "",
  gemini: "~/.gemini",
  codex: "~/.codex",
  "claude-code": "~/.claude",
  "qwen-code": "~/.qwen",
  opencode: "~/.local/share/opencode",
  antigravity: "~/.antigravity",
};

const cliMountFields: Partial<Record<ProviderId, keyof SystemSettings["defaults"]["cliWorkflow"]>> = {
  gemini: "containerMountGeminiAuth",
  codex: "containerMountCodexAuth",
  "claude-code": "containerMountClaudeCodeAuth",
  "qwen-code": "containerMountQwenCodeAuth",
  opencode: "containerMountOpenCodeAuth",
  antigravity: "containerMountAntigravityAuth",
};

const relevantProviderFiles: Record<ProviderId, string[]> = {
  jules: [],
  gemini: ["settings.json", "oauth_creds.json"],
  codex: ["config.toml", "auth.json"],
  "claude-code": ["settings.json", "credentials.json", ".credentials.json"],
  "qwen-code": ["settings.json", "auth.json", "oauth_creds.json"],
  opencode: ["auth.json", "config.json", "opencode.json"],
  antigravity: ["settings.json"],
};

const runCheck = async (id: string, label: string, command: string, args: string[], required: boolean, resolution: string): Promise<OnboardingDependencyCheck> => {
  const result = await commandRunner.run(command, args, {
    cwd: process.cwd(),
    timeout: 4_000,
    maxStderrChars: 1_000,
  });
  if (result.ok) {
    return {
      id,
      label,
      status: "ready",
      required,
      description: `${label} is available.`,
      resolution,
      detail: result.stdout || result.stderr,
    };
  }

  return {
    id,
    label,
    status: required ? "missing" : "warning",
    required,
    description: `${label} is not available to the dashboard runtime.`,
    resolution,
    detail: result.stderr || result.stdout || `${command} exited with code ${result.code ?? "unknown"}`,
  };
};

const getExistingFiles = async (authPath: string, provider: ProviderId): Promise<string[]> => {
  const expanded = expandHomePath(authPath);
  const candidates = relevantProviderFiles[provider];
  const found: string[] = [];

  for (const candidate of candidates) {
    const fullPath = path.join(expanded, candidate);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isFile() || stat.isDirectory()) {
        found.push(candidate);
      }
    } catch {
      // Missing candidate files are expected for providers that have not been used locally.
    }
  }

  if (found.length > 0) {
    return found;
  }

  try {
    const entries = await fs.readdir(expanded);
    return entries
      .filter((entry) => !entry.startsWith(".DS_Store"))
      .slice(0, 4);
  } catch {
    return [];
  }
};

const getProviderCredentialStatuses = async (settings: SystemSettings): Promise<OnboardingProviderCredentialStatus[]> => {
  const providers: ProviderId[] = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
  return Promise.all(providers.map(async (provider) => {
    const instance = Object.values(settings.integrations.providers).find((candidate) => candidate.provider === provider);
    const authPath = instance?.authPath || defaultProviderAuthPaths[provider];
    const detectedFiles = await getExistingFiles(authPath, provider);
    const cliMountField = cliMountFields[provider];
    const cliMountEnabled = cliMountField ? Boolean(settings.defaults.cliWorkflow[cliMountField]) : false;

    return {
      provider,
      label: providerLabels[provider],
      authPath,
      available: detectedFiles.length > 0,
      mountEnabled: Boolean(instance?.mountAuth || cliMountEnabled),
      detectedFiles,
      description: detectedFiles.length > 0
        ? `${providerLabels[provider]} local auth was detected and can be copied into container workspaces.`
        : `${providerLabels[provider]} local auth was not detected at ${authPath}.`,
    };
  }));
};

let cachedReadiness: OnboardingRuntimeReadiness | null = null;
let lastCheckTime = 0;
const CACHE_TTL_MS = 6000;

export const getOnboardingRuntimeReadiness = async (settings: SystemSettings): Promise<OnboardingRuntimeReadiness> => {
  const now = Date.now();
  if (cachedReadiness && (now - lastCheckTime < CACHE_TTL_MS)) {
    return cachedReadiness;
  }

  const [dockerCli, gitCli, providerStatuses] = await Promise.all([
    runCheck(
      "docker-cli",
      "Docker CLI",
      "docker",
      ["--version"],
      true,
      "Install Docker Desktop or Docker Engine, then make sure the `docker` command is available on PATH.",
    ),
    runCheck(
      "git-cli",
      "Git CLI",
      "git",
      ["--version"],
      true,
      "Install Git and make sure the `git` command is available on PATH.",
    ),
    getProviderCredentialStatuses(settings),
  ]);

  let dockerDaemon: OnboardingDependencyCheck;
  if (dockerCli.status === "ready") {
    dockerDaemon = await runCheck(
      "docker-daemon",
      "Docker daemon",
      "docker",
      ["info", "--format", "{{json .ServerVersion}}"],
      true,
      "Start Docker Desktop or the Docker Engine service, then retry once `docker ps` succeeds.",
    );
  } else {
    dockerDaemon = {
      id: "docker-daemon",
      label: "Docker daemon",
      status: "missing",
      required: true,
      description: "Docker daemon is not available because Docker CLI is missing.",
      resolution: "Start Docker Desktop or the Docker Engine service, then retry once `docker ps` succeeds.",
      detail: "Docker CLI is missing or failed check. Skipping daemon connection test.",
    };
  }

  const dependencies = [dockerCli, dockerDaemon, gitCli];
  const requiredMissing = dependencies.some((dependency) => dependency.required && dependency.status === "missing");

  cachedReadiness = {
    checkedAt: new Date().toISOString(),
    cluster: {
      status: requiredMissing ? "not_ready" : "ready",
      label: requiredMissing ? "Cluster not ready" : "Cluster ready",
      detail: requiredMissing
        ? "Docker must be installed and running before containerized provider CLIs can execute tasks."
        : "Required local runtime dependencies are available.",
    },
    dependencies,
    providers: providerStatuses,
  };
  lastCheckTime = Date.now();

  return cachedReadiness;
};
