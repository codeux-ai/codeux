import { describe, expect, it } from "vitest";
import { sanitizeAiProvider } from "../../../../../src/domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { buildDefaultIntegrationProviders } from "../../../../../src/domain/settings/provider-config-utils.js";

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
});
