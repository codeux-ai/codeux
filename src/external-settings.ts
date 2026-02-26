import * as fs from "fs";
import os from "os";
import * as path from "path";
import type { ExternalSettingsHints } from "./types.js";

const getSearchPaths = (projectRoot: string): string[] => {
  const settingsRelativePath = path.join(".jules-subagents", "settings.json");
  const paths = [
    path.join(process.cwd(), settingsRelativePath),
    path.join(projectRoot, settingsRelativePath),
    path.join(os.homedir(), settingsRelativePath),
  ];
  return [...new Set(paths)];
};

const readSettingsJson = (projectRoot: string): Record<string, unknown> => {
  for (const settingsPath of getSearchPaths(projectRoot)) {
    try {
      if (!fs.existsSync(settingsPath)) continue;
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore invalid settings files
    }
  }
  return {};
};

const getString = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const loadExternalSettingsHints = (projectRoot: string): ExternalSettingsHints => {
  const parsedSettings = readSettingsJson(projectRoot);

  const envJules = getString(process.env.JULES_API_KEY || process.env.JULES_KEY);
  const envGemini = getString(process.env.GEMINI_API_KEY);
  const envCodex = getString(process.env.OPENAI_API_KEY);
  const envClaudeCode = getString(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY);
  const envGithub = getString(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);

  const jsonJules = getString(
    parsedSettings.julesApiKey ?? parsedSettings.JULES_API_KEY ?? parsedSettings.julesKey ?? parsedSettings.JULES_KEY
  );
  const jsonGemini = getString(parsedSettings.geminiApiKey ?? parsedSettings.GEMINI_API_KEY);
  const jsonCodex = getString(parsedSettings.codexApiKey ?? parsedSettings.OPENAI_API_KEY);
  const jsonClaudeCode = getString(
    parsedSettings.claudeCodeApiKey ?? parsedSettings.ANTHROPIC_API_KEY ?? parsedSettings.claudeApiKey ?? parsedSettings.CLAUDE_API_KEY
  );
  const jsonGithub = getString(parsedSettings.githubToken ?? parsedSettings.GITHUB_TOKEN ?? parsedSettings.GH_TOKEN);

  return {
    env: {
      julesApiKey: envJules,
      geminiApiKey: envGemini,
      codexApiKey: envCodex,
      claudeCodeApiKey: envClaudeCode,
      githubToken: envGithub,
    },
    settingsJson: {
      julesApiKey: jsonJules,
      geminiApiKey: jsonGemini,
      codexApiKey: jsonCodex,
      claudeCodeApiKey: jsonClaudeCode,
      githubToken: jsonGithub,
    },
    resolved: {
      julesApiKey: envJules || jsonJules,
      geminiApiKey: envGemini || jsonGemini,
      codexApiKey: envCodex || jsonCodex,
      claudeCodeApiKey: envClaudeCode || jsonClaudeCode,
      githubToken: envGithub || jsonGithub,
    },
  };
};
