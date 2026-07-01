import { describe, it, expect } from "vitest";
import {
  buildProviderConfigId,
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
});
