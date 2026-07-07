import { describe, expect, it } from "vitest";
import { sanitizeCliWorkflow } from "../../../../../src/domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

describe("sanitizeCliWorkflow", () => {
  it("applies fallback execution mode", () => {
    const result = sanitizeCliWorkflow({ cliWorkflow: { executionMode: "INVALID_MODE" as any } });
    expect(result.executionMode).toBe("DOCKER");
  });

  it("defaults git mode to remote and rejects invalid values", () => {
    const defaults = sanitizeCliWorkflow(undefined);
    expect(defaults.gitMode).toBe("remote");

    const invalid = sanitizeCliWorkflow({ cliWorkflow: { gitMode: "invalid" as any } });
    expect(invalid.gitMode).toBe("remote");

    const local = sanitizeCliWorkflow({ cliWorkflow: { gitMode: "local" as any } });
    expect(local.gitMode).toBe("local");
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
    expect(result.containerMountGitConfig).toBe(false);
    expect(result.containerGitUserName).toBe("Code UX");
    expect(result.containerGitUserEmail).toBe("agents@codeux.ai");
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
    expect(defaults.containerMountGitConfig).toBe(false);
    expect(defaults.containerMemoryLimitMb).toBe(6144);
    expect(defaults.containerInstallPlaywrightBrowsers).toBe(true);
    expect(defaults.containerGitUserName).toBe("Code UX");
    expect(defaults.containerGitUserEmail).toBe("agents@codeux.ai");
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

  it("sanitizes the Docker provider container memory limit", () => {
    const disabled = sanitizeCliWorkflow({
      cliWorkflow: {
        containerMemoryLimitMb: 0,
      },
    });
    expect(disabled.containerMemoryLimitMb).toBe(0);

    const clamped = sanitizeCliWorkflow({
      cliWorkflow: {
        containerMemoryLimitMb: 300000,
      },
    });
    expect(clamped.containerMemoryLimitMb).toBe(262144);

    const invalid = sanitizeCliWorkflow({
      cliWorkflow: {
        containerMemoryLimitMb: "bad" as any,
      },
    });
    expect(invalid.containerMemoryLimitMb).toBe(6144);
  });

  it("sanitizes the Playwright browser install toggle", () => {
    const disabled = sanitizeCliWorkflow({
      cliWorkflow: {
        containerInstallPlaywrightBrowsers: false,
      },
    });
    expect(disabled.containerInstallPlaywrightBrowsers).toBe(false);

    const invalid = sanitizeCliWorkflow({
      cliWorkflow: {
        containerInstallPlaywrightBrowsers: "bad" as any,
      },
    });
    expect(invalid.containerInstallPlaywrightBrowsers).toBe(true);
  });

  it("keeps default container setup behavior enabled for dashboard settings", () => {
    expect(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerSetupScriptPath).toBe("");
    expect(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerCacheSetupScriptImage).toBe(true);
    expect(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerInstallPlaywrightBrowsers).toBe(true);

    const defaults = sanitizeCliWorkflow(undefined);
    expect(defaults.containerSetupScriptPath).toBe("");
    expect(defaults.containerCacheSetupScriptImage).toBe(true);
    expect(defaults.containerInstallPlaywrightBrowsers).toBe(true);
  });

  it("trims custom container setup script paths without requiring the file to exist", () => {
    const relativePath = sanitizeCliWorkflow({
      cliWorkflow: {
        containerSetupScriptPath: "  scripts/missing-container-setup.sh  ",
      },
    });
    expect(relativePath.containerSetupScriptPath).toBe("scripts/missing-container-setup.sh");

    const absolutePath = sanitizeCliWorkflow({
      cliWorkflow: {
        containerSetupScriptPath: "  /tmp/code-ux/missing-container-setup.sh  ",
      },
    });
    expect(absolutePath.containerSetupScriptPath).toBe("/tmp/code-ux/missing-container-setup.sh");
  });

  it("accepts an empty custom container setup script path", () => {
    const result = sanitizeCliWorkflow({
      cliWorkflow: {
        containerSetupScriptPath: "   ",
      },
    });

    expect(result.containerSetupScriptPath).toBe("");
  });
});
