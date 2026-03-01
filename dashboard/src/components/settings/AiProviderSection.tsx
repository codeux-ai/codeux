import type { FunctionComponent } from "preact";
import type { DashboardSettings } from "../../types.js";
import {
  claudeCodeModelOptions,
  geminiModelOptions,
  providerOptions,
  providerStrategyOptions,
  thinkingModeOptions,
} from "./settings-options.js";
import { SettingsCard } from "./primitives.js";
import type { SettingsSectionProps } from "./types.js";

export const AiProviderSection: FunctionComponent<SettingsSectionProps> = ({ settings, onChange }) => (
<SettingsCard title="AI Provider">
  <label className="block space-y-2">
    <span className="text-xs text-slate-400">Routing Strategy</span>
    <select
      value={settings.aiProvider.strategy}
      onChange={(event) =>
        onChange({
          ...settings,
          aiProvider: {
            ...settings.aiProvider,
            strategy: event.currentTarget.value as DashboardSettings["aiProvider"]["strategy"],
          },
        })
      }
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
    >
      {providerStrategyOptions.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  </label>
  <label className="block space-y-2">
    <span className="text-xs text-slate-400">Manual Default Provider</span>
    <select
      value={settings.aiProvider.provider}
      onChange={(event) =>
        onChange({
          ...settings,
          aiProvider: {
            ...settings.aiProvider,
            provider: event.currentTarget.value as DashboardSettings["aiProvider"]["provider"],
          },
        })
      }
      disabled={settings.aiProvider.strategy !== "MANUAL"}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
    >
      {providerOptions.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
    <p className="text-[11px] text-slate-500">
      `MANUAL` uses selected provider, `WEIGHTED` uses provider weights, `ORCHESTRATOR` routes by task complexity with weighted fallback.
    </p>
  </label>
  <div className="space-y-3">
    {providerOptions.map((provider) => {
      const providerConfig = settings.aiProvider.providers[provider.value];
      const isGemini = provider.value === "gemini";
      const isClaudeCode = provider.value === "claude-code";
      return (
        <div key={provider.value} className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-200">{provider.label}</p>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={providerConfig.enabled}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    aiProvider: {
                      ...settings.aiProvider,
                      providers: {
                        ...settings.aiProvider.providers,
                        [provider.value]: {
                          ...providerConfig,
                          enabled: event.currentTarget.checked,
                        },
                      },
                    },
                  })
                }
                className="h-4 w-4 rounded border-slate-700 bg-slate-900"
              />
              Enabled
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500">Model</span>
              {isGemini ? (
                <select
                  value={providerConfig.model}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [provider.value]: {
                            ...providerConfig,
                            model: event.currentTarget.value,
                          },
                        },
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                >
                  {geminiModelOptions.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : isClaudeCode ? (
                <select
                  value={providerConfig.model}
                  onChange={(event) =>
                    onChange({
                      ...settings,
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [provider.value]: {
                            ...providerConfig,
                            model: event.currentTarget.value,
                          },
                        },
                      },
                    })
                  }
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                >
                  {claudeCodeModelOptions.map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={providerConfig.model}
                  onInput={(event) =>
                    onChange({
                      ...settings,
                      aiProvider: {
                        ...settings.aiProvider,
                        providers: {
                          ...settings.aiProvider.providers,
                          [provider.value]: {
                            ...providerConfig,
                            model: event.currentTarget.value,
                          },
                        },
                      },
                    })
                  }
                  placeholder={provider.value === "codex" ? "gpt-5.3-codex" : "default"}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                />
              )}
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500">Thinking</span>
              <select
                value={providerConfig.thinkingMode}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    aiProvider: {
                      ...settings.aiProvider,
                      providers: {
                        ...settings.aiProvider.providers,
                        [provider.value]: {
                          ...providerConfig,
                          thinkingMode: event.currentTarget.value as "SMALL" | "MEDIUM" | "HIGH",
                        },
                      },
                    },
                  })
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
              >
                {thinkingModeOptions.map((mode) => (
                  <option key={mode.value} value={mode.value}>{mode.label}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-slate-500">Weight ({providerConfig.weight}%)</span>
              <input
                type="range"
                min={0}
                max={100}
                value={providerConfig.weight}
                onInput={(event) =>
                  onChange({
                    ...settings,
                    aiProvider: {
                      ...settings.aiProvider,
                      providers: {
                        ...settings.aiProvider.providers,
                        [provider.value]: {
                          ...providerConfig,
                          weight: Number(event.currentTarget.value),
                        },
                      },
                    },
                  })
                }
                className="w-full"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="text-[11px] text-slate-500">API Key (optional)</span>
            <input
              type="password"
              value={providerConfig.apiKey}
              onInput={(event) =>
                onChange({
                  ...settings,
                  aiProvider: {
                    ...settings.aiProvider,
                    julesApiKey: provider.value === "jules" ? event.currentTarget.value : settings.aiProvider.julesApiKey,
                    providers: {
                      ...settings.aiProvider.providers,
                      [provider.value]: {
                        ...providerConfig,
                        apiKey: event.currentTarget.value,
                      },
                    },
                  },
                })
              }
              placeholder={provider.value === "gemini" ? "GEMINI_API_KEY" : provider.value === "codex" ? "OPENAI_API_KEY" : provider.value === "claude-code" ? "ANTHROPIC_API_KEY" : "JULES_API_KEY"}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50"
            />
          </label>
        </div>
      );
    })}
  </div>
  <p className="text-[11px] text-slate-500">
    Keys are optional. Empty values fallback to system-wide env/auth. Session workflows remain branch+PR based across providers.
  </p>
</SettingsCard>
);
