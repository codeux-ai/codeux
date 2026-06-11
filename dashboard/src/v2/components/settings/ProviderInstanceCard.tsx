import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Terminal, Trash2 } from "lucide-preact";
import { PillChoiceGroup, ProviderLogo, Row, SelectInput, TextInput, Toggle } from "./SettingsFormFields.js";
import { getProviderDefaultAuthPath, getProviderTypeLabel } from "../../lib/settings-view-models.js";
import { TerminalLoginModal } from "./TerminalLoginModal.js";
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

  const currentAuthType = provider.authType || (provider.mountAuth ? "localAuth" : "apiKey");

  return (
    <div className="space-y-3 rounded-[1.45rem] border border-black/[0.06] bg-white/84 p-6 shadow-[0_16px_38px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
        <div className="flex items-start gap-3">
          {index !== undefined && total !== undefined ? (
            <div className="mt-0.5 flex h-6 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] px-2 font-mono text-[11px] font-bold tracking-widest text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">
              {index + 1}<span className="text-slate-400 opacity-60 dark:text-slate-500">/{total}</span>
            </div>
          ) : null}
          <ProviderLogo providerId={provider.provider} />
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
            <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{getProviderTypeLabel(provider.provider)} instance</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {onToggleEnabled ? (
            <label className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
              Enabled
              <Toggle value={enabled ?? true} onChange={() => onToggleEnabled(!(enabled ?? true))} />
            </label>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/[0.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-status-red"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <Row label="Display name" description="Used throughout AI Models and runtime route summaries.">
        <TextInput value={provider.name} onChange={(value) => onUpdate({ name: value })} />
      </Row>

      {provider.provider !== "jules" ? (
        <Row label="Authentication mode" description="Choose how this instance authenticates. API key, local copy, or dashboard-guided Docker login.">
          <PillChoiceGroup
            value={currentAuthType}
            onChange={(value) => {
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
              onUpdate(updates);
            }}
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
          <TextInput value={provider.apiKey} onChange={(value) => onUpdate({ apiKey: value })} mono />
        </Row>
      )}

      {/* Dashboard Auth Panel */}
      {currentAuthType === "dashboardAuth" && (
        <Row label="Dashboard Login" description="Spawns the provider container to log in interactively and save tokens directly to your host.">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              className="group inline-flex items-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-xs font-bold text-void-950 hover:bg-signal-400 transition-colors shadow-lg active:scale-95"
            >
              <Terminal className="h-3.5 w-3.5" />
              Connect & Login
            </button>
            <div className="rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[11px] font-mono text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
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
                  value={provider.qwenAuthMode || "MODEL_PROVIDER"}
                  onChange={(value) => onUpdate({
                    qwenAuthMode: value as SystemProviderConfig["qwenAuthMode"],
                    ...(value === "MODEL_PROVIDER" ? {
                      apiKey: provider.apiKey || "your_api_key",
                      qwenBaseUrl: provider.qwenBaseUrl || "http://127.0.0.1:11434/v1",
                      qwenEnvKey: provider.qwenEnvKey || "OLLAMA_API_KEY",
                      qwenModelId: provider.qwenModelId || "glm-4.7-flash",
                      qwenProtocol: "openai" as const,
                    } : {}),
                  })}
                  options={qwenAuthModeOptions.filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "ALIBABA_CODING_PLAN" && (
                <>
                  <Row label="Coding Plan region" description="Controls the dedicated Alibaba Cloud Coding Plan endpoint.">
                    <SelectInput
                      value={provider.qwenRegion || "international"}
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
                    <TextInput value={getQwenEndpointForRegion(provider.qwenRegion)} onChange={() => undefined} disabled mono />
                  </Row>
                </>
              )}

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "MODEL_PROVIDER" && (
                <>
                  <Row label="Provider protocol" description="Qwen Code groups modelProviders by API protocol.">
                    <SelectInput
                      value={provider.qwenProtocol || "openai"}
                      onChange={(value) => onUpdate({ qwenProtocol: value as "openai" | "anthropic" | "gemini" })}
                      options={qwenProtocolOptions}
                    />
                  </Row>
                  <Row label="Environment key" description="Variable name Qwen reads for this instance's API key.">
                    <TextInput value={provider.qwenEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ qwenEnvKey: value })} mono />
                  </Row>
                  <Row label="Model id" description="The custom model registered in Qwen Code modelProviders and shown on the AI Models page.">
                    <TextInput value={provider.qwenModelId || providerModel || "glm-4.7-flash"} onChange={(value) => onUpdate({ qwenModelId: value })} mono />
                  </Row>
                  <Row label="Base URL" description="OpenAI-compatible, Anthropic, Gemini, or local endpoint used by this model entry.">
                    <TextInput value={provider.qwenBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ qwenBaseUrl: value })} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label="Qwen auth path" description="Usually `~/.qwen`; contains settings.json, .env, and cached OAuth state.">
              <TextInput value={provider.authPath} onChange={(value) => onUpdate({ authPath: value })} mono />
            </Row>
          )}

          <Row label="Generated settings preview" description="Masked Qwen settings.json fragment produced for Docker runtime." last={isLast}>
            <pre className="max-h-72 min-w-[280px] overflow-auto rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
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
                  value={provider.openCodeAuthMode || "ENV_KEY"}
                  onChange={(value) => onUpdate({
                    openCodeAuthMode: value as SystemProviderConfig["openCodeAuthMode"],
                    ...(value === "CUSTOM_PROVIDER" ? {
                      apiKey: provider.apiKey || "your_api_key",
                      openCodeProviderId: provider.openCodeProviderId || "ollama",
                      openCodeModelId: provider.openCodeModelId || "glm-4.7-flash",
                      openCodeBaseUrl: provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1",
                      openCodeEnvKey: provider.openCodeEnvKey || "OLLAMA_API_KEY",
                      openCodePackage: provider.openCodePackage || "@ai-sdk/openai-compatible",
                    } : {}),
                  })}
                  options={openCodeAuthModeOptions.filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.openCodeAuthMode || "ENV_KEY") !== "LOCAL_AUTH" && (
                <>
                  <Row label="Provider id" description="The provider segment in OpenCode's `provider/model` selector.">
                    <TextInput value={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId} onChange={(value) => onUpdate({ openCodeProviderId: value })} mono />
                  </Row>
                  <Row label="Environment key" description="Host environment variable to import when the stored API key is empty. Runtime config maps it to OPENCODE_API_KEY.">
                    <TextInput value={provider.openCodeEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ openCodeEnvKey: value })} mono />
                  </Row>
                </>
              )}

              {provider.openCodeAuthMode === "CUSTOM_PROVIDER" && (
                <>
                  <Row label="Model id" description="The model segment registered under the custom provider.">
                    <TextInput value={provider.openCodeModelId || splitOpenCodeModel(providerModel).modelId} onChange={(value) => onUpdate({ openCodeModelId: value })} mono />
                  </Row>
                  <Row label="Provider package" description="OpenCode provider adapter package. OpenAI-compatible endpoints use the AI SDK compatible adapter.">
                    <TextInput value={provider.openCodePackage || "@ai-sdk/openai-compatible"} onChange={(value) => onUpdate({ openCodePackage: value })} mono />
                  </Row>
                  <Row label="Base URL" description="OpenAI-compatible endpoint for OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, or a private gateway.">
                    <TextInput value={provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ openCodeBaseUrl: value })} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label="OpenCode auth path" description="Usually `~/.local/share/opencode`; contains auth.json created by `/connect` or `opencode auth login`.">
              <TextInput value={provider.authPath} onChange={(value) => onUpdate({ authPath: value })} mono />
            </Row>
          )}

          <Row label="Generated config preview" description="Masked OpenCode config materialized from OPENCODE_CONFIG_CONTENT for host and Docker runs." last={isLast}>
            <pre className="max-h-72 min-w-[280px] overflow-auto rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
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
              <TextInput value={provider.authPath} onChange={(value) => onUpdate({ authPath: value })} mono />
            </Row>
          )}
          <Row
            label={provider.provider === "claude-code" ? "Anthropic base URL" : "OpenAI base URL"}
            description={
              provider.provider === "claude-code"
                ? "Override ANTHROPIC_BASE_URL. Claude Code speaks the Anthropic Messages API and appends /v1/messages itself, so use an Anthropic-compatible endpoint WITHOUT a /v1 suffix — for OpenRouter that is https://openrouter.ai/api (not .../api/v1, which is the OpenAI URL used by Codex/Qwen). The API key is sent as a Bearer token. Leave empty to use the default Anthropic API."
                : "Route Codex through a custom OpenAI-compatible endpoint, e.g. https://openrouter.ai/api/v1. Leave empty to use the default OpenAI API."
            }
          >
            <TextInput value={provider.customBaseUrl || ""} onChange={(value) => onUpdate({ customBaseUrl: value || undefined })} mono />
          </Row>
          <Row
            label="Custom model"
            description={
              provider.provider === "claude-code"
                ? "Model slug sent to the gateway (e.g. anthropic/claude-sonnet-4.5). Applied to every Claude Code tier so background calls hit the same model. Leave empty to use the agent's selected model."
                : "The full model slug used by the endpoint (e.g. \"openai/gpt-4o\" for OpenRouter). Overrides the agent's selected model. Leave empty to use the agent's selected model."
            }
            last={isLast}
          >
            <TextInput value={provider.customModel || ""} onChange={(value) => onUpdate({ customModel: value || undefined })} mono />
          </Row>
        </>
      )}

      {/* Standard Local Auth Option for Generic CLI Providers */}
      {provider.provider !== "jules" && provider.provider !== "qwen-code" && provider.provider !== "opencode" && provider.provider !== "claude-code" && provider.provider !== "codex" && currentAuthType === "localAuth" && (
        <Row label="Auth path" description="Host path copied into the Docker runtime for this exact provider instance." last={isLast}>
          <TextInput value={provider.authPath} onChange={(value) => onUpdate({ authPath: value })} mono />
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
          }}
        />
      )}
    </div>
  );
};
