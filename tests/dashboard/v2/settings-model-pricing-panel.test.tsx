/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/preact";
import { SettingsModelPricingPanel } from "../../../dashboard/src/v2/components/settings/panels/SettingsModelPricingPanel.js";

const CATALOG = [
  {
    id: "openai/gpt-5.5",
    providerId: "openai",
    providerName: "OpenAI",
    modelId: "gpt-5.5",
    modelName: "GPT-5.5",
    cost: { inputTokens: 5, outputTokens: 30, cachedInputTokens: 0.5 },
  },
  {
    id: "anthropic/claude-sonnet-4-5",
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-sonnet-4-5",
    modelName: "Claude Sonnet 4.5",
    cost: { inputTokens: 3, outputTokens: 15, cachedInputTokens: 0.3 },
  },
  {
    id: "anthropic/claude-sonnet-4-6",
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-sonnet-4-6",
    modelName: "Claude Sonnet 4.6",
    cost: { inputTokens: 3, outputTokens: 15, cachedInputTokens: 0.3 },
  },
  {
    id: "anthropic/claude-opus-4-6",
    providerId: "anthropic",
    providerName: "Anthropic",
    modelId: "claude-opus-4-6",
    modelName: "Claude Opus 4.6",
    cost: { inputTokens: 5, outputTokens: 25, cachedInputTokens: 0.5 },
  },
  {
    id: "google/gemini-2.5-pro",
    providerId: "google",
    providerName: "Google",
    modelId: "gemini-2.5-pro",
    modelName: "Gemini 2.5 Pro",
    cost: { inputTokens: 1.25, outputTokens: 10, cachedInputTokens: 0.31 },
  },
  {
    id: "google/gemini-3.5-flash",
    providerId: "google",
    providerName: "Google",
    modelId: "gemini-3.5-flash",
    modelName: "Gemini 3.5 Flash",
    cost: { inputTokens: 1.5, outputTokens: 9, cachedInputTokens: 0.15 },
  },
  {
    id: "google/gemini-3-flash-preview",
    providerId: "google",
    providerName: "Google",
    modelId: "gemini-3-flash-preview",
    modelName: "Gemini 3 Flash Preview",
    cost: { inputTokens: 0.5, outputTokens: 3, cachedInputTokens: 0.05 },
  },
  {
    id: "google/gemini-3.1-pro-preview",
    providerId: "google",
    providerName: "Google",
    modelId: "gemini-3.1-pro-preview",
    modelName: "Gemini 3.1 Pro Preview",
    cost: { inputTokens: 2, outputTokens: 12, cachedInputTokens: 0.2 },
  },
  {
    id: "google-vertex/openai/gpt-oss-120b-maas",
    providerId: "google-vertex",
    providerName: "Google Vertex",
    modelId: "openai/gpt-oss-120b-maas",
    modelName: "GPT OSS 120B",
    cost: { inputTokens: 0.09, outputTokens: 0.36, cachedInputTokens: 0 },
  },
];

function buildSystemSettings(overrides: Record<string, any> = {}, providers: Record<string, any> = {}) {
  return {
    integrations: {
      providers: {
        codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "", customProviderId: "openai", customModel: "gpt-5.5" },
        ...providers,
      },
      githubToken: "",
    },
    defaults: {
      aiProvider: {
        providers: {},
      },
    },
    modelPricing: { overrides },
  } as any;
}

