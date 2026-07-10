import { describe, it, expect } from "vitest";
import {
  applyOnboardingExperienceModeDefaults,
  buildProviderConfigId,
  getEasyRecommendedProvider,
  getProviderInitialSelection,
  getSystemProvidersByType,
  getFirstCliProviderConfigId,
  syncProjectProvidersToIntegrationCatalog
} from "../../../dashboard/src/v2/lib/onboarding-settings-draft.js";
import type {
  OnboardingProviderCredentialStatus,
  SystemSettings,
  ProjectSettings
} from "../../../dashboard/src/types.js";

describe("onboarding-settings-draft", () => {
  describe("buildProviderConfigId", () => {
    it("should generate a unique config id", () => {
      const id1 = buildProviderConfigId("jules");
      const id2 = buildProviderConfigId("jules");
      expect(id1).toMatch(/^jules-[a-z0-9]+-[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe("getProviderInitialSelection", () => {
    it("should return jules and enabled providers", () => {
      const providers: OnboardingProviderCredentialStatus[] = [];
      const settings = {
        defaults: {
          aiProvider: {
            providers: {
              "qwen-code": { provider: "qwen-code", enabled: true },
              "opencode": { provider: "opencode", enabled: false }
            }
          }
        }
      } as unknown as SystemSettings;

      const selection = getProviderInitialSelection(providers, settings);
      expect(selection).toEqual(["jules", "qwen-code"]);
    });

    it("should include detected available providers", () => {
      const providers: OnboardingProviderCredentialStatus[] = [
        { provider: "claude-code", available: true, mountEnabled: false, authPath: "", detectedFiles: [] }
      ];
      const settings = {
        defaults: {
          aiProvider: {
            providers: {}
          }
        }
      } as unknown as SystemSettings;

      const selection = getProviderInitialSelection(providers, settings);
      expect(selection).toEqual(["jules", "claude-code"]);
    });
  });

  describe("getSystemProvidersByType", () => {
    it("should filter integration providers by type", () => {
      const settings = {
        integrations: {
          providers: {
            "p1": { provider: "qwen-code", name: "Q1" },
            "p2": { provider: "claude-code", name: "C1" },
            "p3": { provider: "qwen-code", name: "Q2" }
          }
        }
      } as unknown as SystemSettings;

      const result = getSystemProvidersByType(settings, "qwen-code");
      expect(result).toHaveLength(2);
      expect(result[0][0]).toBe("p1");
      expect(result[1][0]).toBe("p3");
    });
  });

  describe("getEasyRecommendedProvider", () => {
    it("excludes deprecated Gemini from Easy recommendations", () => {
      const providers: OnboardingProviderCredentialStatus[] = [
        { provider: "gemini", available: true, mountEnabled: false, authPath: "~/.gemini", detectedFiles: [] },
        { provider: "codex", available: false, mountEnabled: false, authPath: "~/.codex", detectedFiles: [] }
      ];

      expect(getEasyRecommendedProvider(providers)).toBe("codex");
    });

    it("recommends detected Antigravity as the supported Google CLI", () => {
      const providers: OnboardingProviderCredentialStatus[] = [
        { provider: "gemini", available: true, mountEnabled: false, authPath: "~/.gemini", detectedFiles: [] },
        { provider: "antigravity", available: true, mountEnabled: false, authPath: "~/.antigravity", detectedFiles: [] },
      ];
      expect(getEasyRecommendedProvider(providers)).toBe("antigravity");
    });

    it("falls back to Codex for Easy mode", () => {
      expect(getEasyRecommendedProvider([])).toBe("codex");
    });
  });

  describe("getFirstCliProviderConfigId", () => {
    it("should return the first non-jules provider", () => {
      const providers = {
        "p1": { provider: "jules" },
        "p2": { provider: "qwen-code" }
      } as unknown as ProjectSettings["aiProvider"]["providers"];

      expect(getFirstCliProviderConfigId(providers)).toBe("p2");
    });

    it("should return null if none available", () => {
      const providers = {
        "p1": { provider: "jules" }
      } as unknown as ProjectSettings["aiProvider"]["providers"];

      expect(getFirstCliProviderConfigId(providers)).toBeNull();
    });
  });

  describe("syncProjectProvidersToIntegrationCatalog", () => {
    it("should sync project providers to integration catalog", () => {
      const settings = {
        defaults: {
          aiProvider: {
            provider: "old-default",
            providers: {
              "jules-1": { provider: "jules", enabled: true }
            },
            invocationRouting: {}
          },
          workers: {
            virtualWorkerProvider: "old-worker"
          }
        }
      } as unknown as SystemSettings;

      const nextIntegrationProviders = {
        "jules-1": { provider: "jules", name: "Jules 1" },
        "qwen-1": { provider: "qwen-code", name: "Qwen 1" }
      } as unknown as SystemSettings["integrations"]["providers"];

      const result = syncProjectProvidersToIntegrationCatalog(settings, nextIntegrationProviders);

      // Preserves existing provider
      expect(result.aiProvider.providers["jules-1"]).toBeDefined();
      expect(result.aiProvider.providers["jules-1"].provider).toBe("jules");

      // Creates default for new provider
      expect(result.aiProvider.providers["qwen-1"]).toBeDefined();
      expect(result.aiProvider.providers["qwen-1"].provider).toBe("qwen-code");

      // Resolves fallback global provider
      expect(result.aiProvider.provider).toBe("jules-1");

      // Resolves fallback worker provider
      expect(result.workers.virtualWorkerProvider).toBe("qwen-1");
    });

    it("should preserve defaults like jira, automation, and appearance when syncing", () => {
      const settings = {
        defaults: {
          aiProvider: {
            provider: null,
            providers: {
              "jules-1": { provider: "jules", enabled: true }
            },
            invocationRouting: {}
          },
          workers: {
            virtualWorkerProvider: "jules-1"
          },
          jira: { enabled: true, domain: "test.atlassian.net" },
          automation: { enableMainPrAutomerge: true },
          appearance: { theme: "dark" },
          cliWorkflow: { gitMode: "local" }
        }
      } as unknown as SystemSettings;

      const nextIntegrationProviders = {
        "jules-1": { provider: "jules", name: "Jules 1" }
      } as unknown as SystemSettings["integrations"]["providers"];

      const result = syncProjectProvidersToIntegrationCatalog(settings, nextIntegrationProviders);

      expect(result.jira).toEqual({ enabled: true, domain: "test.atlassian.net" });
      expect(result.automation).toEqual({ enableMainPrAutomerge: true });
      expect(result.appearance).toEqual({ theme: "dark" });
      expect(result.cliWorkflow).toEqual({ gitMode: "local" });
    });

    it("should remove provider configs that are no longer in integration catalog", () => {
      const settings = {
        defaults: {
          aiProvider: {
            provider: "jules-1",
            providers: {
              "jules-1": { provider: "jules", enabled: true },
              "qwen-1": { provider: "qwen-code", enabled: true }
            },
            invocationRouting: {
              "route-1": {
                provider: "qwen-1",
                allowedProviders: ["jules-1", "qwen-1"],
                providers: { "jules-1": {}, "qwen-1": {} }
              }
            }
          },
          workers: {
            virtualWorkerProvider: "qwen-1"
          }
        }
      } as unknown as SystemSettings;

      // qwen-1 is removed
      const nextIntegrationProviders = {
        "jules-1": { provider: "jules", name: "Jules 1" }
      } as unknown as SystemSettings["integrations"]["providers"];

      const result = syncProjectProvidersToIntegrationCatalog(settings, nextIntegrationProviders);

      // Should remove from providers
      expect(result.aiProvider.providers["qwen-1"]).toBeUndefined();

      // Should fall back worker provider since it was removed
      expect(result.workers.virtualWorkerProvider).toBe("jules-1");

      // Should clean up routes
      expect(result.aiProvider.invocationRouting["route-1"].provider).toBeNull();
      expect(result.aiProvider.invocationRouting["route-1"].allowedProviders).toEqual(["jules-1"]);
      expect(result.aiProvider.invocationRouting["route-1"].providers["qwen-1"]).toBeUndefined();
    });
  });

  describe("applyOnboardingExperienceModeDefaults", () => {
    it("persists selected Standard and Expert modes without changing the rest of settings", () => {
      const settings = {
        defaults: {
          appearance: { experienceMode: "EXPERT", theme: "SYSTEM" },
        }
      } as unknown as SystemSettings;

      const result = applyOnboardingExperienceModeDefaults(settings, "STANDARD");

      expect(result.defaults.appearance.experienceMode).toBe("STANDARD");
      expect(result.defaults.appearance.theme).toBe("SYSTEM");
      expect(settings.defaults.appearance.experienceMode).toBe("EXPERT");
    });

    it("applies Easy defaults to provider routing, GitHub workflow, automation, and appearance", () => {
      const settings = {
        integrations: {
          providers: {
            codex: { provider: "codex", name: "Codex", apiKey: "", authPath: "~/.codex", mountAuth: false }
          }
        },
        defaults: {
          appearance: {
            experienceMode: "EXPERT",
            navigationMode: "DOCK",
            theme: "DARK",
            reducedMotion: "NONE",
            backgroundMode: "STATIC",
            backgroundPattern: "DOTS"
          },
          automationLevel: "ALWAYS_ASK",
          automationInterventions: { autoApprovePlan: false, autoAnswerClarification: true, autoResumePaused: true },
          memory: { enabled: false },
          aiProvider: {
            provider: null,
            strategy: "WEIGHTED",
            providers: {
              codex: { provider: "codex", name: "Codex", enabled: false, maxConcurrentTasks: 5 },
              jules: { provider: "jules", name: "Jules", enabled: true, maxConcurrentTasks: 15 }
            },
            invocationRouting: {
              task_coding: { profile: "WORKER", strategy: "WEIGHTED", provider: null, allowedProviders: [], providers: {} }
            }
          },
          workers: { executionMode: "VIRTUAL", virtualWorkerProvider: "jules", maxConcurrency: 100 },
          cliWorkflow: { executionMode: "DOCKER", gitMode: "remote", containerMountGithubAuth: true },
          git: { githubMode: "REMOTE", autoCreatePr: true },
          ciIntelligence: {
            enableLivePrMonitoring: true,
            resolveAllCommentsBeforeMainMerge: true,
            resolveMainMergeConflicts: true,
            resolveMainMergeFailedChecks: true,
            resolveAllCommentsBeforeFeatureMerge: true,
            resolveMergeConflicts: true,
            featurePrAutoMergeMode: "ALWAYS",
            mainBranchAutoMergeMode: "ALWAYS"
          }
        }
      } as unknown as SystemSettings;

      const result = applyOnboardingExperienceModeDefaults(settings, "EASY", {
        recommendedProvider: "codex",
        useGithub: false,
        manageGithubPrWorkflow: false,
      });

      expect(result.defaults.appearance.experienceMode).toBe("EASY");
      expect(result.defaults.appearance.navigationMode).toBe("SIDEBAR");
      expect(result.defaults.aiProvider.provider).toBe("codex");
      expect(result.integrations.providers.codex?.authType).toBe("dashboardAuth");
      expect(result.integrations.providers.codex?.mountAuth).toBe(true);
      expect(result.integrations.providers.codex?.authPath).toBe("~/.code-ux/credentials/codex");
      expect(result.defaults.aiProvider.providers.codex.enabled).toBe(true);
      expect(result.defaults.aiProvider.providers.jules).toBeUndefined();
      expect(result.defaults.aiProvider.invocationRouting.task_coding.provider).toBe("codex");
      expect(result.defaults.workers.virtualWorkerProvider).toBe("codex");
      expect(result.defaults.workers.maxConcurrency).toBe(3);
      expect(result.defaults.automationLevel).toBe("SEMI_AUTO");
      expect(result.defaults.automationInterventions.autoApprovePlan).toBe(true);
      expect(result.defaults.memory.enabled).toBe(true);
      expect(result.defaults.cliWorkflow.executionMode).toBe("DOCKER");
      expect(result.defaults.cliWorkflow.gitMode).toBe("local");
      expect(result.defaults.git.githubMode).toBe("LOCAL");
      expect(result.defaults.git.autoCreatePr).toBe(false);
      expect(result.defaults.ciIntelligence.featurePrAutoMergeMode).toBe("OFF");
    });
  });
});
