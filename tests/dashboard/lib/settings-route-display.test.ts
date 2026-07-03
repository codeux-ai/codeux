import { describe, expect, it } from "vitest";
import { resolveRouteDisplayProviderPool } from "../../../dashboard/src/v2/lib/settings/route-display.js";
import type { ProjectSettings } from "../../../dashboard/src/v2/types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const providers = DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers as ProjectSettings["aiProvider"]["providers"];

describe("settings route display helpers", () => {
  it("shows only the primary provider for manual routes even when a weighted pool is saved", () => {
    const route: ProjectSettings["aiProvider"]["invocationRouting"]["task_coding"] = {
      ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting.task_coding,
      strategy: "MANUAL",
      provider: "claude-code",
      allowedProviders: ["gemini", "codex", "claude-code", "qwen-code"],
    };

    expect(resolveRouteDisplayProviderPool(route, "claude-code", providers)).toEqual(["claude-code"]);
  });

  it("shows pinned providers for weighted routes", () => {
    const route: ProjectSettings["aiProvider"]["invocationRouting"]["task_coding"] = {
      ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting.task_coding,
      strategy: "WEIGHTED",
      provider: "claude-code",
      allowedProviders: ["gemini", "codex"],
    };

    expect(resolveRouteDisplayProviderPool(route, "claude-code", providers)).toEqual(["gemini", "codex"]);
  });
});

