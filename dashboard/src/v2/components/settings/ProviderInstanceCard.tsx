import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Check, Terminal, Trash2, X } from "lucide-preact";
import { PillChoiceGroup, ProviderLogo, Row, SecretInput, SelectInput, TextInput, Toggle } from "./SettingsFormFields.js";
import { getProviderDefaultAuthPath, getProviderInstanceTypeDescription, getProviderTypeLabel } from "../../lib/settings-view-models.js";
import { LocalFilePickerField } from "./LocalFilePickerField.js";
import { TerminalLoginModal } from "./TerminalLoginModal.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { ModelCombobox } from "../ui/ModelCombobox.js";
import { ProviderCombobox } from "../ui/ProviderCombobox.js";
import {
  buildOpenCodeConfigPreview,
  buildQwenSettingsPreview,
  getQwenEndpointForRegion,
  getOpenCodeAuthModeOptions,
  getQwenAuthModeOptions,
  getQwenProtocolOptions,
  getQwenRegionOptions,
  getProviderStandardConfigPath,
  normalizeProviderConfigSelection,
  splitOpenCodeModel,
  type SystemProviderConfig,
  type ProviderConfigMode,
  sanitizeSystemProviderConfig,
  supportsProviderConfigFile,
} from "../../lib/provider-runtime-preview.js";
import { getProviderLifecycleMessage, isDeprecatedProvider } from "../../lib/provider-lifecycle.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../i18n/messages/settings-integrations.js";

