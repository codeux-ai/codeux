import os from "os";
import * as path from "path";
import type { CommandResult } from "./cli-process-runner.js";
import { resolveUserPath } from "../shared/config/home-path.js";

export interface ContainerMount {
  source: string;
  destination: string;
  readonly: boolean;
  type?: "bind" | "volume";
}

export const resolveConfiguredPath = (repoPath: string, rawValue: string): string => {
  return resolveUserPath(repoPath, rawValue);
};

const FALLBACK_WORKER_UID = "1000:1000";

export const getDockerUserSpec = (): string => {
  const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
  if (!getUid || !getGid) {
    return FALLBACK_WORKER_UID;
  }
  const uid = getUid();
  if (uid === 0) {
    return FALLBACK_WORKER_UID;
  }
  return `${uid}:${getGid()}`;
};

export const toDockerMountArg = (mount: ContainerMount): string => {
  const parts = [
    `type=${mount.type ?? "bind"}`,
    `source=${mount.source}`,
    `target=${mount.destination}`,
  ];
  if (mount.readonly) {
    parts.push("readonly");
  }
  return parts.join(",");
};

export const pickContainerEnv = (env: NodeJS.ProcessEnv): Array<{ key: string; value: string }> => {
  const allowed = new Set<string>([
    "GEMINI_MODEL",
    "GEMINI_API_KEY",
    "GEMINI_CLI_TRUST_WORKSPACE",
    "CODEX_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "OPENAI_PROJECT_ID",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "ANTHROPIC_SMALL_FAST_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "DASHSCOPE_API_KEY",
    "BAILIAN_CODING_PLAN_API_KEY",
    "QWEN_API_KEY",
    "OPENCODE_API_KEY",
    "OPENCODE_CONFIG_CONTENT",
    "ANTIGRAVITY_API_KEY",
    "ANTIGRAVITY_MODEL",
    "AGY_MODEL",
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ]);
  for (const key of (env.CODE_UX_PROVIDER_ENV_KEYS || "").split(",")) {
    const normalized = key.trim();
    if (normalized) {
      allowed.add(normalized);
    }
  }
  const result: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(env)) {
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0) {
      continue;
    }
    result.push({ key, value });
  }
  return result;
};

const isPathWithin = (basePath: string, targetPath: string): boolean => {
  const base = path.resolve(basePath);
  const target = path.resolve(targetPath);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

export const mapPathPrefix = (sourcePath: string, fromPrefix: string, toPrefix: string): string => {
  const source = path.resolve(sourcePath);
  const from = path.resolve(fromPrefix);
  const to = path.resolve(toPrefix);
  if (!isPathWithin(from, source)) {
    return source;
  }
  const relative = path.relative(from, source);
  return relative.length === 0 ? to : path.join(to, relative);
};

export const isDockerWorkspaceMountError = (result: CommandResult): boolean => {
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const bindSourceMissing = combined.includes('invalid mount config for type "bind"')
    && combined.includes("bind source path does not exist");
  const mountPermission = combined.includes("mounts denied")
    || (combined.includes("permission denied") && combined.includes("mount"));
  return bindSourceMissing || mountPermission;
};

/**
 * Shell definition of the `ensure_curl` helper used by the provider fallback
 * install commands. curl is installed lazily (via apt-get) only when missing.
 *
 * The provider-runner bootstrap script defines this helper inline, but any
 * other context that inlines a `getProviderFallbackInstallCommand` result
 * (e.g. the interactive login container) must prepend this definition so the
 * `if ensure_curl; then ...` branch resolves to a real function instead of an
 * "ensure_curl: command not found" failure.
 */
export const ENSURE_CURL_SHELL_FUNCTION =
  "ensure_curl() { if command -v curl >/dev/null 2>&1; then return 0; fi; echo \"provider-runner: curl not found; installing...\" >&2; if command -v apt-get >/dev/null 2>&1; then (apt-get update -qy && apt-get install -qy curl ca-certificates) >/dev/null 2>&1 || true; fi; command -v curl >/dev/null 2>&1; }";

export const getProviderFallbackInstallCommand = (providerCommand: string): string | undefined => {
  switch (providerCommand) {
    case "gemini":
      return "npm install -g @google/gemini-cli";
    case "codex":
      return "npm install -g @openai/codex";
    case "claude":
      return "if ensure_curl; then curl -fsSL https://claude.ai/install.sh | bash && export PATH=\"$HOME/.local/bin:$PATH\"; else echo \"provider-runner: curl unavailable; cannot install claude\" >&2; fi";
    case "qwen":
      return "npm install -g @qwen-code/qwen-code";
    case "opencode":
      return "if ensure_curl; then curl -fsSL https://opencode.ai/install | bash && export PATH=\"$HOME/.opencode/bin:$HOME/.local/bin:$PATH\"; else echo \"provider-runner: curl unavailable; cannot install opencode\" >&2; fi";
    case "agy":
      return 'if ensure_curl; then curl -fsSL https://antigravity.google/cli/install.sh | bash && export PATH="$HOME/.local/bin:$PATH"; else echo "provider-runner: curl unavailable; cannot install antigravity" >&2; fi';
    default:
      return undefined;
  }
};
