import { describe, expect, it } from "vitest";
import { sanitizeAiProvider } from "../../../../../src/domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { buildDashboardProviderSettings, buildDefaultIntegrationProviders, buildProjectProviderSettings, normalizeSystemIntegrationProviders } from "../../../../../src/domain/settings/provider-config-utils.js";

describe("sanitizeAiProvider", () => {
  it("uses external hints to build the default instance catalog", () => {
    const input = { aiProvider: { provider: "gemini" } };
    const externalHints = {
      resolved: {
        julesApiKey: "jules-key",
        geminiApiKey: "gemini-key",
        codexApiKey: "codex-key",
        claudeCodeApiKey: "claude-key",
        githubToken: "",
      },
      env: {},
      settingsJson: {},
    };
    const integrationProviders = buildDefaultIntegrationProviders(externalHints);
    const result = sanitizeAiProvider(input, {
      externalHints,
      integrationProviders,
    });

    expect(result.provider).toBe("gemini");
    expect(integrationProviders.jules.apiKey).toBe("jules-key");
    expect(integrationProviders.gemini.apiKey).toBe("gemini-key");
    expect(result.providers.jules.provider).toBe("jules");
    expect(result.providers.gemini.provider).toBe("gemini");
  });

  it("prioritizes input over defaults for provider config fields", () => {
    const input = { aiProvider: { providers: { gemini: { model: "gemini-2.5-flash", weight: 55 } } } };
    const result = sanitizeAiProvider(input, {
      externalHints: {
        resolved: { julesApiKey: "jules-key", geminiApiKey: "gemini-key", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
        env: {},
        settingsJson: {},
      },
    });

    expect(result.providers.gemini.model).toBe("gemini-2.5-flash");
    expect(result.providers.gemini.weight).toBe(55);
    expect(result.providers.jules.provider).toBe("jules");
  });

  it("supports legacy flat julesApiKey input during migration through integration providers", () => {
    const integrationProviders = buildDefaultIntegrationProviders({
      resolved: { julesApiKey: "jules-key", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      env: {},
      settingsJson: {},
    });

    expect(integrationProviders.jules.apiKey).toBe("jules-key");
  });

  it("normalizes invocation routing with sparse provider overrides", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        invocationRouting: {
          clarification_reply: {
            profile: "WORKER",
            strategy: "MANUAL",
            provider: null,
            allowedProviders: ["gemini"],
            providers: {
              gemini: {
                model: "gemini-2.5-flash",
              },
            },
          },
        },
      },
    } as any);

    expect(result.invocationRouting.clarification_reply.profile).toBe("WORKER");
    expect(result.invocationRouting.clarification_reply.allowedProviders).toEqual(["gemini"]);
    expect(result.invocationRouting.clarification_reply.providers.gemini?.model).toBe("gemini-2.5-flash");
    expect(result.invocationRouting.planning.profile).toBeDefined();
  });

  it("migrates untouched legacy dashboard reply routes to worker profile defaults", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        invocationRouting: {
          dashboard_reply: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: null,
            allowedProviders: [],
            providers: {},
          },
        },
      },
    } as any);

    expect(result.invocationRouting.dashboard_reply.profile).toBe("WORKER");
  });

  it("preserves intentionally customized dashboard reply routes", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        invocationRouting: {
          dashboard_reply: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: "codex",
            allowedProviders: [],
            providers: {},
          },
        },
      },
    } as any);

    expect(result.invocationRouting.dashboard_reply.profile).toBe("GLOBAL");
    expect(result.invocationRouting.dashboard_reply.provider).toBe("codex");
  });

  describe("normalizeSystemIntegrationProviders", () => {
    it("should preserve explicitly defined mountAuth boolean values", () => {
      const input = {
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
            apiKey: "some-key",
            mountAuth: false,
            authType: "localAuth",
          },
        },
      };
      const result = normalizeSystemIntegrationProviders(input);
      expect(result.codex.mountAuth).toBe(false);
      expect(result.codex.authType).toBe("localAuth");
    });

    it("should default mountAuth to true when authType is localAuth and mountAuth is not specified", () => {
      const input = {
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
            apiKey: "some-key",
            authType: "localAuth",
          },
        },
      };
      const result = normalizeSystemIntegrationProviders(input);
      expect(result.codex.mountAuth).toBe(true);
    });

    it("forces mountAuth on for dashboardAuth instances even when a stale mountAuth=false is stored", () => {
      const input = {
        providers: {
          // Primaries seed mountAuth=false; switching them to dashboard login must
          // still mount the saved credentials (and keep the instance routable).
          gemini: {
            provider: "gemini",
            name: "Gemini Primary",
            apiKey: "",
            mountAuth: false,
            authType: "dashboardAuth",
          },
        },
      };
      const result = normalizeSystemIntegrationProviders(input);
      expect(result.gemini.authType).toBe("dashboardAuth");
      expect(result.gemini.mountAuth).toBe(true);
      expect(result.gemini.authPath).toBe("~/.code-ux/credentials/gemini");
    });

    it("drops stale custom endpoint settings when Codex uses dashboard login", () => {
      const input = {
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
            apiKey: "sk-local",
            mountAuth: false,
            authType: "dashboardAuth",
            customBaseUrl: "http://192.168.0.38:1234/v1",
            customModel: "local-model",
          },
        },
      };

      const result = normalizeSystemIntegrationProviders(input);

      expect(result.codex.authType).toBe("dashboardAuth");
      expect(result.codex.mountAuth).toBe(true);
      expect(result.codex.apiKey).toBe("");
      expect(result.codex.customBaseUrl).toBeUndefined();
      expect(result.codex.customModel).toBeUndefined();
    });

    it("keeps Codex Primary isolated from a separate Codex Local instance", () => {
      const integrationProviders = normalizeSystemIntegrationProviders({
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
            authType: "dashboardAuth",
          },
          "codex-local": {
            provider: "codex",
            name: "Codex Local",
            authType: "apiKey",
            apiKey: "sk-local",
            customBaseUrl: "http://192.168.0.38:1234/v1",
            customModel: "local-model",
          },
        },
      });
      const projectProviders = buildProjectProviderSettings({
        codex: {
          provider: "codex",
          name: "Codex Primary",
          model: "gpt-5.5",
          enabled: true,
        },
        "codex-local": {
          provider: "codex",
          name: "Codex Local",
          model: "gpt-5-codex",
          enabled: true,
        },
      }, integrationProviders);

      const result = buildDashboardProviderSettings(projectProviders, integrationProviders);

      expect(result.codex.apiKey).toBe("");
      expect(result.codex.customBaseUrl).toBeUndefined();
      expect(result.codex.customModel).toBeUndefined();
      expect(result.codex.model).toBe("gpt-5.5");
      expect(result["codex-local"].apiKey).toBe("sk-local");
      expect(result["codex-local"].customBaseUrl).toBe("http://192.168.0.38:1234/v1");
      expect(result["codex-local"].customModel).toBe("local-model");
    });

    it("does not automatically readd default providers like gemini when they are omitted in a modern providers payload", () => {
      const input = {
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
            apiKey: "some-key",
            mountAuth: false,
            authType: "localAuth",
          },
        },
      };
      const result = normalizeSystemIntegrationProviders(input);
      expect(result.codex).toBeDefined();
      expect(result.gemini).toBeUndefined();
      expect(result.jules).toBeUndefined();
    });
  });
});
