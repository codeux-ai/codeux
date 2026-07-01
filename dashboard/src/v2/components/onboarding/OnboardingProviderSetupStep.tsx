import type { FunctionComponent } from "preact";
import { Plus } from "lucide-preact";
import type { ProviderId, ProviderConfigId, OnboardingProviderCredentialStatus, SystemSettings, ProjectSettings } from "../../../types.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { ProviderInstanceCard } from "../settings/ProviderInstanceCard.js";
import { sortProviderConfigEntries } from "../../lib/settings-view-models.js";

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

const providerDescriptions: Record<ProviderId, string> = {
  jules: "Google Jules API service for agent session and workspace orchestration.",
  gemini: "Gemini CLI with local OAuth auth-copy or API-key based execution.",
  codex: "Codex CLI for OpenAI-powered local container execution.",
  "claude-code": "Claude Code CLI with local auth-copy or provider API key.",
  "qwen-code": "Qwen Code CLI with OAuth, Alibaba Coding Plan, or custom model provider config.",
  opencode: "OpenCode CLI with local auth, provider keys, or OpenAI-compatible endpoints.",
  antigravity: "Antigravity CLI (agy) for Google-powered local container execution.",
};

const getProviderWatermark = (providerId: ProviderId): string => (
  providerId === "jules" ? "JLS"
    : providerId === "gemini" ? "GMN"
      : providerId === "codex" ? "CDX"
        : providerId === "qwen-code" ? "QWN"
          : providerId === "opencode" ? "OPC"
            : providerId === "antigravity" ? "AGY"
              : "CLD"
);

export interface OnboardingProviderSetupStepProps {
  selectedProviderTypes: ProviderId[];
  settings: SystemSettings | null;
  readinessByProvider: Partial<Record<ProviderId, OnboardingProviderCredentialStatus>>;
  dockerExecutionEnabled: boolean;
  addProviderInstance: (provider: ProviderId) => void;
  configureProviderInstance: (providerConfigId: ProviderConfigId, updates: Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]>) => void;
  removeProviderInstance: (providerConfigId: ProviderConfigId) => void;
  configureProjectProvider: (providerConfigId: ProviderConfigId, updates: Partial<ProjectSettings["aiProvider"]["providers"][ProviderConfigId]>) => void;
}

export const OnboardingProviderSetupStep: FunctionComponent<OnboardingProviderSetupStepProps> = ({
  selectedProviderTypes,
  settings,
  readinessByProvider,
  dockerExecutionEnabled,
  addProviderInstance,
  configureProviderInstance,
  removeProviderInstance,
  configureProjectProvider,
}) => {
  return (
    <div className="space-y-4">
      {selectedProviderTypes.length === 0 ? (
        <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/75 p-6 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]">
          No providers selected. You can add provider credentials later in Settings.
        </div>
      ) : (
        <div className="space-y-6">
          {selectedProviderTypes.map((providerId) => {
            const readinessStatus = readinessByProvider[providerId];
            const providerEntries = sortProviderConfigEntries(
              Object.entries(settings?.integrations.providers || {}).filter(([_, p]) => p.provider === providerId)
            );
            return (
              <div data-onboarding-card key={providerId} className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/78 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.055)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div aria-hidden className="pointer-events-none absolute -right-6 -top-8 font-display text-[7rem] font-black leading-none tracking-tight text-black/[0.025] dark:text-white/[0.025]">
                  {getProviderWatermark(providerId)}
                </div>
                <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
                  <div className="flex min-w-0 items-start gap-3">
                    <ProviderBrandIcon id={providerId} />
                    <div className="min-w-0">
                      <div className="text-base font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {readinessStatus?.detectedFiles.length ? `Detected: ${readinessStatus.detectedFiles.join(", ")}` : providerDescriptions[providerId]}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => addProviderInstance(providerId)}
                    className="inline-flex items-center gap-2 rounded-2xl border border-signal-500/20 bg-signal-500/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-signal-700 hover:bg-signal-500/15 dark:text-signal-200"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add instance</span>
                  </button>
                </div>
                <div className="relative z-10 mt-4 space-y-3">
                  {providerEntries.map(([providerConfigId, integrationProvider], index) => {
                    const projectProvider = settings?.defaults.aiProvider.providers[providerConfigId];
                    const providerModel = integrationProvider.customModel || projectProvider?.model;
                    return (
                      <ProviderInstanceCard
                        key={providerConfigId}
                        providerConfigId={providerConfigId}
                        provider={integrationProvider}
                        providerModel={providerModel || ""}
                        dockerExecutionEnabled={dockerExecutionEnabled}
                        onUpdate={(updates) => configureProviderInstance(providerConfigId, updates)}
                        onRemove={providerEntries.length > 1 ? () => removeProviderInstance(providerConfigId) : undefined}
                        enabled={projectProvider?.enabled ?? true}
                        onToggleEnabled={(value) => configureProjectProvider(providerConfigId, { enabled: value })}
                        index={index}
                        total={providerEntries.length}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};