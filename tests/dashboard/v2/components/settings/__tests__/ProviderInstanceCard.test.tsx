/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/preact";
import { ProviderInstanceCard } from "../../../../../../dashboard/src/v2/components/settings/ProviderInstanceCard";
import type { SystemProviderConfig } from "../../../../../../dashboard/src/v2/lib/provider-runtime-preview";

const PROVIDER_CATALOG = [
  { id: "openrouter", name: "OpenRouter", apiBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "anthropic", name: "Anthropic", apiBaseUrl: undefined },
];

const MODEL_CATALOG = [
  { id: "anthropic/claude-sonnet-4-5", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-5", modelName: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4-5", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-opus-4-5", modelName: "Claude Opus 4.5" },
  { id: "openai/gpt-5.5", providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.5", modelName: "GPT-5.5" },
];

describe("ProviderInstanceCard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/model-catalog/providers") {
        return Promise.resolve({ ok: true, json: async () => PROVIDER_CATALOG });
      }
      if (url === "/api/model-catalog") {
        return Promise.resolve({ ok: true, json: async () => MODEL_CATALOG });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as any;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    cleanup();
  });

  it("no longer renders the removed per-provider token pricing modal", () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "Test Provider",
      apiKey: "test",
      mountAuth: false,
      authPath: "",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="test-model"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.queryByText("Token pricing")).toBeNull();
  });

  it("lets the user type a custom model slug into the models.dev-backed combobox for a gateway model field", async () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const trigger = screen.getByText("Leave empty to use the agent's selected model").closest("button")!;
    fireEvent.click(trigger);

    const search = await screen.findByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "openai/gpt-5-codex" } });

    const customOption = screen.getByText('Use "openai/gpt-5-codex"');
    fireEvent.click(customOption);

    expect(onUpdate).toHaveBeenCalledWith({ customModel: "openai/gpt-5-codex" });
  });

  it("autofills the base URL when a known API provider is selected for Codex", async () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const trigger = await screen.findByText("Leave empty to use the default endpoint");
    fireEvent.click(trigger.closest("button")!);

    const openRouterOption = await screen.findByText("OpenRouter");
    fireEvent.click(openRouterOption);

    expect(onUpdate).toHaveBeenCalledWith({
      customProviderId: "openrouter",
      customBaseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("does not clobber the base URL when the selected provider has no published endpoint", async () => {
    const provider: SystemProviderConfig = {
      provider: "claude-code",
      name: "Claude Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="default"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const trigger = await screen.findByText("Leave empty to use the default endpoint");
    fireEvent.click(trigger.closest("button")!);

    const anthropicOption = await screen.findByText("Anthropic");
    fireEvent.click(anthropicOption);

    expect(onUpdate).toHaveBeenCalledWith({ customProviderId: "anthropic" });
  });

  it("upgrades OpenCode's Provider id field to the same searchable provider combobox and autofills its base URL", async () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "OpenCode Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "ollama",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="ollama/glm-4.7-flash"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const trigger = await screen.findByText("ollama");
    fireEvent.click(trigger.closest("button")!);

    const search = await screen.findByPlaceholderText("Search...");
    fireEvent.input(search, { target: { value: "OpenRouter" } });
    fireEvent.click(await screen.findByText("OpenRouter"));

    expect(onUpdate).toHaveBeenCalledWith({
      openCodeProviderId: "openrouter",
      openCodeBaseUrl: "https://openrouter.ai/api/v1",
    });
  });

  it("stores the bare model id (no provider prefix) and filters options to the selected API provider", async () => {
    const provider: SystemProviderConfig = {
      provider: "claude-code",
      name: "Claude Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      customProviderId: "anthropic",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="default"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const trigger = await screen.findByText("Leave empty to use the agent's selected model");
    fireEvent.click(trigger.closest("button")!);

    // Filtered to the anthropic provider: shows bare model names, no OpenAI model, no provider prefix.
    expect(await screen.findByText("Claude Sonnet 4.5")).toBeDefined();
    expect(screen.queryByText("GPT-5.5")).toBeNull();
    expect(screen.queryByText("Anthropic — Claude Sonnet 4.5")).toBeNull();

    fireEvent.click(screen.getByText("Claude Sonnet 4.5"));

    expect(onUpdate).toHaveBeenCalledWith({ customModel: "claude-sonnet-4-5" });
  });
});
