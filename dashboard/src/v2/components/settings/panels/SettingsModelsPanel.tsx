import type { ComponentChildren, FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Anchor, CheckCircle2, ChevronDown, Cpu, GitBranch, Layers, Network, Route, RotateCcw, Settings2, SlidersHorizontal } from "lucide-preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, PillChoiceGroup, ProviderLogo, Row, SelectInput, Toggle } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
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
const providerSelectIcon = (providerId: string, disabled = false) => () => (
  <ProviderBrandIcon id={providerId} disabled={disabled} className="h-7 w-7 rounded-[0.7rem]" imageClassName="h-4 w-4" />
);

const StrategyBadge: FunctionComponent<{ strategy: string }> = ({ strategy }) => {
  const tone = strategy === "MANUAL"
    ? "border-signal-500/24 bg-black/[0.035] text-signal-700 dark:border-signal-400/24 dark:bg-white/[0.055] dark:text-signal-200"
    : "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.055] dark:text-slate-300";
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${tone}`}>
      {strategy.toLowerCase()}
    </span>
  );
};

const StatusPill: FunctionComponent<{ active: boolean; label?: string }> = ({ active, label }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${
    active
      ? "border-signal-500/20 bg-signal-500/[0.08] text-signal-700 dark:border-signal-400/20 dark:bg-signal-400/[0.1] dark:text-signal-200"
      : "border-black/[0.08] bg-black/[0.03] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400"
  }`}>
    <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-signal-500 dark:bg-signal-300" : "bg-slate-400 dark:bg-slate-500"}`} />
    {label || (active ? "Active" : "Inactive")}
  </span>
);

