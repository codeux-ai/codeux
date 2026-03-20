import type { ComponentChildren, FunctionComponent } from "preact";
import type { ProjectSettings, ThinkingMode } from "../../../types.js";
import { ModelSelect, type ModelSelectOption } from "./ModelSelect.js";

type ProviderId = keyof ProjectSettings["aiProvider"]["providers"];

interface LayoutCardProps {
  title: string;
  description: string;
  badge?: string;
  children: ComponentChildren;
}

interface LayoutRowProps {
  label: string;
  description: string;
  badge?: string;
  children: ComponentChildren;
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}

interface ToggleFieldProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

interface AIModelSettingsEditorProps {
  settings: ProjectSettings;
  onChange: (next: ProjectSettings) => void;
  sectionBadge?: string;
  getBadge: (path: string) => string | undefined;
  Card: FunctionComponent<LayoutCardProps>;
  Row: FunctionComponent<LayoutRowProps>;
  SelectField: FunctionComponent<SelectFieldProps>;
  NumberField: FunctionComponent<NumberFieldProps>;
  ToggleField: FunctionComponent<ToggleFieldProps>;
}

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
};

const thinkingModeOptions: Array<{ value: ThinkingMode; label: string }> = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

const providerModelOptions: Record<ProviderId, ModelSelectOption[]> = {
  jules: [
    { value: "default", label: "default", description: "Default Jules model route." },
  ],
  gemini: [
    { value: "default", label: "default", description: "Default Gemini model route." },
    { value: "gemini-2.5-pro", label: "gemini-2.5-pro", description: "Higher quality Gemini route." },
    { value: "gemini-2.0-flash", label: "gemini-2.0-flash", description: "Fast Gemini route for short tasks." },
    { value: "gemini-1.5-pro", label: "gemini-1.5-pro", description: "Legacy Gemini pro fallback." },
    { value: "gemini-1.5-flash", label: "gemini-1.5-flash", description: "Legacy Gemini fast fallback." },
  ],
  codex: [
    { value: "default", label: "default", description: "Default Codex model route." },
    { value: "gpt-5.3-codex", label: "gpt-5.3-codex", description: "Most capable Codex coding model." },
    { value: "gpt-4o", label: "gpt-4o", description: "Balanced multimodal model." },
    { value: "gpt-4-turbo", label: "gpt-4-turbo", description: "Legacy GPT-4 turbo fallback." },
  ],
  "claude-code": [
    { value: "default", label: "default", description: "Default Claude model route." },
    { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6", description: "Primary Claude coding route." },
    { value: "claude-opus-4-6", label: "claude-opus-4-6", description: "Highest quality Claude route." },
    { value: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5-20251001", description: "Fast Claude route." },
    { value: "claude-3-5-sonnet-20241022", label: "claude-3-5-sonnet-20241022", description: "Claude 3.5 fallback route." },
  ],
};

const virtualWorkerProviderOptions: ModelSelectOption[] = [
  { value: "gemini", label: "Gemini CLI", description: "Use Gemini CLI for virtual worker dispatch." },
  { value: "codex", label: "Codex CLI", description: "Use Codex CLI for virtual worker dispatch." },
  { value: "claude-code", label: "Claude Code CLI", description: "Use Claude Code for virtual worker dispatch." },
];

const virtualWorkerModelOptionsByProvider: Record<ProjectSettings["workers"]["virtualWorkerProvider"], ModelSelectOption[]> = {
  gemini: providerModelOptions.gemini,
  codex: providerModelOptions.codex,
  "claude-code": providerModelOptions["claude-code"],
};

const withCurrentOption = (
  options: ModelSelectOption[],
  value: string,
  description: string,
): ModelSelectOption[] => {
  if (options.some((option) => option.value === value)) {
    return options;
  }
  return [{ value, label: value, description }, ...options];
};

const OverrideBadge: FunctionComponent<{ label: string; compact?: boolean }> = ({ label, compact = false }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200 ${compact ? "px-2 py-0.5" : "px-2.5 py-0.5"}`}>
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
      !
    </span>
    {label}
  </span>
);

export const AIModelSettingsEditor: FunctionComponent<AIModelSettingsEditorProps> = ({
  settings,
  onChange,
  sectionBadge,
  getBadge,
  Card,
  Row,
  SelectField,
  NumberField,
  ToggleField,
}) => {
  const providerEntries = Object.entries(settings.aiProvider.providers) as Array<
    [ProviderId, ProjectSettings["aiProvider"]["providers"][ProviderId]]
  >;

  return (
    <Card
      title="AI Models"
      description="Route provider traffic, choose model families, and configure virtual worker model defaults in one place."
      badge={sectionBadge}
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Row
          label="Primary provider"
          description="Default provider when routing strategy is manual."
          badge={getBadge("aiProvider.provider")}
        >
          <SelectField
            value={settings.aiProvider.provider}
            onChange={(value) => onChange({
              ...settings,
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

        <Row
          label="Routing strategy"
          description="Manual pins one provider, weighted distributes task load, orchestrator can choose at runtime."
          badge={getBadge("aiProvider.strategy")}
        >
          <SelectField
            value={settings.aiProvider.strategy}
            onChange={(value) => onChange({
              ...settings,
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

        <Row
          label="Virtual worker provider"
          description="Preferred CLI provider when worker mode is virtual. Jules remains excluded for worker dispatch."
          badge={getBadge("workers.virtualWorkerProvider")}
        >
          <ModelSelect
            mode="strict"
            provider="virtual-worker"
            value={settings.workers.virtualWorkerProvider}
            options={virtualWorkerProviderOptions}
            inputId="virtual-worker-provider"
            onChange={(value) => {
              const nextProvider = value as ProjectSettings["workers"]["virtualWorkerProvider"];
              const allowedModels = virtualWorkerModelOptionsByProvider[nextProvider].map((option) => option.value);
              const nextModel = allowedModels.includes(settings.workers.virtualWorkerModel)
                ? settings.workers.virtualWorkerModel
                : virtualWorkerModelOptionsByProvider[nextProvider][0]?.value ?? "default";

              onChange({
                ...settings,
                workers: {
                  ...settings.workers,
                  virtualWorkerProvider: nextProvider,
                  virtualWorkerModel: nextModel,
                },
              });
            }}
          />
        </Row>

        <Row
          label="Virtual worker model"
          description="Pinned model used when virtual workers wake up to process dispatches."
          badge={getBadge("workers.virtualWorkerModel")}
        >
          <ModelSelect
            mode="strict"
            provider={settings.workers.virtualWorkerProvider}
            value={settings.workers.virtualWorkerModel}
            options={withCurrentOption(
              virtualWorkerModelOptionsByProvider[settings.workers.virtualWorkerProvider],
              settings.workers.virtualWorkerModel,
              "Custom model currently stored for this worker route.",
            )}
            inputId="virtual-worker-model"
            onChange={(value) => onChange({
              ...settings,
              workers: {
                ...settings.workers,
                virtualWorkerModel: value,
              },
            })}
          />
        </Row>
      </div>

      <div className="grid gap-4 pt-2 xl:grid-cols-2">
        {providerEntries.map(([providerId, provider]) => (
          <div
            key={providerId}
            className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.015] p-4 dark:border-white/[0.06] dark:bg-white/[0.02]"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    {providerLabels[providerId]}
                  </div>
                  {getBadge(`aiProvider.providers.${providerId}.enabled`) ? (
                    <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.enabled`)!} />
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Enabled state, model route, thinking mode, and weight.
                </div>
              </div>
              <ToggleField
                checked={provider.enabled}
                onChange={(enabled) => onChange({
                  ...settings,
                  aiProvider: {
                    ...settings.aiProvider,
                    providers: {
                      ...settings.aiProvider.providers,
                      [providerId]: {
                        ...provider,
                        enabled,
                      },
                    },
                  },
                })}
              />
            </div>

            <div className="grid gap-3">
              <div>
                <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  <span>Model</span>
                  {getBadge(`aiProvider.providers.${providerId}.model`) ? (
                    <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.model`)!} compact />
                  ) : null}
                </div>
                <ModelSelect
                  mode="freeform"
                  provider={providerId}
                  value={provider.model}
                  inputId={`provider-${providerId}-model`}
                  options={withCurrentOption(
                    providerModelOptions[providerId],
                    provider.model,
                    "Custom model currently stored for this provider route.",
                  )}
                  onChange={(value) => onChange({
                    ...settings,
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
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Thinking mode</span>
                    {getBadge(`aiProvider.providers.${providerId}.thinkingMode`) ? (
                      <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.thinkingMode`)!} compact />
                    ) : null}
                  </div>
                  <SelectField
                    value={provider.thinkingMode}
                    onChange={(value) => onChange({
                      ...settings,
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

                <div>
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                    <span>Weight</span>
                    {getBadge(`aiProvider.providers.${providerId}.weight`) ? (
                      <OverrideBadge label={getBadge(`aiProvider.providers.${providerId}.weight`)!} compact />
                    ) : null}
                  </div>
                  <NumberField
                    value={provider.weight}
                    min={0}
                    max={100}
                    onChange={(value) => onChange({
                      ...settings,
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
          </div>
        ))}
      </div>
    </Card>
  );
};
