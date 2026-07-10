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

  it("defaults CI repair to the originating task session and preserves an explicit opt-out", () => {
    expect(sanitizeAiProvider({} as any).invocationRouting.ci_fix.continueTaskSession).toBe(true);

    const explicitRoute = sanitizeAiProvider({
      aiProvider: {
        invocationRouting: {
          ci_fix: { continueTaskSession: false },
        },
      },
    } as any);
    expect(explicitRoute.invocationRouting.ci_fix.continueTaskSession).toBe(false);
  });

  it("preserves explicit mockup-cli integration and project provider settings", () => {
    const integrationProviders = normalizeSystemIntegrationProviders({
      providers: {
        "mockup-cli": {
          provider: "mockup-cli",
          name: "Mockup Test Provider",
        },
      },
    });

    const result = sanitizeAiProvider({
      aiProvider: {
        provider: "mockup-cli",
        providers: {
          "mockup-cli": {
            provider: "mockup-cli",
            name: "Mockup Test Provider",
            enabled: true,
            model: "default",
            weight: 1,
            thinkingMode: "SMALL",
            maxConcurrentTasks: 1,
          },
        },
        invocationRouting: {
          task_coding: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: "mockup-cli",
            allowedProviders: ["mockup-cli"],
            providers: {
              "mockup-cli": {
                enabled: true,
                model: "default",
              },
            },
          },
        },
      },
    } as any, { integrationProviders });

    expect(integrationProviders["mockup-cli"]).toEqual(expect.objectContaining({
      provider: "mockup-cli",
      name: "Mockup Test Provider",
      apiKey: "",
      mountAuth: false,
      authPath: "",
    }));
    expect(result.provider).toBe("mockup-cli");
    expect(result.providers["mockup-cli"]).toEqual(expect.objectContaining({
      provider: "mockup-cli",
      enabled: true,
      model: "default",
      maxConcurrentTasks: 1,
    }));
    expect(result.invocationRouting.task_coding.provider).toBe("mockup-cli");
    expect(result.invocationRouting.task_coding.allowedProviders).toEqual(["mockup-cli"]);
    expect(result.invocationRouting.task_coding.providers["mockup-cli"]?.enabled).toBe(true);
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

  it("preserves selectable Codex catalog models in provider and route settings", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        provider: "codex",
        providers: {
          codex: {
            provider: "codex",
            enabled: true,
            model: "gpt-5.6-sol",
            weight: 20,
            thinkingMode: "HIGH",
          },
        },
        invocationRouting: {
          task_coding: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: "codex",
            allowedProviders: ["codex"],
            providers: {
              codex: {
                model: "gpt-5.6-terra",
              },
            },
          },
        },
      },
    } as any);

    expect(result.providers.codex.model).toBe("gpt-5.6-sol");
    expect(result.invocationRouting.task_coding.providers.codex?.model).toBe("gpt-5.6-terra");
  });

  it("normalizes legacy thinking modes to provider-specific persisted values", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        provider: "codex",
        providers: {
          codex: {
            provider: "codex",
            enabled: true,
            model: "gpt-5.6-sol",
            weight: 20,
            thinkingMode: "HIGH",
          },
          antigravity: {
            provider: "antigravity",
            enabled: true,
            model: "default",
            weight: 20,
            thinkingMode: "MEDIUM",
          },
        },
        invocationRouting: {
          task_coding: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: "codex",
            allowedProviders: ["codex"],
            providers: {
              codex: {
                thinkingMode: "SMALL",
              },
              antigravity: {
                thinkingMode: "HIGH",
              },
            },
          },
        },
      },
    } as any);

    expect(result.providers.codex.thinkingMode).toBe("high");
    expect(result.providers.antigravity.thinkingMode).toBe("high");
    expect(result.invocationRouting.task_coding.providers.codex?.thinkingMode).toBe("low");
    expect(result.invocationRouting.task_coding.providers.antigravity?.thinkingMode).toBe("high");
  });

  it("falls back or drops invalid provider thinking modes during sanitization", () => {
    const result = sanitizeAiProvider({
      aiProvider: {
        provider: "codex",
        providers: {
          codex: {
            provider: "codex",
            enabled: true,
            model: "gpt-5.6-sol",
            weight: 20,
            thinkingMode: "max",
          },
          antigravity: {
            provider: "antigravity",
            enabled: true,
            model: "default",
            weight: 20,
            thinkingMode: "medium",
          },
        },
        invocationRouting: {
          task_coding: {
            profile: "GLOBAL",
            strategy: "MANUAL",
            provider: "codex",
            allowedProviders: ["codex"],
            providers: {
              codex: {
                model: "gpt-5.6-terra",
                thinkingMode: "minimal",
              },
            },
          },
        },
      },
    } as any);

    expect(result.providers.codex.thinkingMode).toBe("high");
    expect(result.providers.antigravity.thinkingMode).toBe("high");
    expect(result.invocationRouting.task_coding.providers.codex).toEqual({
      model: "gpt-5.6-terra",
    });
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

    it("does not fan out provider-type settings into separate provider config ids", () => {
      const integrationProviders = normalizeSystemIntegrationProviders({
        providers: {
          gemini: {
            provider: "gemini",
            name: "Gemini Primary",
          },
          "gemini-fast": {
            provider: "gemini",
            name: "Gemini Fast",
          },
        },
      });

      const projectProviders = buildProjectProviderSettings({
        gemini: {
          provider: "gemini",
          enabled: true,
          model: "gemini-2.5-flash",
          weight: 77,
          maxConcurrentTasks: 3,
        },
      }, integrationProviders);

      expect(projectProviders.gemini.model).toBe("gemini-2.5-flash");
      expect(projectProviders.gemini.weight).toBe(77);
      expect(projectProviders.gemini.maxConcurrentTasks).toBe(3);
      expect(projectProviders["gemini-fast"].model).not.toBe("gemini-2.5-flash");
      expect(projectProviders["gemini-fast"].weight).not.toBe(77);
      expect(projectProviders["gemini-fast"].maxConcurrentTasks).not.toBe(3);
    });

    it("does not resolve provider-type aliases to arbitrary custom provider config ids", () => {
      const integrationProviders = normalizeSystemIntegrationProviders({
        providers: {
          "gemini-fast": {
            provider: "gemini",
            name: "Gemini Fast",
          },
        },
      });

      const result = sanitizeAiProvider({
        aiProvider: {
          provider: "gemini",
          providers: {
            "gemini-fast": {
              provider: "gemini",
              enabled: true,
              model: "gemini-2.5-flash",
            },
          },
          invocationRouting: {
            task_coding: {
              profile: "WORKER",
              strategy: "MANUAL",
              provider: "gemini",
              allowedProviders: ["gemini"],
              providers: {
                gemini: {
                  enabled: true,
                },
              },
            },
          },
        },
      } as any, { integrationProviders });

      expect(result.provider).toBe("gemini-fast");
      expect(result.invocationRouting.task_coding.provider).toBeNull();
      expect(result.invocationRouting.task_coding.allowedProviders).toEqual([]);
      expect(result.invocationRouting.task_coding.providers).toEqual({});
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

    it("keeps mockup-cli modern provider payloads without requiring credentials", () => {
      const result = normalizeSystemIntegrationProviders({
        providers: {
          "mockup-cli": {
            provider: "mockup-cli",
            name: "Mockup CLI",
          },
        },
      });

      expect(result["mockup-cli"]).toEqual(expect.objectContaining({
        provider: "mockup-cli",
        name: "Mockup CLI",
        apiKey: "",
        mountAuth: false,
        authPath: "",
        authType: "apiKey",
        providerConfigMode: "none",
        providerConfigPath: "",
      }));
    });

    it("defaults missing CLI provider config fields to copyHost standard paths", () => {
      const result = normalizeSystemIntegrationProviders({
        providers: {
          codex: {
            provider: "codex",
            name: "Codex Primary",
          },
        },
      });

      expect(result.codex.providerConfigMode).toBe("copyHost");
      expect(result.codex.providerConfigPath).toBe("~/.codex/config.toml");
    });

    it("clears custom provider config paths when config mode is none", () => {
      const result = normalizeSystemIntegrationProviders({
        providers: {
          gemini: {
            provider: "gemini",
            name: "Gemini Primary",
            providerConfigMode: "none",
            providerConfigPath: "/tmp/gemini-settings.json",
          },
        },
      });

      expect(result.gemini.providerConfigMode).toBe("none");
      expect(result.gemini.providerConfigPath).toBe("");
    });

    it("requires a non-empty custom provider config path for file mode", () => {
      const result = normalizeSystemIntegrationProviders({
        providers: {
          "qwen-code": {
            provider: "qwen-code",
            name: "Qwen Primary",
            providerConfigMode: "file",
            providerConfigPath: "  ",
          },
          "qwen-custom": {
            provider: "qwen-code",
            name: "Qwen Custom",
            providerConfigMode: "file",
            providerConfigPath: " ~/configs/qwen.json ",
          },
        },
      });

      expect(result["qwen-code"].providerConfigMode).toBe("copyHost");
      expect(result["qwen-code"].providerConfigPath).toBe("~/.qwen/settings.json");
      expect(result["qwen-custom"].providerConfigMode).toBe("file");
      expect(result["qwen-custom"].providerConfigPath).toBe("~/configs/qwen.json");
    });

    it("ignores provider config file settings for non-CLI providers", () => {
      const result = normalizeSystemIntegrationProviders({
        providers: {
          jules: {
            provider: "jules",
            name: "Jules Primary",
            providerConfigMode: "file",
            providerConfigPath: "/tmp/jules.json",
          },
        },
      });

      expect(result.jules.providerConfigMode).toBe("none");
      expect(result.jules.providerConfigPath).toBe("");
    });
  });
});
