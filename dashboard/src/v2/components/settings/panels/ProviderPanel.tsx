import type { FunctionComponent } from "preact";
import type { ProjectSettings, ThinkingMode } from "../../../../types.js";
import { SelectInput, Toggle, TextInput, NumberInput } from "../SettingsFormFields.js";
import { Row, OverrideBadge, ProviderLogo } from "./SharedPanelComponents.js";
import {
  getProviderModelOptions,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
  thinkingModeOptions,
  providerLabels,
  PROVIDER_CARD_TOKENS
} from "../../../lib/settings-view-models.js";

export const ProviderPanel: FunctionComponent<{
  settings: ProjectSettings;
  update: (patch: Partial<ProjectSettings>) => void;
  getBadge: (path: string) => string | undefined;
}> = ({ settings, update, getBadge }) => {
  return (
    <>
        <div className={`grid gap-4 mb-4 ${settings.aiProvider.strategy === "MANUAL" ? "lg:grid-cols-2" : ""}`}>
          <Row label="Routing strategy" description="Manual pins one provider, weighted spreads work, orchestrator can make routing decisions." badge={getBadge("aiProvider.strategy")}>
            <SelectInput
              value={settings.aiProvider.strategy}
              onChange={(value) => update({
                aiProvider: {
                  ...settings.aiProvider,
                  strategy: value as ProjectSettings["aiProvider"]["strategy"],
                },
              })}
              options={[
                { value: "MANUAL", label: "Manual" },
                { value: "WEIGHTED", label: "Weighted" },
                { value: "ORCHESTRATOR", label: "Orchestrator" },
              ]}
            />
          </Row>
          {settings.aiProvider.strategy === "MANUAL" ? (
            <Row label="Primary provider" description="Default provider when the strategy is manual." badge={getBadge("aiProvider.provider")}>
              <SelectInput
                value={settings.aiProvider.provider}
                onChange={(value) => update({
                  aiProvider: {
                    ...settings.aiProvider,
                    provider: value as ProjectSettings["aiProvider"]["provider"],
                  },
                })}
                options={[
                  { value: "jules", label: "Jules" },
                  { value: "gemini", label: "Gemini" },
                  { value: "codex", label: "Codex" },
                  { value: "claude-code", label: "Claude Code" },
                ]}
              />
            </Row>
          ) : null}
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          {Object.entries(settings.aiProvider.providers).map(([providerId, provider]) => {
            const providerKey = providerId as keyof ProjectSettings["aiProvider"]["providers"];
            const supportsModelSelection = providerSupportsModelSelection(providerKey);
            const supportsThinkingMode = providerSupportsThinkingMode(providerKey);
            const modelOptions = getProviderModelOptions(providerKey);
            const cardTokens = PROVIDER_CARD_TOKENS[providerKey];

            return (
            <div
              key={providerId}
              className={`group relative overflow-hidden rounded-[1.6rem] border border-black/[0.06] bg-white/72 p-5 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/65 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] ${provider.enabled ? "" : "opacity-60"}`}
            >
                <div aria-hidden className={`pointer-events-none absolute inset-0 ${cardTokens.glowClassName}`} />
                <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full ${cardTokens.railClassName}`} />
                <div aria-hidden className="pointer-events-none absolute -right-2 -top-3 select-none font-display text-[4.75rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.03]">
                  {cardTokens.watermark}
                </div>
                <div className="relative z-10 mb-4 flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <ProviderLogo providerId={providerKey} disabled={!provider.enabled} />
                    <div>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${cardTokens.badgeClassName}`}>
                        {cardTokens.badgeLabel}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{providerLabels[providerId as keyof typeof providerLabels]}</div>
                      {getBadge(`aiProvider.providers.${providerId}.enabled`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.enabled`)!} /> : null}
                    </div>
                    <div className="mt-1 text-xs font-medium leading-relaxed text-slate-500 dark:text-slate-400">
                      {providerId === "jules"
                        ? "Enabled state and routing weight. Jules follows API-managed defaults for model behavior."
                        : "Model choice, weight, and thinking mode."}
                    </div>
                    </div>
                  </div>
                <Toggle
                  value={provider.enabled}
                  onChange={(value) => update({
                    aiProvider: {
                      ...settings.aiProvider,
                      providers: {
                        ...settings.aiProvider.providers,
                        [providerId]: {
                          ...provider,
                          enabled: value,
                        },
                      },
                    },
                  })}
                />
              </div>
              {!supportsModelSelection || !supportsThinkingMode ? (
                <div className={`relative z-10 mb-3 rounded-2xl border px-4 py-3 text-xs font-medium leading-relaxed ${cardTokens.noteClassName}`}>
                  Jules API currently does not expose model selection or thinking controls, so this provider uses Jules-managed defaults.
                </div>
              ) : null}
              <div className={`relative z-10 grid gap-3 ${supportsModelSelection && supportsThinkingMode ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                {supportsModelSelection ? (
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Model</span>
                    {getBadge(`aiProvider.providers.${providerId}.model`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.model`)!} /> : null}
                  </div>
                  {modelOptions.length > 0 ? (
                    <SelectInput
                      value={provider.model}
                      onChange={(value) => update({
                        aiProvider: {
                          ...settings.aiProvider,
                          providers: {
                            ...settings.aiProvider.providers,
                            [providerId]: {
                              ...provider,
                              model: value,
                            },
                          },
                        },
                      })}
                      options={modelOptions}
                    />
                  ) : (
                    <TextInput
                      value={provider.model}
                      onChange={(value) => update({
                        aiProvider: {
                          ...settings.aiProvider,
                          providers: {
                            ...settings.aiProvider.providers,
                            [providerId]: {
                              ...provider,
                              model: value,
                            },
                          },
                        },
                      })}
                      mono
                    />
                  )}
                </div>
                ) : null}
                {supportsThinkingMode ? (
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Thinking mode</span>
                    {getBadge(`aiProvider.providers.${providerId}.thinkingMode`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.thinkingMode`)!} /> : null}
                  </div>
                  <SelectInput
                    value={provider.thinkingMode}
                    onChange={(value) => update({
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [providerId]: {
                            ...provider,
                            thinkingMode: value as ThinkingMode,
                          },
                        },
                      },
                    })}
                    options={thinkingModeOptions}
                  />
                </div>
                ) : null}
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Weight</span>
                    {getBadge(`aiProvider.providers.${providerId}.weight`) ? <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.weight`)!} /> : null}
                  </div>
                  <NumberInput
                    value={provider.weight}
                    min={0}
                    max={100}
                    onChange={(value) => update({
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [providerId]: {
                            ...provider,
                            weight: value,
                          },
                        },
                      },
                    })}
                  />
                </div>
              </div>
            </div>
          )})}
        </div>
    </>
  );
};
