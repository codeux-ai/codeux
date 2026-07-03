import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Terminal, Trash2 } from "lucide-preact";
import { PillChoiceGroup, ProviderLogo, Row, SelectInput, TextInput, Toggle } from "./SettingsFormFields.js";
import { getProviderDefaultAuthPath, getProviderTypeLabel } from "../../lib/settings-view-models.js";
import { TerminalLoginModal } from "./TerminalLoginModal.js";
import { ModelCombobox } from "../ui/ModelCombobox.js";
import { ProviderCombobox } from "../ui/ProviderCombobox.js";
import {
  buildOpenCodeConfigPreview,
  buildQwenSettingsPreview,
  getQwenEndpointForRegion,
  openCodeAuthModeOptions,
  qwenAuthModeOptions,
  qwenProtocolOptions,
  qwenRegionOptions,
  splitOpenCodeModel,
  type SystemProviderConfig,
  sanitizeSystemProviderConfig,
} from "../../lib/provider-runtime-preview.js";

/**
 * Renders the full credential/auth configuration for a single named provider instance.
 * Shared verbatim between the Settings → Integrations detail view and the onboarding
 * "Configure providers" step so the two surfaces never drift.
 */
export const ProviderInstanceCard: FunctionComponent<{
  providerConfigId: string;
  provider: SystemProviderConfig;
  providerModel: string;
  dockerExecutionEnabled: boolean;
  onUpdate: (updates: Partial<SystemProviderConfig>) => void;
  onRemove?: () => void;
  isLast?: boolean;
  enabled?: boolean;
  onToggleEnabled?: (value: boolean) => void;
  index?: number;
  total?: number;
}> = ({ providerConfigId, provider, providerModel, dockerExecutionEnabled, onUpdate, onRemove, isLast = true, enabled, onToggleEnabled, index, total }) => {
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);

  const currentAuthType = provider.authType || (provider.mountAuth ? "localAuth" : "apiKey");
  const providerInstanceLabel = provider.name || providerConfigId;
  const headingId = `provider-instance-${providerConfigId.replace(/\W/g, "-")}-heading`;
  const feedbackId = `${headingId}-feedback`;
  const enabledValue = enabled ?? true;

  useEffect(() => {
    setRemoveArmed(false);
    setFeedback(null);
  }, [providerConfigId]);

  const applyUpdate = (updates: Partial<SystemProviderConfig>, message: string): void => {
    try {
      onUpdate(updates);
      setFeedback({ tone: "warning", message });
    } catch (updateError) {
      setFeedback({
        tone: "error",
        message: updateError instanceof Error ? updateError.message : "Provider setting could not be updated.",
      });
    }
  };

  const applySanitizedUpdate = (updates: Partial<SystemProviderConfig>, message: string): void => {
    applyUpdate(sanitizeSystemProviderConfig({ ...provider, ...updates }), message);
  };

  const updateAuthType = (value: string): void => {
    const authType = value as "apiKey" | "localAuth" | "dashboardAuth";
    const updates: Partial<SystemProviderConfig> = {
      authType,
      mountAuth: authType !== "apiKey",
    };
    if (authType === "dashboardAuth") {
      updates.authPath = `~/.code-ux/credentials/${providerConfigId}`;
    } else if (authType === "localAuth") {
      const existingPath = (provider.authPath || "").includes(".code-ux") ? "" : provider.authPath;
      updates.authPath = existingPath || getProviderDefaultAuthPath(provider.provider);
      if (provider.provider === "qwen-code") {
        updates.qwenAuthMode = "LOCAL_AUTH";
      } else if (provider.provider === "opencode") {
        updates.openCodeAuthMode = "LOCAL_AUTH";
      }
    } else if (authType === "apiKey") {
      if (provider.provider === "qwen-code") {
        updates.qwenAuthMode = "MODEL_PROVIDER";
      } else if (provider.provider === "opencode") {
        updates.openCodeAuthMode = "ENV_KEY";
      }
    }
    applySanitizedUpdate(updates, `${providerInstanceLabel} authentication mode changed locally. Save changes to persist it.`);
  };

  const handleRemove = (): void => {
    if (!removeArmed) {
      setRemoveArmed(true);
      setFeedback({ tone: "warning", message: `Confirm removal of ${providerInstanceLabel}. This stays local until settings are saved.` });
      return;
    }
    try {
      onRemove?.();
      setFeedback({ tone: "success", message: `${providerInstanceLabel} removed locally. Save changes to persist it.` });
    } catch (removeError) {
      setFeedback({
        tone: "error",
        message: removeError instanceof Error ? removeError.message : "Provider instance could not be removed.",
      });
    }
  };

  const feedbackClass = feedback?.tone === "error"
    ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
    : feedback?.tone === "success"
      ? "border-status-green/25 bg-status-green/[0.08] text-status-green"
      : "border-amber-500/25 bg-amber-500/[0.1] text-amber-700 dark:text-amber-200";

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 space-y-3 rounded-[1.45rem] border border-[var(--border-hairline)] bg-[var(--surface-glass)] p-6 shadow-[var(--elevation-base)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
        <div className="flex min-w-0 items-start gap-3">
          {index !== undefined && total !== undefined ? (
            <div className="mt-0.5 flex h-6 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] px-2 font-mono text-[11px] font-bold tracking-widest text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
              {index + 1}<span className="text-slate-400 opacity-60 dark:text-slate-500">/{total}</span>
            </div>
          ) : null}
          <ProviderLogo providerId={provider.provider} />
          <div className="min-w-0">
            <h3 id={headingId} className="break-words text-sm font-semibold text-slate-900 dark:text-white">{providerInstanceLabel}</h3>
            <div className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-400">{getProviderTypeLabel(provider.provider)} instance</div>
          </div>
        </div>
        <div className="flex items-center gap-2">

          {onToggleEnabled ? (
            <label className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500  dark:text-slate-300">
              {enabledValue ? "Enabled" : "Disabled"}
              <Toggle
                aria-label={`Enable ${providerInstanceLabel}`}
                aria-describedby={feedback ? feedbackId : undefined}
                aria-pressed={enabledValue}
                value={enabledValue}
                onChange={(value) => {
                  onToggleEnabled(value);
                  setFeedback({
                    tone: "warning",
                    message: `${providerInstanceLabel} ${value ? "enabled" : "disabled"} locally. Save changes to persist it.`,
                  });
                }}
              />
            </label>
          ) : null}
          {onRemove ? (

            <button
              type="button"
              onClick={handleRemove}
              aria-label={removeArmed ? `Confirm remove ${providerInstanceLabel}` : `Remove ${providerInstanceLabel}`}
              aria-describedby={feedback ? feedbackId : undefined}
              aria-pressed={removeArmed}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
                removeArmed
                  ? "border-status-red/45 bg-status-red text-white"
                  : "border-status-red/20 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.1]"
              }`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {removeArmed ? "Confirm remove" : "Remove"}
            </button>
          ) : null}
        </div>
      </div>

      {feedback ? (
        <div
          id={feedbackId}
          role={feedback.tone === "error" ? "alert" : "status"}
          aria-live={feedback.tone === "error" ? "assertive" : "polite"}
          className={`rounded-xl border px-3 py-2 text-xs font-semibold ${feedbackClass}`}
        >
          {feedback.message}
        </div>
      ) : null}

      <Row label="Display name" description="Used throughout AI Models and runtime route summaries.">
        <TextInput value={provider.name} onChange={(value) => onUpdate({ name: value })} aria-label={`${providerInstanceLabel} display name`} />
      </Row>

      {provider.provider !== "jules" ? (
        <Row label="Authentication mode" description="Choose how this instance authenticates. API key, local copy, or dashboard-guided Docker login.">
          <PillChoiceGroup
            aria-label={`${providerInstanceLabel} authentication mode`}
            value={currentAuthType}
            onChange={updateAuthType}
            options={[
              { value: "apiKey", label: "API Key", hint: "API token override" },
              { value: "localAuth", label: "Local Copy", hint: "Copy host files" },
              { value: "dashboardAuth", label: "Dashboard Login", hint: "Secure dashboard login" },
            ]}
          />
        </Row>
      ) : null}

      {/* API Key Panel */}
      {currentAuthType === "apiKey" && (
        <Row label="API key" description="Stored for this named provider instance.">
          <TextInput value={provider.apiKey} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, apiKey: value }))} aria-label={`${providerInstanceLabel} API key`} mono />
        </Row>
      )}

      {/* Dashboard Auth Panel */}
      {currentAuthType === "dashboardAuth" && (
        <Row label="Dashboard Login" description="Spawns the provider container to log in interactively and save tokens directly to your host.">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              aria-label={`Connect and log in to ${providerInstanceLabel}`}
              aria-haspopup="dialog"
              aria-expanded={showLoginModal}
              aria-busy={showLoginModal}
              aria-describedby={feedback ? feedbackId : undefined}
              className="group inline-flex items-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-xs font-bold text-void-950 hover:bg-signal-400 transition-colors shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900"
            >
              <Terminal className="h-3.5 w-3.5" />
              Connect & Login
            </button>
            <div className="max-w-full overflow-x-auto rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              Path: <span className="font-semibold text-slate-700 dark:text-slate-200">~/.code-ux/credentials/{providerConfigId}</span>
            </div>
          </div>
        </Row>
      )}

      {/* Qwen Config Options */}
      {provider.provider === "qwen-code" && (
        <>
          {currentAuthType === "apiKey" && (
            <>
              <Row label="Authentication sub-mode" description="Configure whether to use Alibaba Cloud Coding Plan or custom modelProviders.">
                  <PillChoiceGroup
                    aria-label={`${providerInstanceLabel} Qwen authentication sub-mode`}
                    value={provider.qwenAuthMode || "MODEL_PROVIDER"}
                  onChange={(value) => {
                    const updates: Partial<SystemProviderConfig> = {
                      qwenAuthMode: value as SystemProviderConfig["qwenAuthMode"],
                      ...(value === "MODEL_PROVIDER" ? {
                        apiKey: provider.apiKey || "your_api_key",
                        qwenBaseUrl: provider.qwenBaseUrl || "http://127.0.0.1:11434/v1",
                        qwenEnvKey: provider.qwenEnvKey || "OLLAMA_API_KEY",
                        qwenModelId: provider.qwenModelId || "glm-4.7-flash",
                        qwenProtocol: "openai" as const,
                      } : {}),
                    };
                    onUpdate(sanitizeSystemProviderConfig({ ...provider, ...updates }));
                  }}
                  options={qwenAuthModeOptions.filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "ALIBABA_CODING_PLAN" && (
                <>
                  <Row label="Coding Plan region" description="Controls the dedicated Alibaba Cloud Coding Plan endpoint.">
                      <SelectInput
                        value={provider.qwenRegion || "international"}
                        aria-label={`${providerInstanceLabel} Coding Plan region`}
                      onChange={(value) => onUpdate({
                        qwenRegion: value as "china" | "international",
                        qwenBaseUrl: getQwenEndpointForRegion(value),
                        qwenEnvKey: "BAILIAN_CODING_PLAN_API_KEY",
                        qwenProtocol: "openai",
                      })}
                      options={qwenRegionOptions}
                    />
                  </Row>
                  <Row label="Coding Plan endpoint" description="Generated from the selected region and written into Qwen modelProviders.">
                      <TextInput value={getQwenEndpointForRegion(provider.qwenRegion)} onChange={() => undefined} aria-label={`${providerInstanceLabel} Coding Plan endpoint`} disabled mono />
                  </Row>
                </>
              )}

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "MODEL_PROVIDER" && (
                <>
                  <Row label="API provider" description="Search the catalogue or type a custom provider name. Picking a known provider fills in its base URL below.">
                      <ProviderCombobox
                        value={provider.qwenApiProviderId || ""}
                        aria-label={`${providerInstanceLabel} API provider`}
                      onChange={(value, apiBaseUrl) => onUpdate({
                        qwenApiProviderId: value || undefined,
                        ...(apiBaseUrl ? { qwenBaseUrl: apiBaseUrl } : {}),
                      })}
                    />
                  </Row>
                  <Row label="Provider protocol" description="Qwen Code groups modelProviders by API protocol.">
                      <SelectInput
                        value={provider.qwenProtocol || "openai"}
                        aria-label={`${providerInstanceLabel} provider protocol`}
                      onChange={(value) => onUpdate({ qwenProtocol: value as "openai" | "anthropic" | "gemini" })}
                      options={qwenProtocolOptions}
                    />
                  </Row>
                  <Row label="Environment key" description="Variable name Qwen reads for this instance's API key.">
                      <TextInput value={provider.qwenEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ qwenEnvKey: value })} aria-label={`${providerInstanceLabel} environment key`} mono />
                  </Row>
                  <Row label="Model id" description="The bare model identifier registered in Qwen Code modelProviders (e.g. glm-4.7-flash, no provider prefix) and shown on the AI Models page. Search the catalogue or type a custom id.">
                      <ModelCombobox
                        value={provider.qwenModelId || providerModel || "glm-4.7-flash"}
                        onChange={(value) => onUpdate({ qwenModelId: value })}
                        providerId={provider.qwenApiProviderId}
                        aria-label={`${providerInstanceLabel} model id`}
                      />
                  </Row>
                  <Row label="Base URL" description="OpenAI-compatible, Anthropic, Gemini, or local endpoint used by this model entry. Type a custom URL/IP or pick a provider above.">
                      <TextInput value={provider.qwenBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ qwenBaseUrl: value })} aria-label={`${providerInstanceLabel} base URL`} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label="Qwen auth path" description="Usually `~/.qwen`; contains settings.json, .env, and cached OAuth state.">
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} Qwen auth path`} mono />
            </Row>
          )}

          <Row label="Generated settings preview" description="Masked Qwen settings.json fragment produced for Docker runtime." last={isLast}>
              <pre role="region" aria-label={`${providerInstanceLabel} generated Qwen settings preview`} className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {buildQwenSettingsPreview(provider, providerModel, dockerExecutionEnabled)}
            </pre>
          </Row>
        </>
      )}

      {/* OpenCode Config Options */}
      {provider.provider === "opencode" && (
        <>
          {currentAuthType === "apiKey" && (
            <>
              <Row label="Authentication sub-mode" description="Configure whether to use custom model endpoint or standard environment key.">
                  <PillChoiceGroup
                    aria-label={`${providerInstanceLabel} OpenCode authentication sub-mode`}
                    value={provider.openCodeAuthMode || "ENV_KEY"}
                  onChange={(value) => {
                    const updates: Partial<SystemProviderConfig> = {
                      openCodeAuthMode: value as SystemProviderConfig["openCodeAuthMode"],
                      ...(value === "CUSTOM_PROVIDER" ? {
                        apiKey: provider.apiKey || "your_api_key",
                        openCodeProviderId: provider.openCodeProviderId || "ollama",
                        openCodeModelId: provider.openCodeModelId || "glm-4.7-flash",
                        openCodeBaseUrl: provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1",
                        openCodeEnvKey: provider.openCodeEnvKey || "OLLAMA_API_KEY",
                        openCodePackage: provider.openCodePackage || "@ai-sdk/openai-compatible",
                      } : {}),
                    };
                    onUpdate(sanitizeSystemProviderConfig({ ...provider, ...updates }));
                  }}
                  options={openCodeAuthModeOptions.filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.openCodeAuthMode || "ENV_KEY") !== "LOCAL_AUTH" && (
                <>
                  <Row label="Provider id" description="The provider segment in OpenCode's `provider/model` selector. Search the catalogue or type a custom id. Picking a known provider fills in its base URL below.">
                      <ProviderCombobox
                        value={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId}
                        aria-label={`${providerInstanceLabel} provider id`}
                      onChange={(value, apiBaseUrl) => onUpdate({
                        openCodeProviderId: value,
                        ...(apiBaseUrl ? { openCodeBaseUrl: apiBaseUrl } : {}),
                      })}
                    />
                  </Row>
                  <Row label="Environment key" description="Host environment variable to import when the stored API key is empty. Runtime config maps it to OPENCODE_API_KEY.">
                      <TextInput value={provider.openCodeEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ openCodeEnvKey: value })} aria-label={`${providerInstanceLabel} environment key`} mono />
                  </Row>
                </>
              )}

              {provider.openCodeAuthMode === "CUSTOM_PROVIDER" && (
                <>
                  <Row label="Model id" description="The bare model segment registered under the provider above (OpenCode combines them as provider/model itself). Search the catalogue or type a custom id.">
                      <ModelCombobox
                        value={provider.openCodeModelId || splitOpenCodeModel(providerModel).modelId}
                        onChange={(value) => onUpdate({ openCodeModelId: value })}
                        providerId={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId}
                        aria-label={`${providerInstanceLabel} model id`}
                      />
                  </Row>
                  <Row label="Provider package" description="OpenCode provider adapter package. OpenAI-compatible endpoints use the AI SDK compatible adapter.">
                      <TextInput value={provider.openCodePackage || "@ai-sdk/openai-compatible"} onChange={(value) => onUpdate({ openCodePackage: value })} aria-label={`${providerInstanceLabel} provider package`} mono />
                  </Row>
                  <Row label="Base URL" description="OpenAI-compatible endpoint for OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, or a private gateway. Type a custom URL/IP or pick a provider above.">
                      <TextInput value={provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ openCodeBaseUrl: value })} aria-label={`${providerInstanceLabel} base URL`} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label="OpenCode auth path" description="Usually `~/.local/share/opencode`; contains auth.json created by `/connect` or `opencode auth login`.">
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} OpenCode auth path`} mono />
            </Row>
          )}

          <Row label="Generated config preview" description="Masked OpenCode config materialized from OPENCODE_CONFIG_CONTENT for host and Docker runs." last={isLast}>
              <pre role="region" aria-label={`${providerInstanceLabel} generated OpenCode config preview`} className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {buildOpenCodeConfigPreview(provider, providerModel, dockerExecutionEnabled)}
            </pre>
          </Row>
        </>
      )}

      {/* Claude and Codex Custom Base URL */}
      {(provider.provider === "claude-code" || provider.provider === "codex") && currentAuthType !== "dashboardAuth" && (
        <>
          {currentAuthType === "localAuth" && (
            <Row label="Auth path" description="Host path copied into the Docker runtime for this exact provider instance.">
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} auth path`} mono />
            </Row>
          )}
          <Row
            label="API provider"
            description="Search the catalogue or type a custom provider name (self-hosted gateway, private proxy, etc.). Picking a known provider fills in the base URL below."
          >
              <ProviderCombobox
                value={provider.customProviderId || ""}
                aria-label={`${providerInstanceLabel} API provider`}
              onChange={(value, apiBaseUrl) => onUpdate({
                customProviderId: value || undefined,
                ...(apiBaseUrl ? { customBaseUrl: apiBaseUrl } : {}),
              })}
              disabled={currentAuthType !== "apiKey"}
              placeholder="Leave empty to use the default endpoint"
            />
          </Row>
          <Row
            label={provider.provider === "claude-code" ? "Anthropic base URL" : "OpenAI base URL"}
            description={
              provider.provider === "claude-code"
                ? "Override ANTHROPIC_BASE_URL. Claude Code speaks the Anthropic Messages API and appends /v1/messages itself, so use an Anthropic-compatible endpoint WITHOUT a /v1 suffix — for OpenRouter that is https://openrouter.ai/api (not .../api/v1, which is the OpenAI URL used by Codex/Qwen). The API key is sent as a Bearer token. Leave empty to use the default Anthropic API. Type a custom URL/IP or pick a provider above."
                : "Override OPENAI_BASE_URL. Route Codex through a custom OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1. Leave empty to use the default OpenAI API. Type a custom URL/IP or pick a provider above."
            }
          >
              <TextInput value={provider.customBaseUrl || ""} onChange={(value) => onUpdate({ customBaseUrl: value || undefined })} aria-label={`${providerInstanceLabel} custom base URL`} disabled={currentAuthType !== "apiKey"} mono />
          </Row>
          <Row
            label="Custom model"
            description={
              provider.provider === "claude-code"
                ? "Bare model slug sent to the gateway (e.g. claude-sonnet-4-5, no provider prefix — the provider above already determines the endpoint). Applied to every Claude Code tier so background calls hit the same model. Leave empty to use the agent's selected model. Search the catalogue or type a custom slug."
                : "Bare model slug sent to the gateway (e.g. gpt-5-codex, no provider prefix — the provider above already determines the endpoint). Overrides the agent's selected model. Leave empty to use the agent's selected model. Search the catalogue or type a custom slug."
            }
            last={isLast}
          >
            <ModelCombobox
              value={provider.customModel || ""}
              onChange={(value) => onUpdate({ customModel: value || undefined })}
              disabled={currentAuthType !== "apiKey"}
                placeholder="Leave empty to use the agent's selected model"
                providerId={provider.customProviderId}
                aria-label={`${providerInstanceLabel} custom model`}
              />
          </Row>
        </>
      )}

      {/* Standard Local Auth Option for Generic CLI Providers */}
      {provider.provider !== "jules" && provider.provider !== "qwen-code" && provider.provider !== "opencode" && provider.provider !== "claude-code" && provider.provider !== "codex" && currentAuthType === "localAuth" && (
        <Row label="Auth path" description="Host path copied into the Docker runtime for this exact provider instance." last={isLast}>
            <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} auth path`} mono />
        </Row>
      )}

      {provider.provider === "jules" && (
        <Row label="Jules auth mode" description="Jules uses API keys only and does not support a local auth mount." last={isLast}>
          <div className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">API key only</div>
        </Row>
      )}

      {/* Modal Render */}
      {showLoginModal && (
        <TerminalLoginModal
          providerConfigId={providerConfigId}
          providerId={provider.provider}
          providerName={getProviderTypeLabel(provider.provider)}
          onClose={() => setShowLoginModal(false)}
          onSuccess={() => {
            // Trigger an update with a new lastLoginAt timestamp to make the form dirty so the user can Save Changes
            onUpdate({ lastLoginAt: Date.now() });
            setFeedback({ tone: "success", message: `${providerInstanceLabel} dashboard login completed. Save changes to persist the login timestamp.` });
          }}
        />
      )}
      </section>
  );
};
