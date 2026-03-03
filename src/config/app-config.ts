import * as fs from "fs";
import os from "os";
import * as path from "path";

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  dashboardPort: number;
  apiKeyArg: string | null;
}

export const parseApiKeyArg = (argv: string[]): string | null => {
  const args = argv.slice(2);
  const inlineArg = args.find((arg) => arg.startsWith("--api-key="));
  if (inlineArg) {
    return inlineArg.split("=")[1] || null;
  }

  const argIndex = args.indexOf("--api-key");
  if (argIndex !== -1 && args[argIndex + 1]) {
    return args[argIndex + 1];
  }

  return null;
};

const loadApiKeyFromSettings = (projectRoot: string): string | null => {
  const settingsRelativePath = path.join(".jules-subagents", "settings.json");
  const searchPaths = [
    path.join(process.cwd(), settingsRelativePath),
    path.join(projectRoot, settingsRelativePath),
    path.join(os.homedir(), settingsRelativePath),
  ];

  for (const settingsPath of [...new Set(searchPaths)]) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      const key = parsed?.julesApiKey || parsed?.JULES_API_KEY || parsed?.julesKey || parsed?.JULES_KEY;
      if (typeof key === "string" && key.trim().length > 0) {
        return key.trim();
      }
    } catch {
      // Ignore invalid settings file while loading startup config.
    }
  }

  return null;
};

const readPortValue = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  if (rounded < 1 || rounded > 65535) return null;
  return rounded;
};

const loadDashboardPortFromConfigJson = (projectRoot: string): number | null => {
  const searchPaths = [
    path.join(process.cwd(), "config.json"),
    path.join(projectRoot, "config.json"),
  ];

  for (const configPath of [...new Set(searchPaths)]) {
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
        const port = readPortValue(candidate);
        if (port !== null) return port;
      }
    } catch {
      // Ignore invalid config file while loading startup config.
    }
  }

  return null;
};

export const loadAppConfig = (argv: string[], projectRoot: string): AppConfig => {
  const apiKeyArg = parseApiKeyArg(argv);
  const apiKey = apiKeyArg || process.env.JULES_API_KEY || process.env.JULES_KEY || loadApiKeyFromSettings(projectRoot);
  const baseUrl = process.env.JULES_API_BASE_URL || "https://jules.googleapis.com/v1alpha";
  const dashboardPort = readPortValue(process.env.DASHBOARD_PORT) || loadDashboardPortFromConfigJson(projectRoot) || 4444;

  return {
    apiKey,
    baseUrl,
    dashboardPort,
    apiKeyArg,
  };
};
