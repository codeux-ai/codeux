import type { FunctionComponent } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { MetricPill, NumberInput, PillChoiceGroup, Row, SelectInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import type {
  InvocationRoutingId,
  ProjectSettings,
  ProviderConfigId,
  ThinkingMode,
} from "../../../../types.js";
import {
  getEligibleProviders,
  getProviderInstanceLabel,
  getProviderInstanceModelOptions,
  getProviderModelOptions,
  getProviderTypeLabel,
  providerSupportsModelSelection,
  providerSupportsThinkingMode,
  sortProviderConfigEntries,
} from "../../../lib/settings-view-models.js";

const INHERIT_VALUE = "__inherit__";

export const SettingsModelsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    editableSettings,
    projectSources,
    systemSettings,
    externalHints,
    activeInvocationRoute,
    setActiveInvocationRoute,
    thinkingModeOptions,
    invocationRouteDefinitions,
    routingProfileOptions,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  if (!editableSettings || !systemSettings) {
    return null;
  }

  const providerEntries = sortProviderConfigEntries(Object.entries(editableSettings.aiProvider.providers));
  const eligibleProviderConfigIds = getEligibleProviders(systemSettings, editableSettings, externalHints);
  const workerProviderEntries = providerEntries.filter(([, provider]) => provider.provider !== "jules");

  const globalProviderSettings = editableSettings.aiProvider.provider
    ? editableSettings.aiProvider.providers[editableSettings.aiProvider.provider]
    : null;
  const globalProviderType = globalProviderSettings?.provider || "jules";
  const globalModelOptions = globalProviderSettings
    ? getProviderInstanceModelOptions(editableSettings.aiProvider.provider || "", globalProviderSettings, systemSettings)
    : getProviderModelOptions(globalProviderType);
  const workerProviderSettings = editableSettings.aiProvider.providers[editableSettings.workers.virtualWorkerProvider];
  const workerProviderType = workerProviderSettings?.provider || "codex";
  const workerModelOptions = workerProviderSettings
    ? getProviderInstanceModelOptions(editableSettings.workers.virtualWorkerProvider, workerProviderSettings, systemSettings)
    : getProviderModelOptions(workerProviderType);

  const updateProviderSettings = (
    providerConfigId: ProviderConfigId,
    updates: Partial<ProjectSettings["aiProvider"]["providers"][ProviderConfigId]>,
  ): void => {
    updateEditableSettings((current) => ({
      ...current,
      aiProvider: {
        ...current.aiProvider,
        providers: {
          ...current.aiProvider.providers,
          [providerConfigId]: {
            ...current.aiProvider.providers[providerConfigId],
            ...updates,
          },
        },
      },
    }));
  };

  const updateRouteSettings = (
    routeId: InvocationRoutingId,
    updates: Partial<ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]>,
  ): void => {
    updateEditableSettings((current) => ({
      ...current,
      aiProvider: {
        ...current.aiProvider,
        invocationRouting: {
          ...current.aiProvider.invocationRouting,
          [routeId]: {
            ...current.aiProvider.invocationRouting[routeId],
            ...updates,
          },
        },
      },
    }));
  };

  const updateRouteProviderOverride = (
    routeId: InvocationRoutingId,
    providerConfigId: ProviderConfigId,
    updates: Partial<ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["providers"][ProviderConfigId]>,
  ): void => {
    updateEditableSettings((current) => ({
      ...current,
      aiProvider: {
        ...current.aiProvider,
        invocationRouting: {
          ...current.aiProvider.invocationRouting,
          [routeId]: {
            ...current.aiProvider.invocationRouting[routeId],
            providers: {
              ...current.aiProvider.invocationRouting[routeId].providers,
              [providerConfigId]: {
                ...(current.aiProvider.invocationRouting[routeId].providers[providerConfigId] || {}),
                ...updates,
              },
            },
          },
        },
      },
    }));
  };

  const clearRouteProviderOverride = (
    routeId: InvocationRoutingId,
    providerConfigId: ProviderConfigId,
  ): void => {
    updateEditableSettings((current) => {
      const nextProviders = { ...current.aiProvider.invocationRouting[routeId].providers };
      delete nextProviders[providerConfigId];
      return {
        ...current,
        aiProvider: {
          ...current.aiProvider,
          invocationRouting: {
            ...current.aiProvider.invocationRouting,
            [routeId]: {
              ...current.aiProvider.invocationRouting[routeId],
              providers: nextProviders,
            },
          },
        },
      };
    });
  };

  const toggleAllowedProvider = (
    routeId: InvocationRoutingId,
    providerConfigId: ProviderConfigId,
  ): void => {
    updateEditableSettings((current) => {
      const route = current.aiProvider.invocationRouting[routeId];
      const allowedProviders = route.allowedProviders.includes(providerConfigId)
        ? route.allowedProviders.filter((value) => value !== providerConfigId)
        : [...route.allowedProviders, providerConfigId];
      return {
        ...current,
        aiProvider: {
          ...current.aiProvider,
          invocationRouting: {
            ...current.aiProvider.invocationRouting,
            [routeId]: {
              ...route,
              allowedProviders,
            },
          },
        },
      };
    });
  };

  const activeRouteDefinition = invocationRouteDefinitions.find((definition) => definition.id === activeInvocationRoute)
    || invocationRouteDefinitions[0];
  const activeRoute = editableSettings.aiProvider.invocationRouting[activeRouteDefinition.id];
  const routePool = activeRoute.allowedProviders.length > 0
    ? activeRoute.allowedProviders.filter((providerConfigId) => editableSettings.aiProvider.providers[providerConfigId])
    : providerEntries.map(([providerConfigId]) => providerConfigId);
  const routeResolvedDefault = activeRoute.provider
    ? editableSettings.aiProvider.providers[activeRoute.provider]
    : activeRoute.profile === "WORKER"
    ? editableSettings.aiProvider.providers[editableSettings.workers.virtualWorkerProvider]
    : (editableSettings.aiProvider.provider ? editableSettings.aiProvider.providers[editableSettings.aiProvider.provider] : null);

  return (
    <div className="flex flex-col gap-5">
      <SectionCard title="Default Instances" watermark="AI" badge={getBadge("aiProvider", "workers")}>
        {providerEntries.length === 0 ? (
          <NoticePanel title="No provider credentials">
            Add provider credentials in Integrations before configuring AI routes.
          </NoticePanel>
        ) : null}
        <Row label="Global default instance" description="Fallback instance for global-profile routes that inherit their primary provider." badge={getFieldBadge("aiProvider.provider")}>
          <SelectInput
            value={editableSettings.aiProvider.provider || providerEntries[0]?.[0] || ""}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              aiProvider: {
                ...current.aiProvider,
                provider: value,
                providers: {
                  ...current.aiProvider.providers,
                  [value]: {
                    ...current.aiProvider.providers[value],
                    enabled: true,
                  },
                },
              },
            }))}
            options={providerEntries.map(([providerConfigId, provider]) => ({
              value: providerConfigId,
              label: getProviderInstanceLabel(provider),
            }))}
          />
        </Row>
        <Row label="Global default model" description="Base model used when the global default instance is selected without a route-specific model override." badge={getFieldBadge("aiProvider.providers")}>
          <SelectInput
            value={globalProviderSettings?.model || "default"}
            onChange={(value) => editableSettings.aiProvider.provider
              ? updateProviderSettings(editableSettings.aiProvider.provider, { model: value })
              : undefined}
            disabled={!globalProviderSettings || !providerSupportsModelSelection(globalProviderSettings.provider)}
            options={globalProviderSettings && providerSupportsModelSelection(globalProviderSettings.provider)
              ? globalModelOptions
              : [{ value: "default", label: "Managed by provider" }]}
          />
        </Row>
        <Row label="Worker default instance" description="Fallback instance for worker-profile routes that inherit their primary provider." badge={getFieldBadge("workers.virtualWorkerProvider")}>
          <SelectInput
            value={editableSettings.workers.virtualWorkerProvider}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              workers: {
                ...current.workers,
                virtualWorkerProvider: value,
                model: "default",
              },
            }))}
            options={workerProviderEntries.map(([providerConfigId, provider]) => ({
              value: providerConfigId,
              label: getProviderInstanceLabel(provider),
            }))}
          />
        </Row>
        <Row label="Worker default model" description="Model used by inherited worker-profile routes. Default uses the selected worker instance’s base model." badge={getFieldBadge("workers.model")}>
          <SelectInput
            value={editableSettings.workers.model || "default"}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              workers: {
                ...current.workers,
                model: value,
              },
            }))}
            options={[
              { value: "default", label: `Default (${workerProviderSettings?.model || "default"})` },
              ...workerModelOptions,
            ]}
          />
        </Row>
        <Row label="Max concurrency" description="Maximum number of worker-dispatched tasks running at once." badge={getFieldBadge("workers.maxConcurrency")}>
          <NumberInput value={editableSettings.workers.maxConcurrency} min={1} max={20} onChange={(value) => updateEditableSettings((current) => ({
            ...current,
            workers: { ...current.workers, maxConcurrency: value },
          }))} />
        </Row>
        <Row label="Dispatch timeout" description="Seconds before a worker-dispatched task is considered timed out." badge={getFieldBadge("workers.timeoutSeconds")} last>
          <NumberInput value={editableSettings.workers.timeoutSeconds} min={60} max={3600} onChange={(value) => updateEditableSettings((current) => ({
            ...current,
            workers: { ...current.workers, timeoutSeconds: value },
          }))} />
        </Row>
      </SectionCard>

      <SectionCard title="Route Mapping" watermark="MAP" badge={getBadge("aiProvider.invocationRouting")}>
        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="rounded-[1.6rem] border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="mb-3 px-2">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Invocation routes</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Each route can inherit a default instance, choose a manual instance, or distribute across a weighted pool of exact instances.
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {invocationRouteDefinitions.map((definition) => {
                const route = editableSettings.aiProvider.invocationRouting[definition.id];
                const poolCount = route.allowedProviders.length || providerEntries.length;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setActiveInvocationRoute(definition.id)}
                    className={`rounded-[1.2rem] border px-4 py-3 text-left transition-all duration-200 ${
                      definition.id === activeInvocationRoute
                        ? "border-signal-500/25 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)] dark:border-signal-400/25 dark:bg-signal-400/[0.12]"
                        : "border-black/[0.06] bg-white/78 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-void-900/50 dark:hover:border-white/[0.1]"
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{definition.label}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{definition.description}</div>
                    <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      <span>{route.profile}</span>
                      <span className="rounded-full bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]">{poolCount} instances</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[1.6rem] border border-black/[0.06] bg-white/78 p-5 shadow-[0_18px_44px_rgba(15,23,42,0.05)] dark:border-white/[0.06] dark:bg-void-900/52 dark:shadow-[0_20px_44px_rgba(0,0,0,0.24)]">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
              <div>
                <div className="text-lg font-semibold text-slate-900 dark:text-white">{activeRouteDefinition.label}</div>
                <div className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{activeRouteDefinition.description}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">{activeRoute.profile} profile</span>
                <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">{activeRoute.strategy}</span>
              </div>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-3">
              <MetricPill label="Resolved default" value={routeResolvedDefault ? getProviderInstanceLabel(routeResolvedDefault) : "None"} tone="signal" />
              <MetricPill label="Pool size" value={`${routePool.length} instance${routePool.length === 1 ? "" : "s"}`} />
              <MetricPill label="Overrides" value={`${Object.keys(activeRoute.providers).length} instance${Object.keys(activeRoute.providers).length === 1 ? "" : "s"}`} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Profile</div>
                <PillChoiceGroup
                  value={activeRoute.profile}
                  onChange={(value) => updateRouteSettings(activeRouteDefinition.id, {
                    profile: value as ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["profile"],
                    provider: null,
                  })}
                  options={routingProfileOptions}
                />
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Strategy</div>
                <PillChoiceGroup
                  value={activeRoute.strategy}
                  onChange={(value) => updateRouteSettings(activeRouteDefinition.id, {
                    strategy: value as ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["strategy"],
                  })}
                  options={[
                    { value: "MANUAL", label: "Manual", hint: "Pin one exact instance." },
                    { value: "WEIGHTED", label: "Weighted", hint: "Distribute by instance weight." },
                    { value: "ORCHESTRATOR", label: "Orchestrator", hint: "Runtime chooses an instance." },
                  ]}
                />
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Primary instance</div>
              <SelectInput
                value={activeRoute.provider || INHERIT_VALUE}
                onChange={(value) => {
                  const providerConfigId = value === INHERIT_VALUE ? null : value;
                  updateRouteSettings(activeRouteDefinition.id, {
                    provider: providerConfigId,
                  });
                  if (providerConfigId) {
                    updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { enabled: true });
                  }
                }}
                disabled={activeRoute.strategy !== "MANUAL"}
                options={[
                  {
                    value: INHERIT_VALUE,
                    label: activeRoute.profile === "WORKER"
                      ? `Inherit worker default (${getProviderInstanceLabel(workerProviderSettings)})`
                      : `Inherit global default (${editableSettings.aiProvider.provider ? getProviderInstanceLabel(editableSettings.aiProvider.providers[editableSettings.aiProvider.provider]) : "None"})`,
                  },
                  ...providerEntries.map(([providerConfigId, provider]) => ({
                    value: providerConfigId,
                    label: getProviderInstanceLabel(provider),
                  })),
                ]}
              />
            </div>

            <div className="mt-5 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Allowed pool</div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeRoute.allowedProviders.length === 0 ? "Using all configured instances" : `${activeRoute.allowedProviders.length} pinned`}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {providerEntries.map(([providerConfigId, provider]) => {
                  const active = activeRoute.allowedProviders.length === 0 || activeRoute.allowedProviders.includes(providerConfigId);
                  const available = eligibleProviderConfigIds.includes(providerConfigId);
                  return (
                    <button
                      key={`${activeRouteDefinition.id}-${providerConfigId}`}
                      type="button"
                      onClick={() => toggleAllowedProvider(activeRouteDefinition.id, providerConfigId)}
                      className={`rounded-full border px-3 py-2 text-[11px] font-semibold tracking-wide transition-colors ${
                        active
                          ? "border-signal-500/35 bg-signal-500/12 text-signal-700 dark:border-signal-400/35 dark:bg-signal-400/12 dark:text-signal-200"
                          : "border-black/[0.08] bg-white/78 text-slate-500 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-400"
                      }`}
                    >
                      {provider.name}
                      <span className="ml-1.5 text-[10px] opacity-70">{getProviderTypeLabel(provider.provider)}</span>
                      {!available ? <span className="ml-1.5 text-[10px] opacity-70">unavailable</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              {routePool.map((providerConfigId) => {
                const provider = editableSettings.aiProvider.providers[providerConfigId];
                const override = activeRoute.providers[providerConfigId] || {};
                if (!provider) {
                  return null;
                }
                return (
                  <div key={`${activeRouteDefinition.id}-${providerConfigId}`} className="rounded-[1.35rem] border border-black/[0.06] bg-white/82 p-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">{getProviderTypeLabel(provider.provider)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => clearRouteProviderOverride(activeRouteDefinition.id, providerConfigId)}
                        className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400"
                      >
                        Reset
                      </button>
                    </div>
                    <div className="grid gap-3">
                      <Row label="Enabled override" description="Override route participation for this one instance.">
                        <Toggle value={override.enabled ?? provider.enabled} onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { enabled: value })} />
                      </Row>
                      {providerSupportsModelSelection(provider.provider) ? (
                        <Row label="Model override" description={`Inherited: ${provider.model}`}>
                          <SelectInput
                            value={override.model || provider.model}
                            onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { model: value })}
                            options={getProviderInstanceModelOptions(providerConfigId, provider, systemSettings)}
                          />
                        </Row>
                      ) : null}
                      {providerSupportsThinkingMode(provider.provider) ? (
                        <Row label="Thinking override" description={`Inherited: ${provider.thinkingMode}`}>
                          <SelectInput
                            value={(override.thinkingMode || provider.thinkingMode) as string}
                            onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { thinkingMode: value as ThinkingMode })}
                            options={thinkingModeOptions}
                          />
                        </Row>
                      ) : null}
                      <Row label="Weight override" description={`Inherited: ${provider.weight}`}>
                        <NumberInput value={override.weight ?? provider.weight} min={0} max={100} onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { weight: value })} />
                      </Row>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 rounded-[1.25rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
              Official provider logos are intentionally not embedded here. The dashboard uses in-house neutral identity badges and type labels so the app stays safe to ship in open source without relying on third-party trademark assets.
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
