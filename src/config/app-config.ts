import * as fs from "fs";
import * as path from "path";
import os from "os";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readPort, readString } from "../shared/config/value-readers.js";
import { getRelativeCodeUxPath } from "../shared/config/code-ux-paths.js";

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  dashboardPort: number;
  apiKeyArg: string | null;
  runtimeRole: "project_manager";
  dashboardEnabled: boolean;
  mcpHttpEnabled: boolean;
  mcpHttpHost: string;
  mcpHttpPort: number | null;
  mcpHttpPath: string;
  mcpHttpAuthToken: string | null;
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

const hasFlag = (argv: string[], flagName: string): boolean => {
  const args = argv.slice(2);
  return args.includes(flagName);
};

const parseBooleanEnv = (value: string | undefined): boolean | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return null;
};

const normalizePathValue = (value: string | null | undefined, fallback: string): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

const isLoopbackHost = (host: string): boolean => {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1";
};

export const parseRuntimeRoleArg = (argv: string[]): AppConfig["runtimeRole"] => {
  void argv;
  return "project_manager";
};

export const hasHeadlessArg = (argv: string[]): boolean => {
  const args = argv.slice(2);
  return args.includes("--headless") || args.includes("--no-dashboard");
};

/**
 * Resolves the API key from environment variables or settings files.
 * Precedence: Env > .code-ux/settings.json
 */
export const apiKeyLoader = (projectRoot: string): string | null => {
  // 1. Environment variables
  const envKey = process.env.JULES_API_KEY || process.env.JULES_KEY;
  if (envKey) return envKey.trim();

  // 2. Settings files
  const settingsRelativePath = getRelativeCodeUxPath("settings.json");
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

const mcpHttpPortLoader = (argv: string[], projectRoot: string, dashboardPort: number): number | null => {
  const cliPort = readPort(parseStringFlag(argv, "--mcp-https-port") ?? parseStringFlag(argv, "--mcp-http-port"), -1);
  if (cliPort !== -1) {
    return cliPort;
  }

  const envPort = readPort(process.env.MCP_HTTPS_PORT ?? process.env.MCP_HTTP_PORT, -1);
  if (envPort !== -1) {
    return envPort;
  }

  const searchPaths = buildCandidatePaths("config.json", projectRoot).filter(
    (p) => !p.startsWith(path.resolve(os.homedir()))
  );

  for (const configPath of searchPaths) {
    try {
      if (!fs.existsSync(configPath)) continue;
      const raw = fs.readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const candidates: unknown[] = [
        parsed.mcpHttpsPort,
        parsed.MCP_HTTPS_PORT,
        (parsed.mcpHttps as Record<string, unknown> | undefined)?.port,
        parsed.mcpHttpPort,
        parsed.MCP_HTTP_PORT,
        (parsed.mcpHttp as Record<string, unknown> | undefined)?.port,
      ];
      for (const candidate of candidates) {
        const port = readPort(candidate, -1);
        if (port !== -1) return port;
      }
    } catch {
      // Ignore invalid config file while loading startup config.
    }
  }

  const explicitDisable = hasFlag(argv, "--no-mcp") ||
    hasFlag(argv, "--no-mcp-https") ||
    hasFlag(argv, "--no-mcp-http") ||
    parseBooleanEnv(process.env.MCP_HTTPS_ENABLED) === false ||
    parseBooleanEnv(process.env.MCP_HTTP_ENABLED) === false;

  return explicitDisable ? null : dashboardPort + 1;
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
  const dashboardEnabled = !hasHeadlessArg(argv);
  const mcpHttpHost = (parseStringFlag(argv, "--mcp-https-host")?.trim()
    || parseStringFlag(argv, "--mcp-http-host")?.trim()
    || process.env.MCP_HTTPS_HOST?.trim()
    || process.env.MCP_HTTP_HOST?.trim()
    || "127.0.0.1");
  const mcpHttpPort = mcpHttpPortLoader(argv, projectRoot, dashboardPort);
  const mcpHttpEnabled = mcpHttpPort !== null && mcpHttpPort > 0;
  const mcpHttpPath = normalizePathValue(
    parseStringFlag(argv, "--mcp-https-path")?.trim()
    || parseStringFlag(argv, "--mcp-http-path")?.trim()
    || process.env.MCP_HTTPS_PATH?.trim()
    || process.env.MCP_HTTP_PATH?.trim(),
    "/mcp",
  );
  const mcpHttpAuthToken = parseStringFlag(argv, "--mcp-https-auth-token")?.trim()
    || parseStringFlag(argv, "--mcp-http-auth-token")?.trim()
    || process.env.MCP_HTTPS_AUTH_TOKEN?.trim()
    || process.env.MCP_HTTP_AUTH_TOKEN?.trim()
    || null;

  if (mcpHttpEnabled && !isLoopbackHost(mcpHttpHost) && !mcpHttpAuthToken) {
    throw new Error("MCP HTTPS auth token is required when binding the MCP HTTPS server to a non-loopback host.");
  }

  return {
    apiKey,
    baseUrl,
    dashboardPort,
    apiKeyArg,
    runtimeRole,
    dashboardEnabled,
    mcpHttpEnabled,
    mcpHttpHost,
    mcpHttpPort,
    mcpHttpPath,
    mcpHttpAuthToken,
  };
};