describe("SettingsModelPricingPanel", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => CATALOG }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("shows the catalogue base price for a model referenced by a configured provider's bare customModel + API provider pair", async () => {
    const systemSettings = buildSystemSettings();
    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem: vi.fn() } as any} />);

    expect(await screen.findByText("OpenAI — GPT-5.5")).toBeDefined();
    expect(screen.getByText("$5/M in • $30/M out • $0.5/M cached")).toBeDefined();
  });

  it("saves a per-model price override via updateSystem", async () => {
    const systemSettings = buildSystemSettings();
    const updateSystem = vi.fn((recipe: (current: typeof systemSettings) => typeof systemSettings) => {
      recipe(systemSettings);
    });

    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem } as any} />);

    fireEvent.click(await screen.findByText("Set override"));

    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.input(inputs[0], { target: { value: "1" } });
    fireEvent.input(inputs[1], { target: { value: "2" } });
    fireEvent.input(inputs[2], { target: { value: "0" } });

    fireEvent.click(screen.getByText("Save override"));

    expect(updateSystem).toHaveBeenCalled();
    const recipe = updateSystem.mock.calls[0][0];
    const next = recipe(systemSettings);
    expect(next.modelPricing.overrides["openai/gpt-5.5"]).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cachedInputTokens: 0,
    });
  });

  it("searches the full catalogue beyond configured models", async () => {
    const systemSettings = buildSystemSettings();
    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem: vi.fn() } as any} />);

    expect(screen.queryByText("Anthropic — Claude Sonnet 4.5")).toBeNull();

    const search = screen.getByPlaceholderText("Search the catalogue by provider or model name…");
    fireEvent.input(search, { target: { value: "claude" } });

    expect(await screen.findByText("Anthropic — Claude Sonnet 4.5")).toBeDefined();
  });

  it("shows a self-hosted custom model with no catalogue entry, tagged 'custom', and lets an override be set for it", async () => {
    const systemSettings = buildSystemSettings({}, {
      "codex-local": {
        provider: "codex", name: "Codex Local", apiKey: "", mountAuth: false, authPath: "",
        customProviderId: "my-gateway", customModel: "my-local-model",
      },
    });
    const updateSystem = vi.fn((recipe: (current: typeof systemSettings) => typeof systemSettings) => {
      recipe(systemSettings);
    });

    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem } as any} />);

    const modelLabel = await screen.findByText(/my-local-model/);
    expect(modelLabel).toBeDefined();
    expect(screen.getByText("No published pricing")).toBeDefined();
    expect(screen.getByText("custom")).toBeDefined();

    const row = modelLabel.closest(".flex.items-center.gap-3")!;
    fireEvent.click(row.querySelector("button")!);
    const inputs = screen.getAllByRole("spinbutton");
    fireEvent.input(inputs[0], { target: { value: "4" } });
    fireEvent.input(inputs[1], { target: { value: "8" } });
    fireEvent.click(screen.getByText("Save override"));

    const recipe = updateSystem.mock.calls[0][0];
    const next = recipe(systemSettings);
    expect(next.modelPricing.overrides["my-gateway/my-local-model"]).toEqual({
      inputTokens: 4,
      outputTokens: 8,
      cachedInputTokens: 0,
    });
  });

  it("falls back to a 'custom' provider namespace when no API provider was selected for the custom model", async () => {
    const systemSettings = buildSystemSettings({}, {
      "codex-noprovider": {
        provider: "codex", name: "Codex No Provider", apiKey: "", mountAuth: false, authPath: "",
        customModel: "another-local-model",
      },
    });
    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem: vi.fn() } as any} />);

    expect(await screen.findByText(/another-local-model/)).toBeDefined();
    // "custom/another-local-model" — a stable key even with no provider selected.
    expect(screen.getAllByText("custom").length).toBeGreaterThan(0);
  });

  it("preserves canonical provider/model ids and shows provider usage tags", async () => {
    const systemSettings = buildSystemSettings({}, {
      "qwen-local": {
        provider: "qwen-code", name: "Qwen Local", apiKey: "", mountAuth: false, authPath: "",
        qwenAuthMode: "MODEL_PROVIDER", qwenModelId: "google/gemma-4-26b-a4b-qat",
      },
    });
    systemSettings.defaults.aiProvider.providers = {
      "qwen-local": {
        provider: "qwen-code",
        name: "Qwen Local",
        enabled: true,
        model: "google/gemma-4-26b-a4b-qat",
        weight: 50,
        thinkingMode: "HIGH",
        maxConcurrentTasks: 1,
      },
    };

    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem: vi.fn() } as any} />);

    expect(await screen.findByText("Google — gemma-4-26b-a4b-qat")).toBeDefined();
    expect(screen.getByText("Qwen Local")).toBeDefined();
    expect(screen.queryByText("Alibaba — google/gemma-4-26b-a4b-qat")).toBeNull();
  });

  it("normalizes stale custom/provider/model override keys into the provider row", async () => {
    const systemSettings = buildSystemSettings({
      "custom/google/gemma-4-26b-a4b-qat": { inputTokens: 0.1, outputTokens: 0.15, cachedInputTokens: 0.0015 },
    });
    const updateSystem = vi.fn((recipe: (current: typeof systemSettings) => typeof systemSettings) => {
      recipe(systemSettings);
    });

    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem } as any} />);

    expect(await screen.findByText("Google — gemma-4-26b-a4b-qat")).toBeDefined();
    expect(screen.queryByText("custom — google/gemma-4-26b-a4b-qat")).toBeNull();

    const row = screen.getByText("Google — gemma-4-26b-a4b-qat").closest(".flex.items-center.gap-3")!;
    fireEvent.click(row.querySelector("button")!);
    fireEvent.click(screen.getByText("Save override"));

    const recipe = updateSystem.mock.calls[0][0];
    const next = recipe(systemSettings);
    expect(next.modelPricing.overrides["custom/google/gemma-4-26b-a4b-qat"]).toBeUndefined();
    expect(next.modelPricing.overrides["google/gemma-4-26b-a4b-qat"]).toEqual({
      inputTokens: 0.1,
      outputTokens: 0.15,
      cachedInputTokens: 0.0015,
    });
  });

  it("maps Antigravity models to their underlying catalogue providers", async () => {
    const systemSettings = buildSystemSettings();
    systemSettings.defaults.aiProvider.providers = {
      "antigravity-flash": {
        provider: "antigravity",
        name: "Antigravity Flash",
        enabled: true,
        model: "gemini-3.5-flash",
        weight: 50,
        thinkingMode: "HIGH",
        maxConcurrentTasks: 0,
      },
      "antigravity-sonnet": {
        provider: "antigravity",
        name: "Antigravity Sonnet",
        enabled: true,
        model: "claude-sonnet-4.6-thinking",
        weight: 50,
        thinkingMode: "HIGH",
        maxConcurrentTasks: 0,
      },
      "antigravity-gpt-oss": {
        provider: "antigravity",
        name: "Antigravity GPT OSS",
        enabled: true,
        model: "gpt-oss-120b",
        weight: 50,
        thinkingMode: "HIGH",
        maxConcurrentTasks: 0,
      },
    };

    render(<SettingsModelPricingPanel state={{ systemSettings, updateSystem: vi.fn() } as any} />);

    expect(await screen.findByText("Google — Gemini 3.5 Flash")).toBeDefined();
    expect(screen.getByText("Antigravity Flash")).toBeDefined();
    expect(screen.getByText("Anthropic — Claude Sonnet 4.6")).toBeDefined();
    expect(screen.getByText("Antigravity Sonnet")).toBeDefined();
    expect(screen.getByText("Google Vertex — GPT OSS 120B")).toBeDefined();
    expect(screen.getByText("Antigravity GPT OSS")).toBeDefined();
    expect(screen.queryByText("custom — gemini-3.5-flash")).toBeNull();
    expect(screen.queryByText("Google — Claude Sonnet 4.6")).toBeNull();
  });
});
