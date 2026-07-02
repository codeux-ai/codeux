import { describe, expect, it } from "vitest";
import { resolveImportedTaskAgentPresetId } from "../../../src/app/lifecycle/dashboard-lifecycle-service.js";

describe("dashboard lifecycle imported task routing", () => {
  const settings = {
    agents: {
      routing: {
        taskCoding: {
          mode: "MANUAL",
          agentPresetId: "quality-agent",
          orchestratorAgentPresetIds: [],
        },
        ciFix: { agentPresetId: "ci-agent" },
        mergeConflict: { agentPresetId: "merge-agent" },
      },
    },
  } as const;

  it("prefers explicit imported task agent presets", () => {
    expect(resolveImportedTaskAgentPresetId(settings, {
      kind: "failed_ci",
      title: "Fix CI",
      agentPresetId: "explicit-agent",
    })).toBe("explicit-agent");
  });

  it("maps imported task kinds onto the expected routing presets", () => {
    expect(resolveImportedTaskAgentPresetId(settings, {
      kind: "security",
      title: "Security issue",
    })).toBe("quality-agent");
    expect(resolveImportedTaskAgentPresetId(settings, {
      kind: "quality",
      title: "Quality issue",
    })).toBe("quality-agent");
    expect(resolveImportedTaskAgentPresetId(settings, {
      kind: "merge_conflict",
      title: "Merge conflict",
    })).toBe("merge-agent");
    expect(resolveImportedTaskAgentPresetId(settings, {
      kind: "failed_ci",
      title: "Failed CI",
    })).toBe("ci-agent");
  });
});
