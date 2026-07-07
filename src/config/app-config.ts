import * as fs from "fs";
import * as path from "path";
import os from "os";
import { randomBytes } from "crypto";
import { buildCandidatePaths } from "../shared/config/search-paths.js";
import { readPort, readString } from "../shared/config/value-readers.js";
import { getHomeCodeUxPath, getRelativeCodeUxPath } from "../shared/config/code-ux-paths.js";

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  dashboardPort: number;
  apiKeyArg: string | null;
  runtimeRole: "project_manager";
  serverMode: boolean;
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

const shouldDefaultMcpHttpHostForDockerDesktop = (): boolean => (
  process.platform === "win32"
  || process.platform === "darwin"
  || os.release().toLowerCase().includes("microsoft")
);

const defaultMcpHttpHost = (): string => (
  shouldDefaultMcpHttpHostForDockerDesktop() ? "0.0.0.0" : "127.0.0.1"
);

const generateMcpHttpAuthToken = (): string => `cux_mcp_${randomBytes(32).toString("base64url")}`;

const getUserSecurityConfigPath = (): string => {
  const overrideDir = process.env.CODE_UX_HOME?.trim();
  return overrideDir
    ? path.join(overrideDir, "security.json")
    : getHomeCodeUxPath("security.json");
};

const readStoredMcpHttpAuthToken = (): string | null => {
  const securityConfigPath = getUserSecurityConfigPath();
  try {
    if (!fs.existsSync(securityConfigPath)) {
      return null;
    }
    const parsed = JSON.parse(fs.readFileSync(securityConfigPath, "utf-8")) as Record<string, unknown>;
    const token = readString(parsed.mcpHttpAuthToken ?? parsed.mcpHttpsAuthToken, "");
    return token.trim().length > 0 ? token.trim() : null;
  } catch {
    return null;
  }
};

const writeStoredMcpHttpAuthToken = (token: string): void => {
  const securityConfigPath = getUserSecurityConfigPath();
  const directory = path.dirname(securityConfigPath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

  let existing: Record<string, unknown> = {};
  try {
    if (fs.existsSync(securityConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(securityConfigPath, "utf-8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    }
  } catch {
    existing = {};
  }

  const next = {
    ...existing,
    mcpHttpAuthToken: token,
  };
  fs.writeFileSync(securityConfigPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(securityConfigPath, 0o600);
  } catch {
    // Some filesystems do not support chmod; the restrictive write mode is still applied where possible.
  }
};

export const loadOrCreateUserMcpHttpAuthToken = (): string => {
  const existing = readStoredMcpHttpAuthToken();
  if (existing) {
    return existing;
  }

  const token = generateMcpHttpAuthToken();
  writeStoredMcpHttpAuthToken(token);
  return token;
};

export const regenerateUserMcpHttpAuthToken = (): string => {
  const token = generateMcpHttpAuthToken();
  writeStoredMcpHttpAuthToken(token);
  return token;
};

export const parseRuntimeRoleArg = (argv: string[]): AppConfig["runtimeRole"] => {
  void argv;
  return "project_manager";
};

export const hasHeadlessArg = (argv: string[]): boolean => {
  const args = argv.slice(2);
  return args.includes("--headless") || args.includes("--no-dashboard");
};

export const hasServerModeArg = (argv: string[]): boolean => {
  const args = argv.slice(2);
  return args.includes("--server-mode");
};

const isServerModeEnabled = (argv: string[]): boolean => (
  hasServerModeArg(argv) || parseBooleanEnv(process.env.CODE_UX_SERVER_MODE) === true
);

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
  const serverMode = isServerModeEnabled(argv);
  const dashboardEnabled = serverMode ? false : !hasHeadlessArg(argv);
  const explicitMcpHttpHost = parseStringFlag(argv, "--mcp-https-host")?.trim()
    || parseStringFlag(argv, "--mcp-http-host")?.trim()
    || process.env.MCP_HTTPS_HOST?.trim()
    || process.env.MCP_HTTP_HOST?.trim()
    || "";
  const mcpHttpHost = explicitMcpHttpHost || defaultMcpHttpHost();
  const loadedMcpHttpPort = mcpHttpPortLoader(argv, projectRoot, dashboardPort);
  const mcpHttpPort = serverMode && loadedMcpHttpPort === null ? dashboardPort + 1 : loadedMcpHttpPort;
  const mcpHttpEnabled = mcpHttpPort !== null && mcpHttpPort > 0;
  const mcpHttpPath = normalizePathValue(
    parseStringFlag(argv, "--mcp-https-path")?.trim()
    || parseStringFlag(argv, "--mcp-http-path")?.trim()
    || process.env.MCP_HTTPS_PATH?.trim()
    || process.env.MCP_HTTP_PATH?.trim(),
    "/mcp",
  );
  const explicitMcpHttpAuthToken = parseStringFlag(argv, "--mcp-https-auth-token")?.trim()
    || parseStringFlag(argv, "--mcp-http-auth-token")?.trim()
    || process.env.MCP_HTTPS_AUTH_TOKEN?.trim()
    || process.env.MCP_HTTP_AUTH_TOKEN?.trim()
    || null;
  if (serverMode && !explicitMcpHttpAuthToken) {
    throw new Error("CODE_UX_SERVER_MODE requires a non-empty MCP HTTP auth token via MCP_HTTPS_AUTH_TOKEN, MCP_HTTP_AUTH_TOKEN, --mcp-https-auth-token, or --mcp-http-auth-token.");
  }

  const mcpHttpAuthToken = explicitMcpHttpAuthToken || (mcpHttpEnabled ? loadOrCreateUserMcpHttpAuthToken() : null);

  if (mcpHttpEnabled && !isLoopbackHost(mcpHttpHost) && !mcpHttpAuthToken) {
    throw new Error("MCP HTTP auth token is required when binding the MCP HTTP server to a non-loopback host.");
  }

  return {
    apiKey,
    baseUrl,
    dashboardPort,
    apiKeyArg,
    runtimeRole,
    serverMode,
    dashboardEnabled,
    mcpHttpEnabled,
    mcpHttpHost,
    mcpHttpPort,
    mcpHttpPath,
    mcpHttpAuthToken,
  };
};