const WeightSlider: FunctionComponent<{
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  ariaLabel?: string;
}> = ({ value, onChange, min = 0, max = 100, ariaLabel = "Weight" }) => {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  return (
    <div className="group/slider flex w-[17rem] items-center gap-3">
      <div className="relative flex h-6 flex-1 items-center">
        <div className="absolute inset-x-0 h-2 rounded-full bg-black/[0.07] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] dark:bg-white/[0.08] dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.32)]" />
        <div
          className="pointer-events-none absolute left-0 h-2 rounded-full bg-gradient-to-r from-signal-400 via-signal-500 to-signal-600 shadow-[0_0_14px_rgba(56,189,248,0.45)] transition-[width] duration-150 dark:from-signal-300 dark:via-signal-400 dark:to-signal-500"
          style={{ width: `${pct}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          value={clamped}
          aria-label={ariaLabel}
          aria-valuenow={clamped}
          aria-valuemin={min}
          aria-valuemax={max}
          onInput={(event) => onChange(Number((event.currentTarget as HTMLInputElement).value))}
          className="peer absolute inset-x-0 z-10 h-6 w-full cursor-grab appearance-none bg-transparent opacity-0 focus:outline-none active:cursor-grabbing"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -translate-x-1/2 transition-[transform,box-shadow,left] duration-150 ease-out group-hover/slider:scale-110 peer-active:scale-110"
          style={{ left: `${pct}%` }}
        >
          <div className="relative h-5 w-5 rounded-full border-[1.5px] border-signal-500 bg-white shadow-[0_3px_10px_rgba(15,23,42,0.22)] dark:border-signal-300 dark:bg-void-800">
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/80 to-transparent dark:from-white/15" />
          </div>
        </div>
      </div>
      <span className="inline-flex h-9 min-w-[2.75rem] shrink-0 items-center justify-center rounded-[0.85rem] border border-black/[0.08] bg-white/85 px-2.5 text-sm font-bold tabular-nums text-slate-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-100">
        {clamped}
      </span>
    </div>
  );
};

const RouteFlowStep: FunctionComponent<{
  icon: ComponentChildren;
  label: string;
  value: string;
  tone?: "signal" | "neutral";
}> = ({ icon, label, value, tone = "neutral" }) => (
  <div className={`relative overflow-hidden rounded-[1.15rem] border px-4 py-3 ${
    tone === "signal"
      ? "border-signal-500/24 bg-black/[0.035] dark:border-signal-400/24 dark:bg-white/[0.055]"
      : "border-black/[0.06] bg-black/[0.025] dark:border-white/[0.06] dark:bg-white/[0.035]"
  }`}>
    <div className="flex items-center gap-2">
      <span className={tone === "signal" ? "text-signal-600 dark:text-signal-300" : "text-slate-400"}>
        {icon}
      </span>
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</span>
    </div>
    <div className={`mt-1 truncate text-sm font-black ${tone === "signal" ? "text-signal-700 dark:text-signal-200" : "text-slate-900 dark:text-white"}`}>
      {value}
    </div>
  </div>
);

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

  const [expandedProviderCards, setExpandedProviderCards] = useState<Record<string, boolean>>({});
  const toggleProviderCard = (providerConfigId: string): void => {
    setExpandedProviderCards((current) => ({
      ...current,
      [providerConfigId]: !current[providerConfigId],
    }));
  };
  const [expandedRouteOverrideCards, setExpandedRouteOverrideCards] = useState<Record<string, boolean>>({});
  const toggleRouteOverrideCard = (key: string): void => {
    setExpandedRouteOverrideCards((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

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
  const isManualStrategy = activeRoute.strategy === "MANUAL";
  const routeResolvedDefaultId: ProviderConfigId | null = activeRoute.provider
    || (activeRoute.profile === "WORKER"
      ? editableSettings.workers.virtualWorkerProvider
      : editableSettings.aiProvider.provider)
    || null;
  const routeResolvedDefault = routeResolvedDefaultId
    ? editableSettings.aiProvider.providers[routeResolvedDefaultId] ?? null
    : null;
  const routePool = isManualStrategy && routeResolvedDefaultId
    ? [routeResolvedDefaultId]
    : activeRoute.allowedProviders.length > 0
      ? activeRoute.allowedProviders.filter((providerConfigId) => editableSettings.aiProvider.providers[providerConfigId])
      : providerEntries.map(([providerConfigId]) => providerConfigId);
  const allowedPoolEntries = isManualStrategy
    ? providerEntries.filter(([providerConfigId]) => providerConfigId === routeResolvedDefaultId)
    : providerEntries;
  const allowedPoolTotal = isManualStrategy ? 1 : providerEntries.length;
  const inheritedProviderForActiveRoute = activeRoute.profile === "WORKER"
    ? workerProviderSettings
    : (editableSettings.aiProvider.provider ? editableSettings.aiProvider.providers[editableSettings.aiProvider.provider] : null);
  const enabledProviderCount = providerEntries.filter(([, provider]) => provider.enabled).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">
              <Route className="h-3.5 w-3.5" strokeWidth={2.4} />
              AI routing console
            </div>
            <h3 className="mt-3 font-display text-3xl font-black tracking-tight text-slate-950 dark:text-white">Provider defaults, route decisions, and runtime capacity in one place.</h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Global and worker anchors define the inherited defaults. Base provider configuration defines each instance. Route mapping decides how work is assigned.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <div className="rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
                <div className="flex items-start gap-3">
                  {globalProviderSettings ? <ProviderLogo providerId={globalProviderSettings.provider} disabled={!globalProviderSettings.enabled} /> : null}
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Global anchor</div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{globalProviderSettings ? getProviderInstanceLabel(globalProviderSettings) : "None"}</div>
                    <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{globalProviderSettings?.model || "default"}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-[1.35rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
                <div className="flex items-start gap-3">
                  {workerProviderSettings ? <ProviderLogo providerId={workerProviderSettings.provider} disabled={!workerProviderSettings.enabled} /> : null}
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Worker anchor</div>
                    <div className="mt-1 truncate text-sm font-semibold text-slate-900 dark:text-white">{workerProviderSettings ? getProviderInstanceLabel(workerProviderSettings) : "None"}</div>
                    <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{editableSettings.workers.model === "default" ? `Default (${workerProviderSettings?.model || "default"})` : editableSettings.workers.model}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3">
                <Cpu className="h-4 w-4 text-slate-400" />
                <span className="text-2xl font-black text-slate-900 dark:text-white">{providerEntries.length}</span>
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Provider instances</div>
            </div>
            <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3">
                <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                <span className="text-2xl font-black text-slate-900 dark:text-white">{enabledProviderCount}</span>
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Eligible by default</div>
            </div>
            <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.025] p-4 dark:border-white/[0.06] dark:bg-white/[0.035]">
              <div className="flex items-center justify-between gap-3">
                <GitBranch className="h-4 w-4 text-slate-400" />
                <span className="text-2xl font-black text-slate-900 dark:text-white">{invocationRouteDefinitions.length}</span>
              </div>
              <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Invocation routes</div>
            </div>
          </div>
        </div>
      </section>

      <SectionCard title="Default Routing Anchors" watermark="DEF" badge={getBadge("aiProvider", "workers")} icon={<Anchor strokeWidth={2.4} />}>
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
              icon: providerSelectIcon(provider.provider),
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
              icon: providerSelectIcon(provider.provider),
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

      <SectionCard title="Base Provider Configuration" watermark="BASE" badge={getBadge("aiProvider.providers")} icon={<Layers strokeWidth={2.4} />}>
        <div className="mb-4 rounded-[1.25rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
          These values are the inheritance baseline for every route. Route mapping owns manual, weighted, or agent-based selection; this section defines each provider instance’s default model, reasoning depth, weight, and capacity.
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {providerEntries.map(([providerConfigId, provider]) => {
            const expanded = !!expandedProviderCards[providerConfigId];
            const detailsId = `base-provider-details-${providerConfigId}`;
            return (
            <div key={`base-${providerConfigId}`} className={`relative overflow-hidden rounded-[1.35rem] border p-4 shadow-[0_14px_32px_rgba(15,23,42,0.035)] transition-colors dark:shadow-[0_16px_34px_rgba(0,0,0,0.18)] ${
              provider.enabled
                ? "border-signal-500/15 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,255,255,0.72))] dark:border-signal-400/15 dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.04))]"
                : "border-black/[0.06] bg-white/62 opacity-85 dark:border-white/[0.06] dark:bg-white/[0.035]"
            }`}>
              <div aria-hidden className={`absolute inset-x-0 top-0 h-1 ${provider.enabled ? "bg-signal-500/55" : "bg-slate-300/55 dark:bg-white/15"}`} />
              <div className="mb-3 flex items-start justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.06]">
                <div className="flex items-start gap-3">
                  <ProviderLogo providerId={provider.provider} disabled={!provider.enabled} />
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{getProviderTypeLabel(provider.provider)} baseline</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <StatusPill active={provider.enabled} label={provider.enabled ? "Eligible" : "Paused"} />
                  <button
                    type="button"
                    onClick={() => toggleProviderCard(providerConfigId)}
                    aria-expanded={expanded}
                    aria-controls={detailsId}
                    aria-label={expanded ? `Collapse ${provider.name} settings` : `Expand ${provider.name} settings`}
                    title={expanded ? "Collapse settings" : "Expand settings"}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white/80 text-slate-500 transition-colors hover:border-signal-500/30 hover:bg-signal-500/[0.06] hover:text-signal-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-signal-300/30 dark:hover:bg-signal-300/[0.08] dark:hover:text-signal-200"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : "rotate-0"}`}
                      strokeWidth={2.4}
                    />
                  </button>
                </div>
              </div>
              <div className={`grid gap-2 ${expanded ? "mb-3" : ""}`}>
                <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.05] px-3 py-2 dark:border-signal-400/15 dark:bg-signal-400/[0.06]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700/70 dark:text-signal-200/80">Model</div>
                    <Cpu className="h-3 w-3 text-signal-600/70 dark:text-signal-300/70" strokeWidth={2.4} />
                  </div>
                  <div className="mt-1 truncate font-mono text-sm font-bold text-slate-900 dark:text-white" title={providerSupportsModelSelection(provider.provider) ? provider.model : undefined}>
                    {providerSupportsModelSelection(provider.provider) ? provider.model : "Managed by provider"}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Weight</div>
                    <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{provider.weight}</div>
                  </div>
                  <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Thinking</div>
                    <div className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{provider.provider === "jules" ? "n/a" : provider.thinkingMode}</div>
                  </div>
                  <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                    <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Cap</div>
                    <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{provider.maxConcurrentTasks || "∞"}</div>
                  </div>
                </div>
              </div>
              {expanded ? (
                <div id={detailsId} className="grid gap-3">
                  <Row label="Eligible by default" description="Controls whether this instance participates before route-specific overrides are applied.">
                    <Toggle aria-label="Toggle setting" value={provider.enabled} onChange={(value) => updateProviderSettings(providerConfigId, { enabled: value })} />
                  </Row>
                  {providerSupportsModelSelection(provider.provider) ? (
                    <Row label="Base model" description="Inherited by routes unless a route-specific model override is set.">
                      <SelectInput
                        value={provider.model}
                        onChange={(value) => updateProviderSettings(providerConfigId, { model: value })}
                        options={getProviderInstanceModelOptions(providerConfigId, provider, systemSettings)}
                      />
                    </Row>
                  ) : null}
                  {providerSupportsThinkingMode(provider.provider) ? (
                    <Row label="Base thinking" description="Inherited reasoning depth for this provider instance.">
                      <SelectInput
                        value={provider.thinkingMode}
                        onChange={(value) => updateProviderSettings(providerConfigId, { thinkingMode: value as ThinkingMode })}
                        options={thinkingModeOptions}
                      />
                    </Row>
                  ) : null}
                  <Row label="Base weight" description="Used by weighted route strategies unless overridden.">
                    <WeightSlider
                      value={provider.weight}
                      onChange={(value) => updateProviderSettings(providerConfigId, { weight: value })}
                      ariaLabel={`${provider.name} base weight`}
                    />
                  </Row>
                  <Row label="Max concurrent tasks" description="Provider-level cap; 0 means unlimited." last>
                    <NumberInput value={provider.maxConcurrentTasks} min={0} max={50} onChange={(value) => updateProviderSettings(providerConfigId, { maxConcurrentTasks: value })} />
                  </Row>
                </div>
              ) : null}
            </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Route Mapping" watermark="MAP" badge={getBadge("aiProvider.invocationRouting")} icon={<GitBranch strokeWidth={2.4} />}>
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="rounded-[1.6rem] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(15,23,42,0.028),rgba(15,23,42,0.012))] p-3 dark:border-white/[0.06] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))]">
            <div className="mb-3 px-2.5 pt-1">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                <Network className="h-3.5 w-3.5" strokeWidth={2.4} />
                Invocation routes
              </div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Each route can inherit a default instance, choose a manual instance, or distribute across a weighted pool of exact instances.
              </div>
            </div>
            <div className="flex flex-col gap-2">
              {invocationRouteDefinitions.map((definition) => {
                const route = editableSettings.aiProvider.invocationRouting[definition.id];
                const resolvedProvider = route.provider
                  ? editableSettings.aiProvider.providers[route.provider]
                  : route.profile === "WORKER"
                    ? workerProviderSettings
                    : globalProviderSettings;
                const poolCount = route.allowedProviders.length || providerEntries.length;
                const overridesCount = Object.keys(route.providers).length;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => setActiveInvocationRoute(definition.id)}
                    className={`group relative overflow-hidden rounded-[1.25rem] border px-4 py-3 text-left transition-all duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 ${
                      definition.id === activeInvocationRoute
                        ? "border-signal-500/30 bg-black/[0.045] shadow-[0_18px_34px_rgba(15,23,42,0.08)] dark:border-signal-400/30 dark:bg-white/[0.07]"
                        : "border-black/[0.06] bg-black/[0.025] hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-black/[0.04] hover:shadow-[0_14px_28px_rgba(15,23,42,0.06)] dark:border-white/[0.06] dark:bg-white/[0.035] dark:hover:border-white/[0.12] dark:hover:bg-white/[0.06]"
                    }`}
                  >
                    {definition.id === activeInvocationRoute ? (
                      <div aria-hidden className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-signal-500 dark:bg-signal-300" />
                    ) : null}
                    <div className="flex items-start gap-3">
                      {resolvedProvider ? <ProviderBrandIcon id={resolvedProvider.provider} disabled={!resolvedProvider.enabled} className="h-8 w-8 rounded-[0.75rem]" imageClassName="h-4 w-4" /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-white">{definition.label}</div>
                          {definition.id === activeInvocationRoute ? <CheckCircle2 className="h-4 w-4 shrink-0 text-signal-600 dark:text-signal-300" /> : null}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          {resolvedProvider ? getProviderInstanceLabel(resolvedProvider) : "No provider"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{definition.description}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      <span className="rounded-full bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]">{route.profile}</span>
                      <StrategyBadge strategy={route.strategy} />
                      <span className="rounded-full bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]">{poolCount} instances</span>
                      {overridesCount > 0 ? <span className="rounded-full bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]">{overridesCount} overrides</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-[1.6rem] border border-black/[0.06] bg-black/[0.035] p-5 shadow-[0_18px_44px_rgba(15,23,42,0.05)] dark:border-white/[0.06] dark:bg-white/[0.045] dark:shadow-[0_20px_44px_rgba(0,0,0,0.24)]">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
              <div className="flex min-w-0 items-start gap-3">
                {routeResolvedDefault ? <ProviderLogo providerId={routeResolvedDefault.provider} disabled={!routeResolvedDefault.enabled} /> : null}
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-300">Active route</div>
                  <div className="mt-1 text-xl font-black text-slate-950 dark:text-white">{activeRouteDefinition.label}</div>
                  <div className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">{activeRouteDefinition.description}</div>
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    Inherits from <span className="font-semibold text-slate-700 dark:text-slate-200">{routeResolvedDefault ? getProviderInstanceLabel(routeResolvedDefault) : "no configured provider"}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">{activeRoute.profile} profile</span>
                <StrategyBadge strategy={activeRoute.strategy} />
              </div>
            </div>

            <div className="mb-5 grid gap-3 md:grid-cols-4">
              <RouteFlowStep
                icon={<Route className="h-4 w-4" />}
                label="Profile"
                value={activeRoute.profile.toLowerCase()}
                tone="signal"
              />
              <RouteFlowStep
                icon={<SlidersHorizontal className="h-4 w-4" />}
                label="Strategy"
                value={activeRoute.strategy.toLowerCase()}
              />
              <RouteFlowStep
                icon={routeResolvedDefault ? <ProviderBrandIcon id={routeResolvedDefault.provider} disabled={!routeResolvedDefault.enabled} className="h-6 w-6 rounded-[0.55rem]" imageClassName="h-3.5 w-3.5" /> : <Cpu className="h-4 w-4" />}
                label="Primary"
                value={routeResolvedDefault ? routeResolvedDefault.name : "None"}
              />
              <RouteFlowStep
                icon={<Network className="h-4 w-4" />}
                label="Pool"
                value={`${routePool.length} / ${allowedPoolTotal}`}
              />
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
                    { value: "AGENT", label: "Agent", hint: "Use agent provider/model." },
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
                disabled={activeRoute.strategy === "WEIGHTED"}
                options={[
                  {
                    value: INHERIT_VALUE,
                    label: activeRoute.profile === "WORKER"
                      ? `Inherit worker default (${getProviderInstanceLabel(workerProviderSettings)})`
                      : `Inherit global default (${inheritedProviderForActiveRoute ? getProviderInstanceLabel(inheritedProviderForActiveRoute) : "None"})`,
                    icon: inheritedProviderForActiveRoute
                      ? providerSelectIcon(inheritedProviderForActiveRoute.provider, !inheritedProviderForActiveRoute.enabled)
                      : undefined,
                  },
                  ...providerEntries.map(([providerConfigId, provider]) => ({
                    value: providerConfigId,
                    label: getProviderInstanceLabel(provider),
                    icon: providerSelectIcon(provider.provider, !provider.enabled),
                  })),
                ]}
              />
            </div>

            <div className="mt-5 rounded-[1.35rem] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(15,23,42,0.025),rgba(15,23,42,0.01))] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  <Network className="h-3.5 w-3.5" strokeWidth={2.4} />
                  Allowed pool
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isManualStrategy
                    ? "Locked to primary (manual)"
                    : activeRoute.allowedProviders.length === 0
                      ? "Using all configured instances"
                      : `${activeRoute.allowedProviders.length} pinned`}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {allowedPoolEntries.map(([providerConfigId, provider]) => {
                  const active = isManualStrategy
                    || activeRoute.allowedProviders.length === 0
                    || activeRoute.allowedProviders.includes(providerConfigId);
                  const available = eligibleProviderConfigIds.includes(providerConfigId);
                  return (
                    <button
                      key={`${activeRouteDefinition.id}-${providerConfigId}`}
                      type="button"
                      aria-pressed={active}
                      disabled={isManualStrategy}
                      onClick={isManualStrategy ? undefined : () => toggleAllowedProvider(activeRouteDefinition.id, providerConfigId)}
                      className={`group flex min-h-[68px] items-center justify-between gap-3 rounded-[1rem] border px-3 py-2.5 text-left transition-all duration-200 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 ${
                        active
                          ? "border-signal-500/30 bg-black/[0.045] text-slate-900 shadow-[0_10px_20px_rgba(15,23,42,0.06)] dark:border-signal-400/30 dark:bg-white/[0.065] dark:text-white"
                          : "border-black/[0.08] bg-black/[0.025] text-slate-500 hover:border-black/[0.12] hover:bg-black/[0.04] dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-400 dark:hover:border-white/[0.12] dark:hover:bg-white/[0.06]"
                      } ${isManualStrategy ? "cursor-default" : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <ProviderBrandIcon id={provider.provider} disabled={!active || !provider.enabled} className="h-7 w-7 rounded-[0.7rem]" imageClassName="h-4 w-4" />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-bold">{provider.name}</span>
                          <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.12em] opacity-65">{getProviderTypeLabel(provider.provider)}</span>
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {active ? <CheckCircle2 className="h-4 w-4 text-signal-600 dark:text-signal-300" /> : <span className="h-4 w-4 rounded-full border border-black/[0.12] dark:border-white/[0.16]" />}
                        {!available ? <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-300">Unavailable</span> : null}
                      </span>
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
                const participationEnabled = override.enabled ?? provider.enabled;
                const overrideCount = [
                  typeof override.enabled === "boolean",
                  typeof override.model === "string",
                  typeof override.thinkingMode === "string",
                  typeof override.weight === "number",
                ].filter(Boolean).length;
                const cardKey = `${activeRouteDefinition.id}-${providerConfigId}`;
                const expanded = !!expandedRouteOverrideCards[cardKey];
                const detailsId = `route-override-details-${cardKey}`;
                const effectiveModel = override.model || provider.model;
                const effectiveThinking = (override.thinkingMode || provider.thinkingMode) as string;
                const effectiveWeight = override.weight ?? provider.weight;
                const supportsModel = providerSupportsModelSelection(provider.provider);
                return (
                  <div key={cardKey} className={`relative overflow-hidden rounded-[1.35rem] border p-4 shadow-[0_14px_32px_rgba(15,23,42,0.035)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.18)] ${
                    participationEnabled
                      ? "border-signal-500/18 bg-black/[0.04] dark:border-signal-400/18 dark:bg-white/[0.055]"
                      : "border-black/[0.06] bg-black/[0.025] opacity-85 dark:border-white/[0.06] dark:bg-white/[0.035]"
                  }`}>
                    <div aria-hidden className={`absolute inset-x-0 top-0 h-1 ${participationEnabled ? "bg-signal-500/55" : "bg-slate-300/60 dark:bg-white/15"}`} />
                    <div className="mb-3 flex items-center justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.06]">
                      <div className="flex items-start gap-3">
                        <ProviderLogo providerId={provider.provider} disabled={!participationEnabled} />
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                            <span>{getProviderTypeLabel(provider.provider)}</span>
                            <StatusPill active={participationEnabled} label={participationEnabled ? "In route" : "Paused"} />
                            {overrideCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/[0.1] dark:text-amber-200">
                                <Settings2 className="h-3 w-3" />
                                {overrideCount}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          title="Reset route overrides"
                          aria-label={`Reset ${provider.name} route overrides`}
                          onClick={() => clearRouteProviderOverride(activeRouteDefinition.id, providerConfigId)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-black/[0.03] text-slate-500 transition-colors hover:bg-black/[0.06] hover:text-slate-800 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleRouteOverrideCard(cardKey)}
                          aria-expanded={expanded}
                          aria-controls={detailsId}
                          aria-label={expanded ? `Collapse ${provider.name} overrides` : `Expand ${provider.name} overrides`}
                          title={expanded ? "Collapse overrides" : "Expand overrides"}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-white/80 text-slate-500 transition-colors hover:border-signal-500/30 hover:bg-signal-500/[0.06] hover:text-signal-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-signal-300/30 dark:hover:bg-signal-300/[0.08] dark:hover:text-signal-200"
                        >
                          <ChevronDown
                            className={`h-4 w-4 transition-transform duration-200 ${expanded ? "rotate-180" : "rotate-0"}`}
                            strokeWidth={2.4}
                          />
                        </button>
                      </div>
                    </div>
                    <div className={`grid gap-2 ${expanded ? "mb-3" : ""}`}>
                      <div className="rounded-xl border border-signal-500/15 bg-signal-500/[0.05] px-3 py-2 dark:border-signal-400/15 dark:bg-signal-400/[0.06]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-700/70 dark:text-signal-200/80">Model</div>
                          <Cpu className="h-3 w-3 text-signal-600/70 dark:text-signal-300/70" strokeWidth={2.4} />
                        </div>
                        <div className="mt-1 truncate font-mono text-sm font-bold text-slate-900 dark:text-white" title={supportsModel ? effectiveModel : undefined}>
                          {supportsModel ? effectiveModel : "Managed by provider"}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Weight</div>
                          <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{effectiveWeight}</div>
                        </div>
                        <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Thinking</div>
                          <div className="mt-1 truncate text-sm font-black text-slate-900 dark:text-white">{provider.provider === "jules" ? "n/a" : effectiveThinking}</div>
                        </div>
                        <div className="rounded-xl border border-black/[0.05] bg-black/[0.025] px-3 py-2 dark:border-white/[0.05] dark:bg-white/[0.035]">
                          <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Cap</div>
                          <div className="mt-1 text-sm font-black text-slate-900 dark:text-white">{provider.maxConcurrentTasks || "∞"}</div>
                        </div>
                      </div>
                    </div>
                    {expanded ? (
                      <div id={detailsId} className="grid gap-3">
                        <Row label="Enabled override" description="Override route participation for this one instance.">
                          <Toggle aria-label="Toggle setting" value={override.enabled ?? provider.enabled} onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { enabled: value })} />
                        </Row>
                        {supportsModel ? (
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
                        <Row label="Weight override" description={`Inherited: ${provider.weight}`} last>
                          <WeightSlider
                            value={override.weight ?? provider.weight}
                            onChange={(value) => updateRouteProviderOverride(activeRouteDefinition.id, providerConfigId, { weight: value })}
                            ariaLabel={`${provider.name} weight override`}
                          />
                        </Row>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      </SectionCard>
    </div>
  );
};
