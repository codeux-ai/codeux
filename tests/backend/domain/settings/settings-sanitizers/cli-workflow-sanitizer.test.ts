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
        containerCacheSetupScriptImage: true,
        containerMountGithubAuth: false,
        containerMountGeminiAuth: true,
        containerMountCodexAuth: false,
        containerMountClaudeCodeAuth: true,
      },
    });

    expect(result.containerCacheSetupScriptImage).toBe(true);
    expect(result.containerMountGitConfig).toBe(true);
    expect(result.containerMountGithubAuth).toBe(false);
    expect(result.containerMountGeminiAuth).toBe(true);
    expect(result.containerMountCodexAuth).toBe(false);
    expect(result.containerMountClaudeCodeAuth).toBe(true);
  });

  it("defaults quota-reset and rate-limit retries and clamps rate-limit delay", () => {
    const defaults = sanitizeCliWorkflow(undefined);
    expect(defaults.retryOnQuotaReset).toBe(true);
    expect(defaults.retryOnRateLimit).toBe(true);
    expect(defaults.rateLimitRetryDelaySeconds).toBe(10);
    expect(defaults.maxRateLimitRetries).toBe(5);
    expect(defaults.containerMountGithubAuth).toBe(false);
    expect(defaults.containerMountGeminiAuth).toBe(false);
    expect(defaults.containerMountCodexAuth).toBe(false);
    expect(defaults.containerMountClaudeCodeAuth).toBe(false);

    const clamped = sanitizeCliWorkflow({
      cliWorkflow: {
        rateLimitRetryDelaySeconds: 0,
        maxRateLimitRetries: 0,
      },
    });
    expect(clamped.rateLimitRetryDelaySeconds).toBe(1);
    expect(clamped.maxRateLimitRetries).toBe(1);
  });
});
