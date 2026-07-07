/** @vitest-environment happy-dom */
import { h } from "preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen, cleanup, waitFor, within } from "@testing-library/preact";
import { ProviderInstanceCard } from "../../../../../../dashboard/src/v2/components/settings/ProviderInstanceCard";
import type { SystemProviderConfig } from "../../../../../../dashboard/src/v2/lib/provider-runtime-preview";
import { resetModelCatalogCache } from "../../../../../../dashboard/src/v2/components/ui/ModelCombobox";
import { resetProviderCatalogCache } from "../../../../../../dashboard/src/v2/components/ui/ProviderCombobox";

const PROVIDER_CATALOG = [
  { id: "openrouter", name: "OpenRouter", apiBaseUrl: "https://openrouter.ai/api/v1" },
  { id: "anthropic", name: "Anthropic", apiBaseUrl: undefined },
];

const MODEL_CATALOG = [
  { id: "anthropic/claude-sonnet-4-5", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-sonnet-4-5", modelName: "Claude Sonnet 4.5" },
  { id: "anthropic/claude-opus-4-5", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-opus-4-5", modelName: "Claude Opus 4.5" },
  { id: "openai/gpt-5.5", providerId: "openai", providerName: "OpenAI", modelId: "gpt-5.5", modelName: "GPT-5.5" },
  // A reseller mirroring the same bare model id as openai's, to exercise dedup when unfiltered.
  { id: "302ai/gpt-5.5", providerId: "302ai", providerName: "302.AI", modelId: "gpt-5.5", modelName: "GPT-5.5" },
  // A reseller-only model under its own id — excluded from the default (no provider selected)
  // list entirely, since 302ai isn't a primary model-creator provider.
  { id: "302ai/gizmo-x", providerId: "302ai", providerName: "302.AI", modelId: "gizmo-x", modelName: "Gizmo X" },
  // A large primary provider (alibaba sorts first alphabetically and has 50+ real models in
  // the live catalogue) to guard against a render cap crowding out every other provider.
  ...Array.from({ length: 60 }, (_, i) => ({
    id: `alibaba/qwen-model-${i}`,
    providerId: "alibaba",
    providerName: "Alibaba",
    modelId: `qwen-model-${i}`,
    modelName: `Qwen Model ${i}`,
  })),
];

describe("ProviderInstanceCard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetModelCatalogCache();
    resetProviderCatalogCache();
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

  it("names provider card controls and exposes auth choices as radios", () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "Very Long OpenCode Provider",
      apiKey: "test",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="opencode-long"
        provider={provider}
        providerModel="test-model"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
        onRemove={vi.fn()}
        enabled
        onToggleEnabled={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "Very Long OpenCode Provider" })).toBeDefined();
    expect(screen.getByRole("switch", { name: "Enable Very Long OpenCode Provider" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Enable Very Long OpenCode Provider" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Remove Very Long OpenCode Provider" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "Very Long OpenCode Provider authentication mode" })).toBeDefined();
    expect(screen.getByRole("radio", { name: /API Key/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Very Long OpenCode Provider API key")).toBeDefined();
  });

  it("requires cancellable confirmation before removing a provider instance and announces the local state", async () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Removable",
      apiKey: "",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onRemove = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-removable"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
        onRemove={onRemove}
      />
    );

    const removeButton = screen.getByRole("button", { name: "Remove Codex Removable" });
    fireEvent.click(removeButton);

    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Confirm removal of Codex Removable" })).toBeDefined();
    expect(screen.getByRole("status").textContent).toContain("Removal is armed for Codex Removable");
    expect(screen.getByRole("button", { name: "Cancel" })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Confirm removal of Codex Removable" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Codex Removable" })).toBe(document.activeElement);
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("Removal cancelled for Codex Removable. Local settings are unchanged.");
    });

    fireEvent.click(screen.getByRole("button", { name: "Remove Codex Removable" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Codex Removable" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("announces display-name edits as local unsaved settings feedback", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Draft",
      apiKey: "",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-draft"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    fireEvent.input(screen.getByLabelText("Codex Draft display name"), { target: { value: "Codex Edited" } });

    expect(onUpdate).toHaveBeenCalledWith({ name: "Codex Edited" });
    expect(screen.getByRole("status").textContent).toContain("Codex Draft display name changed locally");
  });

  it("reports enable and disable update errors through an alert region", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Toggle",
      apiKey: "",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="codex-toggle"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
        enabled
        onToggleEnabled={() => {
          throw new Error("Unable to update provider routing state.");
        }}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "Enable Codex Toggle" }));

    expect(screen.getByRole("alert").textContent).toContain("Unable to update provider routing state.");
  });

  it("announces API key edits as local draft feedback", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Key Draft",
      apiKey: "",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-key-draft"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    fireEvent.input(screen.getByLabelText("Codex Key Draft API key"), { target: { value: "sk-local" } });

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "sk-local" }));
    expect(screen.getByRole("status").textContent).toContain("Codex Key Draft API key changed locally");
  });

  it("uses the secret field label in the reveal toggle accessible name", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Secret",
      apiKey: "secret-value",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="codex-secret"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
      />
    );

    const revealButton = screen.getByRole("button", { name: "Show Codex Secret API key" });
    fireEvent.click(revealButton);

    expect(screen.getByRole("button", { name: "Hide Codex Secret API key" })).toBeDefined();
  });

  it("announces auth mode changes as local unsaved settings feedback", () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "OpenCode Auth",
      apiKey: "test",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="opencode-auth"
        provider={provider}
        providerModel="ollama/test"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Local Copy/i }));

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      authType: "localAuth",
      mountAuth: true,
      apiKey: "",
      openCodeAuthMode: "LOCAL_AUTH",
    }));
    expect(screen.getByRole("status").textContent).toContain("OpenCode Auth authentication mode changed locally");
  });

  it("renders provider config choices for CLI providers and updates all three modes", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Config",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-config"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const configModeGroup = screen.getByRole("radiogroup", { name: "Codex Config provider config mode" });
    expect(configModeGroup).toBeDefined();
    expect(within(configModeGroup).getByRole("radio", { name: /Copy Host/i }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("~/.codex/config.toml")).toBeDefined();

    fireEvent.click(within(configModeGroup).getByRole("radio", { name: /None/i }));
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      providerConfigMode: "none",
      providerConfigPath: "",
      apiKey: "test-key",
      authType: "apiKey",
    }));

    fireEvent.click(within(configModeGroup).getByRole("radio", { name: /^File\b/i }));
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      providerConfigMode: "file",
      providerConfigPath: "~/.codex/config.toml",
      apiKey: "test-key",
      authType: "apiKey",
    }));

    fireEvent.click(within(configModeGroup).getByRole("radio", { name: /Copy Host/i }));
    expect(onUpdate).toHaveBeenLastCalledWith(expect.objectContaining({
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
      apiKey: "test-key",
      authType: "apiKey",
    }));
    expect(screen.getByRole("status").textContent).toContain("Codex Config provider config mode changed locally");
  });

  it("renders a local file picker for provider config file mode and stores path edits", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex File Config",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      providerConfigMode: "file",
      providerConfigPath: "~/configs/codex.toml",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-file-config"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    const input = screen.getByLabelText("Codex File Config provider config file");
    expect(input.getAttribute("placeholder")).toBe("~/.codex/config.toml");
    expect(screen.getByText("Select the Codex config.toml file to copy into the provider runtime.")).toBeDefined();

    fireEvent.input(input, { target: { value: "~/alternate/codex.toml" } });

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      providerConfigMode: "file",
      providerConfigPath: "~/alternate/codex.toml",
      apiKey: "test-key",
      authType: "apiKey",
    }));
    expect(screen.getByRole("status").textContent).toContain("Codex File Config provider config file changed locally");
  });

  it("does not mutate local auth fields when provider config mode changes", () => {
    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Local Auth Config",
      apiKey: "",
      mountAuth: true,
      authPath: "~/.codex",
      authType: "localAuth",
      providerConfigMode: "copyHost",
      providerConfigPath: "~/.codex/config.toml",
    };
    const onUpdate = vi.fn();

    render(
      <ProviderInstanceCard
        providerConfigId="codex-local-auth-config"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /None/i }));

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      providerConfigMode: "none",
      providerConfigPath: "",
      authType: "localAuth",
      mountAuth: true,
      authPath: "~/.codex",
      apiKey: "",
    }));
  });

  it("does not show provider config controls for Jules or mockup CLI providers", () => {
    const onUpdate = vi.fn();

    const { rerender } = render(
      <ProviderInstanceCard
        providerConfigId="jules"
        provider={{
          provider: "jules",
          name: "Jules Primary",
          apiKey: "test-key",
          mountAuth: false,
          authPath: "",
          providerConfigMode: "none",
          providerConfigPath: "",
        }}
        providerModel="default"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    expect(screen.queryByRole("radiogroup", { name: "Jules Primary provider config mode" })).toBeNull();

    rerender(
      <ProviderInstanceCard
        providerConfigId="mockup-cli"
        provider={{
          provider: "mockup-cli",
          name: "Mockup CLI",
          apiKey: "",
          mountAuth: false,
          authPath: "",
          authType: "apiKey",
          providerConfigMode: "none",
          providerConfigPath: "",
        }}
        providerModel="default"
        dockerExecutionEnabled={false}
        onUpdate={onUpdate}
      />
    );

    expect(screen.queryByRole("radiogroup", { name: "Mockup CLI provider config mode" })).toBeNull();
  });

  it("names generated config previews by provider instance", () => {
    const provider: SystemProviderConfig = {
      provider: "opencode",
      name: "OpenCode Preview",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "ollama",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="opencode-preview"
        provider={provider}
        providerModel="ollama/glm-4.7-flash"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
      />
    );

    expect(screen.getByRole("region", { name: "OpenCode Preview generated OpenCode config preview" })).toBeDefined();
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

  it("shows a clean, deduped model list with no provider prefix when no API provider is selected yet", async () => {
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

    const trigger = await screen.findByText("Leave empty to use the agent's selected model");
    fireEvent.click(trigger.closest("button")!);

    // Bare model names only, no "<provider> — <model>" prefix.
    expect(await screen.findByText("Claude Sonnet 4.5")).toBeDefined();
    expect(screen.queryByText("Anthropic — Claude Sonnet 4.5")).toBeNull();
    expect(screen.queryByText("OpenAI — GPT-5.5")).toBeNull();

    // openai/gpt-5.5 and 302ai/gpt-5.5 share the same bare model id — only one row, not one per reseller.
    expect(screen.getAllByText("GPT-5.5")).toHaveLength(1);

    // 302.AI is a reseller, not a primary model-creator provider — its reseller-only model
    // shouldn't show up in the default (no provider selected) list at all.
    expect(screen.queryByText("Gizmo X")).toBeNull();

    // Alibaba alone contributes 60 fixture models (sorts first alphabetically among primary
    // providers) — it must not crowd out every other provider's models via a render cap.
    expect(screen.getByText("Qwen Model 0")).toBeDefined();
    expect(screen.getByText("Claude Sonnet 4.5")).toBeDefined();
    expect(screen.getByText("GPT-5.5")).toBeDefined();

    fireEvent.click(screen.getByText("GPT-5.5"));
    expect(onUpdate).toHaveBeenCalledWith({ customModel: "gpt-5.5" });
  });

  it("caps the visible model list so it never dumps the entire catalogue into the DOM at once", async () => {
    const bigCatalog = Array.from({ length: 200 }, (_, i) => ({
      id: `bigprovider/model-${i}`,
      providerId: "bigprovider",
      providerName: "Big Provider",
      modelId: `model-${i}`,
      modelName: `Model ${i}`,
    }));
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/model-catalog/providers") {
        return Promise.resolve({ ok: true, json: async () => PROVIDER_CATALOG });
      }
      if (url === "/api/model-catalog") {
        return Promise.resolve({ ok: true, json: async () => bigCatalog });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    }) as any;

    const provider: SystemProviderConfig = {
      provider: "codex",
      name: "Codex Gateway",
      apiKey: "test-key",
      mountAuth: false,
      authPath: "",
      authType: "apiKey",
      // Provider-filtered browsing shows a specific provider's full list regardless of the
      // primary-provider allowlist, so this is the path that needs the render cap.
      customProviderId: "bigprovider",
    };

    render(
      <ProviderInstanceCard
        providerConfigId="test-id"
        provider={provider}
        providerModel="gpt-5.5"
        dockerExecutionEnabled={false}
        onUpdate={vi.fn()}
      />
    );

    const trigger = await screen.findByText("Leave empty to use the agent's selected model");
    fireEvent.click(trigger.closest("button")!);

    await screen.findByText("Model 0");
    expect(screen.getAllByText(/^Model \d+$/).length).toBeLessThan(200);
  });
});
