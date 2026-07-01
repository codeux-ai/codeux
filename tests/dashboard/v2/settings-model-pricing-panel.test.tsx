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
];

function buildSystemSettings(overrides: Record<string, any> = {}) {
  return {
    integrations: {
      providers: {
        codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "", customModel: "openai/gpt-5.5" },
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

  it("shows the catalogue base price for a model referenced by a configured provider", async () => {
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
});
