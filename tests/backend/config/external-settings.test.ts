import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import type { PathLike } from "fs";
import * as path from "path";
import { loadExternalSettingsHints } from "../../../src/config/external-settings.js";

vi.mock("os");
vi.mock("fs");

describe("external-settings", () => {
  const MOCK_PROJECT_ROOT = "/mock/project";
  const MOCK_HOME = "/mock/home";
  const MOCK_CWD = "/mock/cwd";
  const normalizeSeparators = (value: PathLike): string => String(value).replace(/\\/g, "/");

  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue(MOCK_CWD);
    vi.spyOn(os, "homedir").mockReturnValue(MOCK_HOME);
    process.env.JULES_API_KEY = "";
    process.env.JULES_KEY = "";
    process.env.GEMINI_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    process.env.ANTHROPIC_API_KEY = "";
    process.env.CLAUDE_API_KEY = "";
    process.env.DASHSCOPE_API_KEY = "";
    process.env.BAILIAN_CODING_PLAN_API_KEY = "";
    process.env.QWEN_API_KEY = "";
    process.env.OPENCODE_API_KEY = "";
    process.env.GH_TOKEN = "";
    process.env.GITHUB_TOKEN = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should load settings from JSON file if env is missing", () => {
    const mockSettings = {
      julesApiKey: "json-jules-key",
      geminiApiKey: "json-gemini-key",
    };

    vi.spyOn(fs, "existsSync").mockImplementation((p: PathLike) => {
        return normalizeSeparators(p).includes(".code-ux/settings.json");
    });
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(mockSettings));

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.resolved.julesApiKey).toBe("json-jules-key");
    expect(hints.resolved.geminiApiKey).toBe("json-gemini-key");
  });

  it("should prioritize env over JSON file", () => {
    process.env.JULES_API_KEY = "env-jules-key";
    const mockSettings = {
      julesApiKey: "json-jules-key",
    };

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(mockSettings));

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.resolved.julesApiKey).toBe("env-jules-key");
  });

  it("should resolve multiple aliases for various providers", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    // Testing Jules aliases
    process.env.JULES_KEY = "jules-key-alt";
    
    // Testing Claude aliases
    process.env.ANTHROPIC_API_KEY = "anthropic-key";

    // Testing GitHub aliases
    process.env.GH_TOKEN = "gh-token";
    process.env.DASHSCOPE_API_KEY = "dashscope-key";

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.resolved.julesApiKey).toBe("jules-key-alt");
    expect(hints.resolved.claudeCodeApiKey).toBe("anthropic-key");
    expect(hints.resolved.openCodeApiKey).toBe("anthropic-key");
    expect(hints.resolved.qwenCodeApiKey).toBe("dashscope-key");
    expect(hints.resolved.githubToken).toBe("gh-token");
  });

  it("should resolve from JSON with different naming conventions", () => {
    const mockSettings = {
      JULES_API_KEY: "json-jules-caps",
      CLAUDE_API_KEY: "json-claude-caps",
      GITHUB_TOKEN: "json-github-caps"
    };

    vi.spyOn(fs, "existsSync").mockImplementation((p: PathLike) => {
        return normalizeSeparators(p).includes(".code-ux/settings.json");
    });
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(mockSettings));

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.resolved.julesApiKey).toBe("json-jules-caps");
    expect(hints.resolved.claudeCodeApiKey).toBe("json-claude-caps");
    expect(hints.resolved.githubToken).toBe("json-github-caps");
  });

  it("should report empty provider availability when no keys or local auth exist", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.providerAvailability.jules).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.gemini).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.codex).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.claudeCode).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.qwenCode).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.openCode).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
  });

  it("should correctly report hasApiKey when keys are available", () => {
    process.env.JULES_API_KEY = "env-jules-key";
    process.env.ANTHROPIC_API_KEY = "env-claude-key";
    process.env.BAILIAN_CODING_PLAN_API_KEY = "env-qwen-key";

    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.providerAvailability.jules).toEqual({ hasApiKey: true, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.gemini).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.codex).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.claudeCode).toEqual({ hasApiKey: true, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.qwenCode).toEqual({ hasApiKey: true, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.openCode).toEqual({ hasApiKey: true, hasLocalAuth: false, hasDashboardAuth: false });
  });

  it("should correctly report hasLocalAuth when auth files exist", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((p: string) => {
      // Mock true for a specific gemini path
      if (p.endsWith(path.join(".gemini", "settings.json"))) {
        return true;
      }
      if (p.endsWith(path.join(".qwen", "settings.json"))) {
        return true;
      }
      if (p.endsWith(path.join(".local", "share", "opencode", "auth.json"))) {
        return true;
      }
      return false;
    });

    const hints = loadExternalSettingsHints(MOCK_PROJECT_ROOT);

    expect(hints.providerAvailability.jules).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.gemini).toEqual({ hasApiKey: false, hasLocalAuth: true, hasDashboardAuth: false });
    expect(hints.providerAvailability.codex).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.claudeCode).toEqual({ hasApiKey: false, hasLocalAuth: false, hasDashboardAuth: false });
    expect(hints.providerAvailability.qwenCode).toEqual({ hasApiKey: false, hasLocalAuth: true, hasDashboardAuth: false });
    expect(hints.providerAvailability.openCode).toEqual({ hasApiKey: false, hasLocalAuth: true, hasDashboardAuth: false });
  });
});
