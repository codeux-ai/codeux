import { describe, expect, it } from "vitest";
import { sanitizeAiProvider } from "../../../../../src/domain/settings/settings-sanitizers/ai-provider-sanitizer.js";

describe("sanitizeAiProvider", () => {
  it("uses external hints for fallback api keys", () => {
    const input = { aiProvider: { provider: "gemini" } };
    const result = sanitizeAiProvider(input, {
      resolved: {
        julesApiKey: "jules-key",
        geminiApiKey: "gemini-key",
        codexApiKey: "codex-key",
        claudeCodeApiKey: "claude-key",
        githubToken: "",
      },
      env: {},
      settingsJson: {},
    });

    expect(result.provider).toBe("gemini");
    expect(result.providers.jules.apiKey).toBe("jules-key");
    expect(result.providers.gemini.apiKey).toBe("gemini-key");
    expect(result.providers.codex.apiKey).toBe("codex-key");
    expect(result.providers["claude-code"].apiKey).toBe("claude-key");
  });

  it("prioritizes input over external hints for api keys", () => {
    const input = { aiProvider: { julesApiKey: "explicit-jules-key", providers: { gemini: { apiKey: "explicit-gemini-key" } } } };
    const result = sanitizeAiProvider(input, {
      resolved: { julesApiKey: "jules-key", geminiApiKey: "gemini-key", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      env: {},
      settingsJson: {},
    });

    expect(result.julesApiKey).toBe("explicit-jules-key");
    expect(result.providers.gemini.apiKey).toBe("explicit-gemini-key");
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
});
