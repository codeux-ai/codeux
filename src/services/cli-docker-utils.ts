import os from "os";
import * as path from "path";
import type { CommandResult } from "./cli-process-runner.js";

export interface ContainerMount {
  source: string;
  destination: string;
  readonly: boolean;
  type?: "bind" | "volume";
}

export const resolveConfiguredPath = (repoPath: string, rawValue: string): string => {
  const value = rawValue.trim();
  if (!value) {
    return "";
  }
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }
  if (path.isAbsolute(value)) {
    return value;
  }
  return path.resolve(repoPath, value);
};

export const getDockerUserSpec = (): string | undefined => {
  const getUid = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  const getGid = (process as NodeJS.Process & { getgid?: () => number }).getgid;
  if (!getUid || !getGid) {
    return undefined;
  }
  return `${getUid()}:${getGid()}`;
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
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ]);
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

export const getProviderFallbackInstallCommand = (providerCommand: string): string | undefined => {
  switch (providerCommand) {
    case "gemini":
      return "npm install -g @google/gemini-cli";
    case "codex":
      return "npm install -g @openai/codex";
    case "claude":
      return "if command -v curl >/dev/null 2>&1; then curl -fsSL https://claude.ai/install.sh | bash && export PATH=\"$HOME/.local/bin:$PATH\"; else echo \"provider-runner: curl not found; cannot install claude\" >&2; fi";
    default:
      return undefined;
  }
};
