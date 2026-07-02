import { describe, expect, it } from "vitest";
import { resolveCatalogModelId, resolveCustomProviderModelId } from "../../../../src/domain/model-catalog/model-catalog-matcher.js";
import type { SystemSettings } from "../../../../src/contracts/settings-scope-types.js";

function buildSettings(providers: SystemSettings["integrations"]["providers"]): SystemSettings {
  return {
    integrations: { providers, githubToken: "", gitlabToken: "" },
  } as SystemSettings;
}

describe("resolveCatalogModelId", () => {
  it("matches versioned model slugs directly against the mapped models.dev provider", () => {
    expect(resolveCatalogModelId("codex", "gpt-5.5")).toBe("openai/gpt-5.5");
    expect(resolveCatalogModelId("claude-code", "claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    expect(resolveCatalogModelId("qwen-code", "qwen3-coder-plus")).toBe("alibaba/qwen3-coder-plus");
    expect(resolveCatalogModelId("gemini", "gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
  });

  it("resolves shorthand aliases that don't match a models.dev id directly", () => {
    expect(resolveCatalogModelId("claude-code", "sonnet")).toBe("anthropic/claude-sonnet-4-5");
    expect(resolveCatalogModelId("claude-code", "default")).toBe("anthropic/claude-sonnet-4-5");
    expect(resolveCatalogModelId("gemini", "flash")).toBe("google/gemini-2.5-flash");
  });

  it("treats opencode model ids as already-canonical provider/model pairs", () => {
    expect(resolveCatalogModelId("opencode", "anthropic/claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
    expect(resolveCatalogModelId("opencode", "claude-sonnet-4-5")).toBe("opencode/claude-sonnet-4-5");
    expect(resolveCatalogModelId("opencode", "not-a-real-provider/not-a-real-model")).toBeNull();
  });

  it("preserves catalogue-backed canonical provider/model ids for any Code UX provider", () => {
    expect(resolveCatalogModelId("qwen-code", "deepseek/deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
    expect(resolveCatalogModelId("claude-code", "deepseek/deepseek-v4-flash")).toBe("deepseek/deepseek-v4-flash");
  });

  it("returns null for providers/models with no catalogue match", () => {
    expect(resolveCatalogModelId("jules", "default")).toBeNull();
    expect(resolveCatalogModelId("codex", "totally-made-up-model")).toBeNull();
  });

  it("returns null for an empty model string", () => {
    expect(resolveCatalogModelId("codex", "")).toBeNull();
    expect(resolveCatalogModelId("codex", "   ")).toBeNull();
  });
});

describe("resolveCustomProviderModelId", () => {
  it("reconstructs the override key from a Codex/Claude instance's paired API provider + custom model", () => {
    const settings = buildSettings({
      "codex-local": {
        provider: "codex", name: "Codex Local", apiKey: "", mountAuth: false, authPath: "",
        customProviderId: "openrouter", customModel: "my-self-hosted-model",
      },
    });
    expect(resolveCustomProviderModelId("codex", "my-self-hosted-model", settings)).toBe("openrouter/my-self-hosted-model");
  });

  it("falls back to a 'custom' provider namespace when no API provider was selected", () => {
    const settings = buildSettings({
      "claude-local": {
        provider: "claude-code", name: "Claude Local", apiKey: "", mountAuth: false, authPath: "",
        customModel: "my-local-model",
      },
    });
    expect(resolveCustomProviderModelId("claude-code", "my-local-model", settings)).toBe("custom/my-local-model");
  });

  it("preserves canonical provider/model override keys when no API provider was selected", () => {
    const settings = buildSettings({
      "qwen-local": {
        provider: "qwen-code", name: "Qwen Local", apiKey: "", mountAuth: false, authPath: "",
        qwenModelId: "google/gemma-4-26b-a4b-qat",
      },
      "codex-local": {
        provider: "codex", name: "Codex Local", apiKey: "", mountAuth: false, authPath: "",
        customModel: "deepseek/deepseek-v4-flash",
      },
    });
    expect(resolveCustomProviderModelId("qwen-code", "google/gemma-4-26b-a4b-qat", settings)).toBe("google/gemma-4-26b-a4b-qat");
    expect(resolveCustomProviderModelId("codex", "deepseek/deepseek-v4-flash", settings)).toBe("deepseek/deepseek-v4-flash");
  });

  it("reconstructs the override key for Qwen and OpenCode instances", () => {
    const settings = buildSettings({
      "qwen-local": {
        provider: "qwen-code", name: "Qwen Local", apiKey: "", mountAuth: false, authPath: "",
        qwenApiProviderId: "alibaba", qwenModelId: "glm-4.7-flash",
      },
      "opencode-local": {
        provider: "opencode", name: "OpenCode Local", apiKey: "", mountAuth: false, authPath: "",
        openCodeProviderId: "ollama", openCodeModelId: "llama3.3",
      },
    });
    expect(resolveCustomProviderModelId("qwen-code", "glm-4.7-flash", settings)).toBe("alibaba/glm-4.7-flash");
    expect(resolveCustomProviderModelId("opencode", "llama3.3", settings)).toBe("ollama/llama3.3");
    expect(resolveCustomProviderModelId("opencode", "ollama/llama3.3", settings)).toBe("ollama/llama3.3");
  });

  it("returns null when no configured instance of that provider type matches the model", () => {
    const settings = buildSettings({
      "codex-local": {
        provider: "codex", name: "Codex Local", apiKey: "", mountAuth: false, authPath: "",
        customProviderId: "openrouter", customModel: "my-self-hosted-model",
      },
    });
    expect(resolveCustomProviderModelId("codex", "some-other-model", settings)).toBeNull();
    expect(resolveCustomProviderModelId("claude-code", "my-self-hosted-model", settings)).toBeNull();
  });
});