const getProviderConfigHelperTextKey = (providerType: SystemProviderConfig["provider"]):
  | "selectCodexConfig"
  | "selectGeminiConfig"
  | "selectClaudeConfig"
  | "selectQwenConfig"
  | "selectOpenCodeConfig"
  | "selectAntigravityConfig"
  | "selectProviderConfig" => {
  switch (providerType) {
    case "codex":
      return "selectCodexConfig";
    case "gemini":
      return "selectGeminiConfig";
    case "claude-code":
      return "selectClaudeConfig";
    case "qwen-code":
      return "selectQwenConfig";
    case "opencode":
      return "selectOpenCodeConfig";
    case "antigravity":
      return "selectAntigravityConfig";
    default:
      return "selectProviderConfig";
  }
};

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
  onRemove?: () => void | Promise<void>;
  isLast?: boolean;
  enabled?: boolean;
  onToggleEnabled?: (value: boolean) => void;
  index?: number;
  total?: number;
}> = ({ providerConfigId, provider, providerModel, dockerExecutionEnabled, onUpdate, onRemove, isLast = true, enabled, onToggleEnabled, index, total }) => {
  const { locale, translate: t } = useDashboardI18n();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [removePending, setRemovePending] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "warning" | "error"; message: string } | null>(null);
  const removeButtonRef = useRef<HTMLButtonElement | null>(null);
  const cancelRemoveButtonRef = useRef<HTMLButtonElement | null>(null);

  const currentAuthType = provider.authType || (provider.mountAuth ? "localAuth" : "apiKey");
  const providerInstanceLabel = provider.name || providerConfigId;
  const headingId = `provider-instance-${providerConfigId.replace(/\W/g, "-")}-heading`;
  const feedbackId = `${headingId}-feedback`;
  const customEndpointDisabledReasonId = `${headingId}-custom-endpoint-disabled`;
  const enabledValue = enabled ?? true;
  const deprecated = isDeprecatedProvider(provider.provider);
  const customEndpointDisabled = currentAuthType !== "apiKey";
  const providerConfigSupported = supportsProviderConfigFile(provider.provider);
  const standardProviderConfigPath = getProviderStandardConfigPath(provider.provider);
  const normalizedProviderConfig = normalizeProviderConfigSelection(
    provider.provider,
    provider.providerConfigMode,
    provider.providerConfigPath,
  );
  const currentProviderConfigMode = normalizedProviderConfig.providerConfigMode;

  useEffect(() => {
    setRemoveArmed(false);
    setRemovePending(false);
    setFeedback(null);
  }, [providerConfigId]);

  useEffect(() => {
    if (removeArmed) {
      cancelRemoveButtonRef.current?.focus();
    }
  }, [removeArmed]);

  const applyUpdate = (updates: Partial<SystemProviderConfig>, message: string): void => {
    try {
      onUpdate(updates);
      setFeedback({ tone: "warning", message });
      setRemoveArmed(false);
    } catch (updateError) {
      setFeedback({
        tone: "error",
        message: updateError instanceof Error ? updateError.message : t(settingsIntegrationsMessages, "providerSettingsUpdateFallback"),
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
    applySanitizedUpdate(updates, providerInstanceLabel + t(settingsIntegrationsMessages, "authModeChanged"));
  };

  const updateProviderConfigMode = (value: string): void => {
    const providerConfigMode = value as ProviderConfigMode;
    const providerConfigPath = providerConfigMode === "file"
      ? (provider.providerConfigPath?.trim() || standardProviderConfigPath)
      : undefined;
    const updates = normalizeProviderConfigSelection(provider.provider, providerConfigMode, providerConfigPath);
    applySanitizedUpdate(updates, providerInstanceLabel + t(settingsIntegrationsMessages, "configModeChanged"));
  };

  const updateProviderConfigPath = (value: string): void => {
    applySanitizedUpdate({
      providerConfigMode: "file",
      providerConfigPath: value,
    }, providerInstanceLabel + t(settingsIntegrationsMessages, "configFileChanged"));
  };

  const armRemove = (): void => {
    if (removePending) {
      return;
    }
    setRemoveArmed(true);
    setFeedback({ tone: "warning", message: t(settingsIntegrationsMessages, "removalArmedPrefix") + providerInstanceLabel + t(settingsIntegrationsMessages, "removalArmedSuffix") });
  };

  const cancelRemove = (): void => {
    if (removePending) {
      return;
    }
    setRemoveArmed(false);
    setFeedback({ tone: "warning", message: t(settingsIntegrationsMessages, "removalCancelledPrefix") + providerInstanceLabel + t(settingsIntegrationsMessages, "removalCancelledSuffix") });
    removeButtonRef.current?.focus();
  };

  const focusRemovalFallback = (): void => {
    window.requestAnimationFrame(() => {
      const fallback = document.querySelector<HTMLElement>("#settings-active-category-panel, [data-settings-provider-action-fallback], main, #root");
      if (fallback) {
        if (fallback.tabIndex < 0) {
          fallback.tabIndex = -1;
        }
        fallback.focus({ preventScroll: true });
      }
    });
  };

  const confirmRemove = async (): Promise<void> => {
    if (removePending) {
      return;
    }
    setRemovePending(true);
    setFeedback({ tone: "warning", message: t(settingsIntegrationsMessages, "removingLocallyPrefix") + providerInstanceLabel + t(settingsIntegrationsMessages, "removingLocallySuffix") });
    try {
      await onRemove?.();
      setFeedback({ tone: "success", message: t(settingsIntegrationsMessages, "removedLocallyPrefix") + providerInstanceLabel + t(settingsIntegrationsMessages, "removedLocallySuffix") });
      focusRemovalFallback();
    } catch (removeError) {
      setFeedback({
        tone: "error",
        message: removeError instanceof Error ? removeError.message : t(settingsIntegrationsMessages, "providerRemoveFallback"),
      });
      setRemovePending(false);
      removeButtonRef.current?.focus();
    }
  };

  const feedbackStatus = feedback?.tone === "error"
    ? "error"
    : feedback?.tone === "success"
      ? "success"
      : removePending
        ? "pending"
        : "warning";

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
            <div className="mt-1 break-words text-[11px] text-slate-500 dark:text-slate-400">{getProviderInstanceTypeDescription(provider.provider, locale)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deprecated ? (
            <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">{t(settingsIntegrationsMessages, "deprecated")}</span>
          ) : null}

          {onToggleEnabled ? (
            <label className="flex items-center gap-2 rounded-full border border-black/[0.06] bg-black/[0.02] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500  dark:text-slate-300">
              {t(settingsIntegrationsMessages, enabledValue ? "enabled" : "disabled")}
              <Toggle
                aria-label={t(settingsIntegrationsMessages, "enableProviderPrefix") + providerInstanceLabel}
                aria-describedby={feedback ? feedbackId : undefined}
                aria-pressed={enabledValue}
                value={enabledValue}
                onChange={(value) => {
                  try {
                    onToggleEnabled(value);
                    setRemoveArmed(false);
                    setFeedback({
                      tone: "warning",
                      message: providerInstanceLabel + t(settingsIntegrationsMessages, value ? "enabledLocally" : "disabledLocally"),
                    });
                  } catch (toggleError) {
                    setFeedback({
                      tone: "error",
                      message: toggleError instanceof Error ? toggleError.message : t(settingsIntegrationsMessages, "providerEnabledUpdateFallback"),
                    });
                  }
                }}
              />
            </label>
          ) : null}
          {onRemove ? (
            <button
              ref={removeButtonRef}
              type="button"
              disabled={removePending}
              onClick={armRemove}
              aria-label={t(settingsIntegrationsMessages, "removeProviderPrefix") + providerInstanceLabel}
              aria-describedby={feedback ? feedbackId : undefined}
              aria-pressed={removeArmed}
              aria-busy={removePending ? "true" : undefined}
              className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/[0.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-status-red hover:bg-status-red/[0.1] focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-void-900"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t(settingsIntegrationsMessages, "remove")}
            </button>
          ) : null}
        </div>
      </div>
      {deprecated ? (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-semibold leading-relaxed text-amber-800 dark:text-amber-200">
          {getProviderLifecycleMessage(provider.provider, locale)}
        </div>
      ) : null}

      {feedback ? (
        <div id={feedbackId}>
          <ActionFeedbackRegion
            status={feedbackStatus}
            message={feedback.message}
            autoDismiss={false}
          />
        </div>
      ) : null}

      {removeArmed ? (
        <div
          role="group"
          aria-label={t(settingsIntegrationsMessages, "confirmRemovalPrefix") + providerInstanceLabel}
          aria-describedby={feedbackId}
          className="rounded-[1.25rem] border border-status-red/25 bg-status-red/[0.06] p-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-bold text-status-red">{t(settingsIntegrationsMessages, "removeProviderPrefix")}{providerInstanceLabel}{t(settingsIntegrationsMessages, "removeLocallySuffix")}</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {t(settingsIntegrationsMessages, "removeDraftDescription")}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                ref={cancelRemoveButtonRef}
                type="button"
                disabled={removePending}
                onClick={cancelRemove}
                className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-black/[0.035] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.12] dark:bg-white/[0.08] dark:text-slate-100 dark:hover:bg-white/[0.12] dark:focus-visible:ring-offset-void-900"
              >
                <X className="h-3.5 w-3.5" />
                {t(settingsIntegrationsMessages, "cancel")}
              </button>
              <button
                type="button"
                disabled={removePending}
                aria-busy={removePending ? "true" : undefined}
                onClick={() => { void confirmRemove(); }}
                className="inline-flex items-center gap-2 rounded-xl bg-status-red px-3 py-2 text-xs font-black text-white hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:ring-offset-void-900"
              >
                <Check className="h-3.5 w-3.5" />
                {removePending ? t(settingsIntegrationsMessages, "removing") : t(settingsIntegrationsMessages, "confirmRemovePrefix") + providerInstanceLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <Row label={t(settingsIntegrationsMessages, "displayName")} description={t(settingsIntegrationsMessages, "displayNameDescription")}>
        <TextInput
          value={provider.name}
          onChange={(value) => applyUpdate({ name: value }, providerInstanceLabel + t(settingsIntegrationsMessages, "displayNameChanged"))}
          aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "displayNameAria")}`}
          aria-describedby={feedback ? feedbackId : undefined}
        />
      </Row>

      {provider.provider !== "jules" ? (
        <Row label={t(settingsIntegrationsMessages, "authenticationMode")} description={t(settingsIntegrationsMessages, "authenticationModeDescription")}>
          <PillChoiceGroup
            aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "authenticationModeAria")}`}
            value={currentAuthType}
            onChange={updateAuthType}
            options={[
              { value: "apiKey", label: t(settingsIntegrationsMessages, "apiKeyMode"), hint: t(settingsIntegrationsMessages, "apiKeyModeHint") },
              { value: "localAuth", label: t(settingsIntegrationsMessages, "localCopyMode"), hint: t(settingsIntegrationsMessages, "localCopyModeHint") },
              { value: "dashboardAuth", label: t(settingsIntegrationsMessages, "dashboardLoginMode"), hint: t(settingsIntegrationsMessages, "dashboardLoginModeHint") },
            ]}
          />
        </Row>
      ) : null}

      {providerConfigSupported ? (
        <>
          <Row label={t(settingsIntegrationsMessages, "providerConfig")} description={t(settingsIntegrationsMessages, "providerConfigDescription")}>
            <PillChoiceGroup
              aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "providerConfig")}`}
              value={currentProviderConfigMode}
              onChange={updateProviderConfigMode}
              options={[
                { value: "none", label: t(settingsIntegrationsMessages, "none"), hint: t(settingsIntegrationsMessages, "noConfigFile") },
                { value: "copyHost", label: t(settingsIntegrationsMessages, "copyHost"), hint: t(settingsIntegrationsMessages, "useStandardPath") },
                { value: "file", label: t(settingsIntegrationsMessages, "file"), hint: t(settingsIntegrationsMessages, "pickFile") },
              ]}
            />
          </Row>

          {currentProviderConfigMode === "copyHost" ? (
            <Row label={t(settingsIntegrationsMessages, "hostConfigPath")} description={t(settingsIntegrationsMessages, "hostConfigPathDescription")}>
              <div className="max-w-full overflow-x-auto rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[11px] font-mono text-slate-600 dark:text-slate-300">
                {standardProviderConfigPath}
              </div>
            </Row>
          ) : null}

          {currentProviderConfigMode === "file" ? (
            <Row label={t(settingsIntegrationsMessages, "configFile")} description={t(settingsIntegrationsMessages, "configFileDescription")}>
              <LocalFilePickerField
                value={normalizedProviderConfig.providerConfigPath}
                onChange={updateProviderConfigPath}
                label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "configFile")}`}
                helperText={t(settingsIntegrationsMessages, getProviderConfigHelperTextKey(provider.provider))}
                placeholder={standardProviderConfigPath}
              />
            </Row>
          ) : null}
        </>
      ) : null}

      {/* API Key Panel */}
      {currentAuthType === "apiKey" && (
        <Row label={t(settingsIntegrationsMessages, "apiKey")} description={t(settingsIntegrationsMessages, "apiKeyDescription")}>
          <SecretInput
            value={provider.apiKey}
            onChange={(value) => applySanitizedUpdate({ apiKey: value }, providerInstanceLabel + t(settingsIntegrationsMessages, "apiKeyChanged"))}
            aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "apiKey")}`}
            aria-describedby={feedback ? feedbackId : undefined}
            showLabel={t(settingsIntegrationsMessages, "showSecretPrefix") + providerInstanceLabel + " " + t(settingsIntegrationsMessages, "apiKey")}
            hideLabel={t(settingsIntegrationsMessages, "hideSecretPrefix") + providerInstanceLabel + " " + t(settingsIntegrationsMessages, "apiKey")}
            mono
          />
        </Row>
      )}

      {/* Dashboard Auth Panel */}
      {currentAuthType === "dashboardAuth" && (
        <Row label={t(settingsIntegrationsMessages, "dashboardLoginMode")} description={t(settingsIntegrationsMessages, "dashboardLoginDescription")}>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowLoginModal(true)}
              aria-label={t(settingsIntegrationsMessages, "connectLoginAriaPrefix") + providerInstanceLabel}
              aria-haspopup="dialog"
              aria-expanded={showLoginModal}
              aria-busy={showLoginModal}
              aria-describedby={feedback ? feedbackId : undefined}
              className="group inline-flex items-center gap-2 rounded-xl bg-signal-500 px-4 py-2.5 text-xs font-bold text-white dark:text-void-950 hover:bg-signal-400 transition-colors shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900"
            >
              <Terminal className="h-3.5 w-3.5" />
              {t(settingsIntegrationsMessages, "connectLogin")}
            </button>
            <div className="max-w-full overflow-x-auto rounded-lg border border-black/[0.06] bg-black/[0.02] px-3 py-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {t(settingsIntegrationsMessages, "path")} <span className="font-semibold text-slate-700 dark:text-slate-200">~/.code-ux/credentials/{providerConfigId}</span>
            </div>
          </div>
        </Row>
      )}

      {/* Qwen Config Options */}
      {provider.provider === "qwen-code" && (
        <>
          {currentAuthType === "apiKey" && (
            <>
              <Row label={t(settingsIntegrationsMessages, "authenticationSubMode")} description={t(settingsIntegrationsMessages, "qwenAuthSubModeDescription")}>
                  <PillChoiceGroup
                    aria-label={`${providerInstanceLabel} Qwen Code ${t(settingsIntegrationsMessages, "authenticationSubMode")}`}
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
                  options={getQwenAuthModeOptions(locale).filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "ALIBABA_CODING_PLAN" && (
                <>
                  <Row label={t(settingsIntegrationsMessages, "codingPlanRegion")} description={t(settingsIntegrationsMessages, "codingPlanRegionDescription")}>
                      <SelectInput
                        value={provider.qwenRegion || "international"}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "codingPlanRegion")}`}
                      onChange={(value) => onUpdate({
                        qwenRegion: value as "china" | "international",
                        qwenBaseUrl: getQwenEndpointForRegion(value),
                        qwenEnvKey: "BAILIAN_CODING_PLAN_API_KEY",
                        qwenProtocol: "openai",
                      })}
                      options={getQwenRegionOptions(locale)}
                    />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "codingPlanEndpoint")} description={t(settingsIntegrationsMessages, "codingPlanEndpointDescription")}>
                      <TextInput value={getQwenEndpointForRegion(provider.qwenRegion)} onChange={() => undefined} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "codingPlanEndpoint")}`} disabled mono />
                  </Row>
                </>
              )}

              {(provider.qwenAuthMode || "MODEL_PROVIDER") === "MODEL_PROVIDER" && (
                <>
                  <Row label={t(settingsIntegrationsMessages, "apiProvider")} description={t(settingsIntegrationsMessages, "apiProviderDescription")}>
                      <ProviderCombobox
                        value={provider.qwenApiProviderId || ""}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "apiProvider")}`}
                      onChange={(value, apiBaseUrl) => onUpdate({
                        qwenApiProviderId: value || undefined,
                        ...(apiBaseUrl ? { qwenBaseUrl: apiBaseUrl } : {}),
                      })}
                    />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "providerProtocol")} description={t(settingsIntegrationsMessages, "providerProtocolDescription")}>
                      <SelectInput
                        value={provider.qwenProtocol || "openai"}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "providerProtocol")}`}
                      onChange={(value) => onUpdate({ qwenProtocol: value as "openai" | "anthropic" | "gemini" })}
                      options={getQwenProtocolOptions(locale)}
                    />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "environmentKey")} description={t(settingsIntegrationsMessages, "qwenEnvironmentKeyDescription")}>
                      <TextInput value={provider.qwenEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ qwenEnvKey: value })} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "environmentKey")}`} mono />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "modelId")} description={t(settingsIntegrationsMessages, "qwenModelIdDescription")}>
                      <ModelCombobox
                        value={provider.qwenModelId || providerModel || "glm-4.7-flash"}
                        onChange={(value) => onUpdate({ qwenModelId: value })}
                        providerId={provider.qwenApiProviderId}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "modelId")}`}
                      />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "baseUrl")} description={t(settingsIntegrationsMessages, "qwenBaseUrlDescription")}>
                      <TextInput value={provider.qwenBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ qwenBaseUrl: value })} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "baseUrl")}`} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label={t(settingsIntegrationsMessages, "qwenAuthPath")} description={t(settingsIntegrationsMessages, "qwenAuthPathDescription")}>
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "qwenAuthPath")}`} mono />
            </Row>
          )}

          <Row label={t(settingsIntegrationsMessages, "generatedSettingsPreview")} description={t(settingsIntegrationsMessages, "generatedQwenSettingsDescription")} last={isLast}>
              <pre role="region" aria-label={`${providerInstanceLabel} Qwen Code ${t(settingsIntegrationsMessages, "generatedSettingsPreview")}`} className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
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
              <Row label={t(settingsIntegrationsMessages, "authenticationSubMode")} description={t(settingsIntegrationsMessages, "openCodeAuthSubModeDescription")}>
                  <PillChoiceGroup
                    aria-label={`${providerInstanceLabel} OpenCode ${t(settingsIntegrationsMessages, "authenticationSubMode")}`}
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
                  options={getOpenCodeAuthModeOptions(locale).filter((opt) => opt.value !== "LOCAL_AUTH")}
                />
              </Row>

              {(provider.openCodeAuthMode || "ENV_KEY") !== "LOCAL_AUTH" && (
                <>
                  <Row label={t(settingsIntegrationsMessages, "providerId")} description={t(settingsIntegrationsMessages, "openCodeProviderIdDescription")}>
                      <ProviderCombobox
                        value={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "providerId")}`}
                      onChange={(value, apiBaseUrl) => onUpdate({
                        openCodeProviderId: value,
                        ...(apiBaseUrl ? { openCodeBaseUrl: apiBaseUrl } : {}),
                      })}
                    />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "environmentKey")} description={t(settingsIntegrationsMessages, "openCodeEnvironmentKeyDescription")}>
                      <TextInput value={provider.openCodeEnvKey || "OLLAMA_API_KEY"} onChange={(value) => onUpdate({ openCodeEnvKey: value })} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "environmentKey")}`} mono />
                  </Row>
                </>
              )}

              {provider.openCodeAuthMode === "CUSTOM_PROVIDER" && (
                <>
                  <Row label={t(settingsIntegrationsMessages, "modelId")} description={t(settingsIntegrationsMessages, "openCodeModelIdDescription")}>
                      <ModelCombobox
                        value={provider.openCodeModelId || splitOpenCodeModel(providerModel).modelId}
                        onChange={(value) => onUpdate({ openCodeModelId: value })}
                        providerId={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId}
                        aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "modelId")}`}
                      />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "providerPackage")} description={t(settingsIntegrationsMessages, "providerPackageDescription")}>
                      <TextInput value={provider.openCodePackage || "@ai-sdk/openai-compatible"} onChange={(value) => onUpdate({ openCodePackage: value })} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "providerPackage")}`} mono />
                  </Row>
                  <Row label={t(settingsIntegrationsMessages, "baseUrl")} description={t(settingsIntegrationsMessages, "openCodeBaseUrlDescription")}>
                      <TextInput value={provider.openCodeBaseUrl || "http://127.0.0.1:11434/v1"} onChange={(value) => onUpdate({ openCodeBaseUrl: value })} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "baseUrl")}`} mono />
                  </Row>
                </>
              )}
            </>
          )}

          {currentAuthType === "localAuth" && (
            <Row label={t(settingsIntegrationsMessages, "openCodeAuthPath")} description={t(settingsIntegrationsMessages, "openCodeAuthPathDescription")}>
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "openCodeAuthPath")}`} mono />
            </Row>
          )}

          <Row label={t(settingsIntegrationsMessages, "generatedConfigPreview")} description={t(settingsIntegrationsMessages, "generatedOpenCodeConfigDescription")} last={isLast}>
              <pre role="region" aria-label={`${providerInstanceLabel} OpenCode ${t(settingsIntegrationsMessages, "generatedConfigPreview")}`} className="max-h-72 max-w-full overflow-auto whitespace-pre-wrap break-words rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
              {buildOpenCodeConfigPreview(provider, providerModel, dockerExecutionEnabled)}
            </pre>
          </Row>
        </>
      )}

      {/* Claude and Codex Custom Base URL */}
      {(provider.provider === "claude-code" || provider.provider === "codex") && currentAuthType !== "dashboardAuth" && (
        <>
          {customEndpointDisabled ? (
            <div id={customEndpointDisabledReasonId} className="rounded-xl border border-amber-500/20 bg-amber-500/[0.08] px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-200">
              {t(settingsIntegrationsMessages, "customEndpointDisabled")}
            </div>
          ) : null}
          {currentAuthType === "localAuth" && (
            <Row label={t(settingsIntegrationsMessages, "authPath")} description={t(settingsIntegrationsMessages, "instanceAuthPathDescription")}>
                <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "authPath")}`} mono />
            </Row>
          )}
          <Row
            label={t(settingsIntegrationsMessages, "apiProvider")}
            description={t(settingsIntegrationsMessages, "apiProviderGenericDescription")}
          >
              <ProviderCombobox
                value={provider.customProviderId || ""}
                aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "apiProvider")}`}
              aria-describedby={customEndpointDisabled ? customEndpointDisabledReasonId : undefined}
              onChange={(value, apiBaseUrl) => onUpdate({
                customProviderId: value || undefined,
                ...(apiBaseUrl ? { customBaseUrl: apiBaseUrl } : {}),
              })}
              disabled={customEndpointDisabled}
              placeholder={t(settingsIntegrationsMessages, "defaultEndpointPlaceholder")}
            />
          </Row>
          <Row
            label={t(settingsIntegrationsMessages, provider.provider === "claude-code" ? "anthropicBaseUrl" : "openAiBaseUrl")}
            description={
              provider.provider === "claude-code"
                ? t(settingsIntegrationsMessages, "claudeBaseUrlDescription")
                : t(settingsIntegrationsMessages, "codexBaseUrlDescription")
            }
          >
              <TextInput
                value={provider.customBaseUrl || ""}
                onChange={(value) => onUpdate({ customBaseUrl: value || undefined })}
                aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "baseUrl")}`}
                aria-describedby={customEndpointDisabled ? customEndpointDisabledReasonId : undefined}
                disabled={customEndpointDisabled}
                helperText={customEndpointDisabled ? t(settingsIntegrationsMessages, "switchToApiKey") : undefined}
                mono
              />
          </Row>
          <Row
            label={t(settingsIntegrationsMessages, "customModel")}
            description={
              provider.provider === "claude-code"
                ? t(settingsIntegrationsMessages, "claudeCustomModelDescription")
                : t(settingsIntegrationsMessages, "codexCustomModelDescription")
            }
            last={isLast}
          >
            <ModelCombobox
              value={provider.customModel || ""}
              onChange={(value) => onUpdate({ customModel: value || undefined })}
              disabled={customEndpointDisabled}
                placeholder={t(settingsIntegrationsMessages, "selectedModelPlaceholder")}
                providerId={provider.customProviderId}
                aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "customModel")}`}
                aria-describedby={customEndpointDisabled ? customEndpointDisabledReasonId : undefined}
              />
          </Row>
        </>
      )}

      {/* Standard Local Auth Option for Generic CLI Providers */}
      {provider.provider !== "jules" && provider.provider !== "qwen-code" && provider.provider !== "opencode" && provider.provider !== "claude-code" && provider.provider !== "codex" && currentAuthType === "localAuth" && (
        <Row label={t(settingsIntegrationsMessages, "authPath")} description={t(settingsIntegrationsMessages, "instanceAuthPathDescription")} last={isLast}>
            <TextInput value={provider.authPath} onChange={(value) => onUpdate(sanitizeSystemProviderConfig({ ...provider, authPath: value }))} aria-label={`${providerInstanceLabel} ${t(settingsIntegrationsMessages, "authPath")}`} mono />
        </Row>
      )}

      {provider.provider === "jules" && (
        <Row label={t(settingsIntegrationsMessages, "julesAuthMode")} description={t(settingsIntegrationsMessages, "julesAuthModeDescription")} last={isLast}>
          <div className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t(settingsIntegrationsMessages, "apiKeyOnly")}</div>
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
            setFeedback({ tone: "success", message: providerInstanceLabel + t(settingsIntegrationsMessages, "dashboardLoginCompleted") });
          }}
        />
      )}
      </section>
  );
};
