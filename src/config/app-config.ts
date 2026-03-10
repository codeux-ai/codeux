import * as fs from "fs";
import * as path from "path";
import os from "os";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readPort, readString } from "../shared/config/value-readers.js";
import { getRelativeSprintOsPath } from "../shared/config/sprint-os-paths.js";

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  dashboardPort: number;
  apiKeyArg: string | null;
  runtimeRole: "project_manager" | "worker_host";
  dashboardEnabled: boolean;
}

/**
 * Extracts the API key from CLI arguments.
 * Supports --api-key=VALUE and --api-key VALUE.
 */
export const parseApiKeyArg = (argv: string[]): string | null => {
  const args = argv.slice(2);
  const inlineArg = args.find((arg) => arg.startsWith("--api-key="));
  if (inlineArg) {
    return inlineArg.split("=")[1] || null;
  }

  const argIndex = args.indexOf("--api-key");
  if (argIndex !== -1 && args[argIndex + 1] && !args[argIndex + 1].startsWith("-")) {
    return args[argIndex + 1];
  }

  return null;
};

const parseStringFlag = (argv: string[], flagName: string): string | null => {
  const args = argv.slice(2);
  const inlineArg = args.find((arg) => arg.startsWith(`${flagName}=`));
  if (inlineArg) {
    return inlineArg.slice(flagName.length + 1) || null;
  }

  const argIndex = args.indexOf(flagName);
  if (argIndex !== -1 && args[argIndex + 1] && !args[argIndex + 1].startsWith("-")) {
    return args[argIndex + 1];
  }

  return null;
};

export const parseRuntimeRoleArg = (argv: string[]): AppConfig["runtimeRole"] => {
  const runtimeRole = parseStringFlag(argv, "--runtime-role")?.trim().toLowerCase();
  return runtimeRole === "worker-host" || runtimeRole === "worker_host"
    ? "worker_host"
    : "project_manager";
};

export const hasHeadlessArg = (argv: string[]): boolean => {
  const args = argv.slice(2);
  return args.includes("--headless") || args.includes("--no-dashboard");
};

/**
 * Resolves the API key from environment variables or settings files.
 * Precedence: Env > .sprint-os/settings.json
 */
export const apiKeyLoader = (projectRoot: string): string | null => {
  // 1. Environment variables
  const envKey = process.env.JULES_API_KEY || process.env.JULES_KEY;
  if (envKey) return envKey.trim();

  // 2. Settings files
  const settingsRelativePath = getRelativeSprintOsPath("settings.json");
  const searchPaths = buildCandidatePaths(settingsRelativePath, projectRoot);

  for (const settingsPath of searchPaths) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      const key = parsed?.julesApiKey || parsed?.JULES_API_KEY || parsed?.julesKey || parsed?.JULES_KEY;
      const resolved = readString(key, "");
      if (resolved.trim().length > 0) {
        return resolved.trim();
      }
    } catch {
      // Ignore invalid settings file while loading startup config.
    }
  }

  return null;
};

/**
 * Resolves the dashboard port from environment variables or config files.
 * Precedence: Env > config.json > Default (4444)
 */
export const dashboardPortLoader = (projectRoot: string): number => {
  // 1. Environment variable
  const envPort = readPort(process.env.DASHBOARD_PORT, -1);
  if (envPort !== -1) return envPort;

  // 2. Config files (excluding home directory per original logic)
  const homedir = os.homedir();
  const searchPaths = buildCandidatePaths("config.json", projectRoot).filter(
    (p) => !p.startsWith(path.resolve(homedir))
  );

  for (const configPath of searchPaths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidates: unknown[] = [
        parsed.dashboardPort,
        parsed.DASHBOARD_PORT,
        (parsed.dashboard as Record<string, unknown> | undefined)?.port,
        (parsed.dashboard as Record<string, unknown> | undefined)?.dashboardPort,
      ];
      for (const candidate of candidates) {
        const port = readPort(candidate, -1);
        if (port !== -1) return port;
      }
    } catch {
      // Ignore invalid config file while loading startup config.
    }
  }

  return 4444;
};

/**
 * Loads the complete application configuration.
 */
export const loadAppConfig = (argv: string[], projectRoot: string): AppConfig => {
  const apiKeyArg = parseApiKeyArg(argv);
  const apiKey = apiKeyArg || apiKeyLoader(projectRoot);
  const baseUrl = process.env.JULES_API_BASE_URL || "https://jules.googleapis.com/v1alpha";
  const dashboardPort = dashboardPortLoader(projectRoot);
  const runtimeRole = parseRuntimeRoleArg(argv);
  const dashboardEnabled = runtimeRole === "worker_host" ? false : !hasHeadlessArg(argv);

  return {
    apiKey,
    baseUrl,
    dashboardPort,
    apiKeyArg,
    runtimeRole,
    dashboardEnabled,
  };
};
