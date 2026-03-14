import { describe, expect, it } from "vitest";
import { sanitizeCliWorkflow } from "../../../../../src/domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";

describe("sanitizeCliWorkflow", () => {
  it("applies fallback execution mode", () => {
    const result = sanitizeCliWorkflow({ cliWorkflow: { executionMode: "INVALID_MODE" as any } });
    expect(result.executionMode).toBe("HOST"); // Default mode
  });

  it("keeps provider credential mounts independent", () => {
    const result = sanitizeCliWorkflow({
      cliWorkflow: {
        containerMountGithubAuth: false,
        containerMountGeminiAuth: true,
        containerMountCodexAuth: false,
        containerMountClaudeCodeAuth: true,
      },
    });

    expect(result.containerMountGitConfig).toBe(true);
    expect(result.containerMountGithubAuth).toBe(false);
    expect(result.containerMountGeminiAuth).toBe(true);
    expect(result.containerMountCodexAuth).toBe(false);
    expect(result.containerMountClaudeCodeAuth).toBe(true);
  });
});
