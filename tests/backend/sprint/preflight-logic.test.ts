import { describe, it, expect, vi } from "vitest";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { buildMockSettings } from "../../builders/settings-builder.js";

const buildDeps = () => {
  const deps = {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => buildMockSettings(),
    renderInstruction: vi.fn().mockResolvedValue(""),
    isJulesApiConfigured: () => true,
    loadSubtasks: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    updateLastStatus: vi.fn(),
    completedSprints: new Set<number>(),
  };
  return deps;
};

describe("SprintOrchestrator - Preflight Logic", () => {
  it("returns setup guidance when all providers are disabled", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      aiProvider: {
        provider: "jules",
        strategy: "MANUAL",
        providers: {
          jules: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          gemini: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          codex: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          "claude-code": { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
        },
        julesApiKey: "",
      },
    });
    
    deps.renderInstruction = vi.fn(async (templateId: string) => {
        if (templateId === "providerSetupRequired") return "Provider Setup Required\nNo AI providers are enabled";
        return "";
    });

    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("Provider Setup Required");
    expect(result.content[0].text).toContain("No AI providers are enabled");
  });

  it("returns branch configuration blocker for plan when feature branch is missing", async () => {
    const deps = buildDeps();
    deps.renderInstruction = vi.fn(async (templateId: string, vars: any) => {
        if (templateId === "branchMissing") return `Branch Configuration Missing: ${vars.feature_branch}`;
        return "";
    });
    
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/definitely/missing-repo",
      source_id: "sources/123",
      action: "plan",
      wait: false,
    });

    expect(result.content[0].text).toContain("Branch Configuration Missing");
    expect(result.content[0].text).toContain("feature/sprint1-implementation");
  });
});
