import { describe, it, expect } from "vitest";
import {
  getProviderInitialSelection,
  cloneSettings,
  getSystemProvidersByType,
  getFirstCliProviderConfigId,
  syncProjectProvidersToIntegrationCatalog
} from "../../../dashboard/src/v2/lib/onboarding-provider-settings.js";
import type { OnboardingProviderCredentialStatus, SystemSettings, ProjectSettings } from "../../../dashboard/src/types.js";

describe("onboarding-provider-settings", () => {
  it("getProviderInitialSelection returns jules, enabled providers, and detected providers", () => {
    const providers: OnboardingProviderCredentialStatus[] = [
      { provider: "codex", available: true, mountEnabled: false, details: "" },
      { provider: "claude-code", available: false, mountEnabled: true, details: "" },
      { provider: "qwen-code", available: false, mountEnabled: false, details: "" }
    ];

    const settings = {
      defaults: {
        aiProvider: {
          providers: {
            "gemini-1": { provider: "gemini", enabled: true },
            "opencode-1": { provider: "opencode", enabled: false }
          }
        }
      }
    } as unknown as SystemSettings;

    const result = getProviderInitialSelection(providers, settings);
    expect(result).toContain("jules");
    expect(result).toContain("codex");
    expect(result).toContain("claude-code");
    expect(result).toContain("gemini");
    expect(result).not.toContain("qwen-code");
    expect(result).not.toContain("opencode");
  });

  it("cloneSettings deep clones the settings object", () => {
    const settings = { a: 1, b: { c: 2 } } as unknown as SystemSettings;
    const cloned = cloneSettings(settings);
    expect(cloned).toEqual(settings);
    expect(cloned).not.toBe(settings);
    expect(cloned.b).not.toBe(settings.b);
  });

  it("getSystemProvidersByType sorts and filters integration providers by type", () => {
    const settings = {
      integrations: {
        providers: {
          "p1": { provider: "gemini", name: "B" },
          "p2": { provider: "codex", name: "A" },
          "p3": { provider: "gemini", name: "A" }
        }
      }
    } as unknown as SystemSettings;

    const result = getSystemProvidersByType(settings, "gemini");
    expect(result).toHaveLength(2);
    // Based on sortProviderConfigEntries, it should sort by name then ID
    expect(result[0][0]).toBe("p1");
    expect(result[1][0]).toBe("p3");
  });

  it("getFirstCliProviderConfigId returns the first provider that is not jules", () => {
    const providers = {
      "p1": { provider: "jules" },
      "p2": { provider: "gemini" },
      "p3": { provider: "codex" }
    } as unknown as ProjectSettings["aiProvider"]["providers"];

    const result = getFirstCliProviderConfigId(providers);
    expect(result).toBe("p2");
  });

  describe("syncProjectProvidersToIntegrationCatalog", () => {
    it("synchronizes providers and updates fallback selection logic", () => {
      const settings = {
        defaults: {
          aiProvider: {
            provider: "old-global",
            providers: {
              "p1": { provider: "gemini", name: "G1", enabled: true },
              "p2": { provider: "codex", name: "C1", enabled: false }
            },
            invocationRouting: {
              "route1": { provider: "p1", allowedProviders: ["p1", "p2", "p3"], providers: { "p1": {}, "p2": {} } }
            }
          },
          workers: {
            virtualWorkerProvider: "old-worker"
          }
        }
      } as unknown as SystemSettings;

      const nextIntegrationProviders = {
        "p1": { provider: "gemini", name: "New G1" },
        "p3": { provider: "opencode", name: "New O1" }
      } as unknown as SystemSettings["integrations"]["providers"];

      const result = syncProjectProvidersToIntegrationCatalog(settings, nextIntegrationProviders);

      // It should keep p1 from defaults, but update name.
      expect(result.aiProvider.providers["p1"]).toBeDefined();
      expect(result.aiProvider.providers["p1"].name).toBe("New G1");
      expect(result.aiProvider.providers["p1"].enabled).toBe(true);

      // It should create a draft for p3
      expect(result.aiProvider.providers["p3"]).toBeDefined();
      expect(result.aiProvider.providers["p3"].provider).toBe("opencode");
      expect(result.aiProvider.providers["p3"].name).toBe("New O1");
      expect(result.aiProvider.providers["p3"].enabled).toBe(false); // default draft

      // It should remove p2
      expect(result.aiProvider.providers["p2"]).toBeUndefined();

      // Fallbacks
      // since old-global was "old-global", which isn't in next, fallback global becomes first key ("p1")
      expect(result.aiProvider.provider).toBe("p1");

      // virtualWorkerProvider fallback logic
      expect(result.workers.virtualWorkerProvider).toBe("p1"); // fallback to first CLI provider

      // Routing
      expect(result.aiProvider.invocationRouting["route1"].provider).toBe("p1");
      expect(result.aiProvider.invocationRouting["route1"].allowedProviders).toEqual(["p1", "p3"]);
      expect(result.aiProvider.invocationRouting["route1"].providers).toHaveProperty("p1");
      expect(result.aiProvider.invocationRouting["route1"].providers).not.toHaveProperty("p2");
    });
  });
});
