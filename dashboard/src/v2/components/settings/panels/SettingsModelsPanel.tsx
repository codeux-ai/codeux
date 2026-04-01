  import type { FunctionComponent, ComponentChildren } from "preact";
import type { SettingsPageState } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel } from "../SettingsSurface.js";
import { NumberInput, Row, Toggle, PillChoiceGroup, ProviderLogo, SelectInput, TextInput, MetricPill } from "../SettingsFormFields.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";
import type {
  ProjectSettings,
  ProviderId,
  InvocationRoutingId,
  ThinkingMode,
  SettingsValueSource
} from "../../../../types.js";
import {
  getProviderModelOptions,
  PROVIDER_CARD_TOKENS,
  providerSupportsModelSelection,
  providerSupportsThinkingMode
} from "../../../lib/settings-view-models.js";
import { AlertTriangle, Check, SlidersHorizontal, Settings } from "lucide-preact";

export const SettingsModelsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    selectedProject,
    systemSettings,
    editableSettings,
    projectSources,
    activeProviderPanel,
    setActiveProviderPanel,
    activeInvocationRoute,
    setActiveInvocationRoute,
    providerLabels,
    thinkingModeOptions,
    invocationRouteDefinitions,
    routingProfileOptions,
    updateEditableSettings,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  const updateProviderSettings = (
    current: ProjectSettings,
    providerId: ProviderId,
    updates: Partial<ProjectSettings["aiProvider"]["providers"][ProviderId]>,
  ): ProjectSettings => ({
    ...current,
    aiProvider: {
      ...current.aiProvider,
      providers: {
        ...current.aiProvider.providers,
        [providerId]: {
          ...current.aiProvider.providers[providerId],
          ...updates,
        },
      },
    },
  });

  const updateInvocationRouteSettings = (
    current: ProjectSettings,
    routeId: InvocationRoutingId,
    updates: Partial<ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]>,
  ): ProjectSettings => ({
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
  });

  const updateInvocationProviderOverride = (
    current: ProjectSettings,
    routeId: InvocationRoutingId,
    providerId: ProviderId,
    updates: Partial<ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["providers"][ProviderId]>,
  ): ProjectSettings => ({
    ...current,
    aiProvider: {
      ...current.aiProvider,
      invocationRouting: {
        ...current.aiProvider.invocationRouting,
        [routeId]: {
          ...current.aiProvider.invocationRouting[routeId],
          providers: {
            ...current.aiProvider.invocationRouting[routeId].providers,
            [providerId]: {
              ...(current.aiProvider.invocationRouting[routeId].providers[providerId] || {}),
              ...updates,
            },
          },
        },
      },
    },
  });

  const toggleInvocationAllowedProvider = (
    current: ProjectSettings,
    routeId: InvocationRoutingId,
    providerId: ProviderId,
  ): ProjectSettings => {
    const route = current.aiProvider.invocationRouting[routeId];
    const allowed = route.allowedProviders.includes(providerId)
      ? route.allowedProviders.filter((id: string) => id !== providerId)
      : [...route.allowedProviders, providerId];

    return updateInvocationRouteSettings(current, routeId, { allowedProviders: allowed });
  };

    if (!editableSettings) {
      return null;
    }

    const dockerExecutionEnabled = editableSettings.cliWorkflow.executionMode === "DOCKER";
    const virtualWorkerModeEnabled = editableSettings.workers.executionMode === "VIRTUAL";
    const connectedState = systemSettings ? {
      jules: Boolean(systemSettings.integrations.julesApiKey.trim()),
      gemini: Boolean(systemSettings.integrations.geminiApiKey.trim() || editableSettings.cliWorkflow.containerMountGeminiAuth),
      codex: Boolean(systemSettings.integrations.codexApiKey.trim() || editableSettings.cliWorkflow.containerMountCodexAuth),
      "claude-code": Boolean(systemSettings.integrations.claudeCodeApiKey.trim() || editableSettings.cliWorkflow.containerMountClaudeCodeAuth),
    } : null;

    const getProviderAuthLabel = (
      providerId: keyof ProjectSettings["aiProvider"]["providers"],
    ): string | null => {
      if (!systemSettings) {
        return null;
      }

      if (providerId === "jules") {
        return systemSettings.integrations.julesApiKey.trim() ? "API key" : null;
      }

      const apiKeyPresent = providerId === "gemini"
        ? Boolean(systemSettings.integrations.geminiApiKey.trim())
        : providerId === "codex"
          ? Boolean(systemSettings.integrations.codexApiKey.trim())
          : Boolean(systemSettings.integrations.claudeCodeApiKey.trim());

      const localAuthEnabled = dockerExecutionEnabled && (
        providerId === "gemini"
          ? editableSettings.cliWorkflow.containerMountGeminiAuth
          : providerId === "codex"
            ? editableSettings.cliWorkflow.containerMountCodexAuth
            : editableSettings.cliWorkflow.containerMountClaudeCodeAuth
      );

      if (localAuthEnabled && apiKeyPresent) {
        return "Local auth + API key";
      }
      if (localAuthEnabled) {
        return "Local auth";
      }
      if (apiKeyPresent) {
        return "API key";
      }
      return null;
    };

    const visibleProviders = Object.entries(editableSettings.aiProvider.providers).filter(([providerId]) => (
      connectedState ? connectedState[providerId as keyof typeof connectedState] : true
    ));
    const invocationVisibleProviders = visibleProviders.map(([providerId]) => providerId as ProviderId);
    const resolvedActiveProviderId = visibleProviders.some(([providerId]) => providerId === activeProviderPanel)
      ? activeProviderPanel
      : invocationVisibleProviders[0];
    const activeProviderSettings = resolvedActiveProviderId
      ? editableSettings.aiProvider.providers[resolvedActiveProviderId]
      : null;
    const getInvocationBaseModel = (routeId: InvocationRoutingId, providerId: ProviderId): string => {
      const route = editableSettings.aiProvider.invocationRouting[routeId];
      if (
        route.profile === "WORKER"
        && providerId === editableSettings.workers.virtualWorkerProvider
        && editableSettings.workers.model
        && editableSettings.workers.model !== "default"
      ) {
        return editableSettings.workers.model;
      }
      return editableSettings.aiProvider.providers[providerId].model;
    };
    const getInvocationBaseThinkingMode = (providerId: ProviderId): ThinkingMode => (
      editableSettings.aiProvider.providers[providerId].thinkingMode
    );

    return (
<div className="flex flex-col gap-5">
        <SectionCard title="Worker Runtime" watermark="WRK" badge={getBadge("workers")}>
          <Row label="Worker execution mode" description="Choose whether worker-owned dispatches and supervision run through connected MCP listeners or a short-lived internal virtual worker." badge={getFieldBadge("workers.executionMode")}>
            <PillChoiceGroup
              value={editableSettings.workers.executionMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  executionMode: value as ProjectSettings["workers"]["executionMode"],
                },
              }))}
              options={[
                { value: "CONNECTED_MCP", label: "Connected MCP", hint: "Use connected external workers." },
                { value: "VIRTUAL", label: "Virtual", hint: "Spin up an internal CLI worker only when needed." },
              ]}
            />
          </Row>
          {virtualWorkerModeEnabled ? (
            <>
              <Row label="Virtual worker CLI" description="Preferred CLI provider for virtual workers. They start only when worker work exists, handle one cycle, then shut down. Jules is intentionally excluded." badge={getFieldBadge("workers.virtualWorkerProvider")}>
                <SelectInput
                  value={editableSettings.workers.virtualWorkerProvider}
                  onChange={(value) => updateEditableSettings((current) => ({
                    ...current,
                    workers: {
                      ...current.workers,
                      virtualWorkerProvider: value as ProjectSettings["workers"]["virtualWorkerProvider"],
                      model: "default",
                    },
                  }))}
                  options={[
                    { value: "gemini", label: "Gemini" },
                    { value: "codex", label: "Codex" },
                    { value: "claude-code", label: "Claude Code" },
                  ]}
                />
              </Row>
              <Row label="Worker model" description="Override the global model for virtual workers. If set to 'Default', the global model for the selected CLI provider is used." badge={getFieldBadge("workers.model")}>
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
                    { value: "default", label: `Default (${editableSettings.aiProvider.providers[editableSettings.workers.virtualWorkerProvider].model})` },
                    ...getProviderModelOptions(editableSettings.workers.virtualWorkerProvider),
                  ]}
                />
              </Row>
            </>
          ) : null}
          <Row label="Max concurrency" description="Maximum number of parallel tasks a worker can handle simultaneously." badge={getFieldBadge("workers.maxConcurrency")}>
            <NumberInput
              value={editableSettings.workers.maxConcurrency}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  maxConcurrency: value,
                },
              }))}
              min={1}
              max={20}
            />
          </Row>
          <Row label="Dispatch timeout" description="Seconds to wait for a worker to finish a single task dispatch before timing out." badge={getFieldBadge("workers.timeoutSeconds")} last>
            <NumberInput
              value={editableSettings.workers.timeoutSeconds}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                workers: {
                  ...current.workers,
                  timeoutSeconds: value,
                },
              }))}
              min={60}
              max={3600}
            />
          </Row>
        </SectionCard>

        <SectionCard title="Provider Routing" watermark="MDL" badge={getBadge("aiProvider")}>
          <Row label="Routing strategy" description="Manual pins one provider, weighted distributes tasks, orchestrator can decide at runtime." badge={getFieldBadge("aiProvider.strategy")} last={editableSettings.aiProvider.strategy !== "MANUAL"}>
            <PillChoiceGroup
              value={editableSettings.aiProvider.strategy}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                aiProvider: {
                  ...current.aiProvider,
                  strategy: value as ProjectSettings["aiProvider"]["strategy"],
                },
              }))}
              options={[
                { value: "MANUAL", label: "Manual", hint: "Single pinned provider." },
                { value: "WEIGHTED", label: "Weighted", hint: "Distribute by configured weight." },
                { value: "ORCHESTRATOR", label: "Orchestrator", hint: "Leave the final decision to runtime." },
              ]}
            />
          </Row>
          {editableSettings.aiProvider.strategy === "MANUAL" ? (
            <Row label="Primary provider" description="Default provider when routing strategy is manual." badge={getFieldBadge("aiProvider.provider")} last>
              <SelectInput
                value={editableSettings.aiProvider.provider}
                onChange={(value) => updateEditableSettings((current) => ({
                  ...current,
                  aiProvider: {
                    ...current.aiProvider,
                    provider: value as ProjectSettings["aiProvider"]["provider"],
                  },
                }))}
                options={[
                  { value: "jules", label: "Jules" },
                  { value: "gemini", label: "Gemini" },
                  { value: "codex", label: "Codex" },
                  { value: "claude-code", label: "Claude Code" },
                ]}
              />
            </Row>
          ) : null}
          <div className="mt-6">
            {visibleProviders.length === 0 ? (
              <NoticePanel title="No available providers">
                Configure a provider in Integrations first. The provider pool only shows backends that are currently available from system credentials or Docker auth mounts.
              </NoticePanel>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                <div className="rounded-[1.6rem] border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="mb-3 px-2">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Provider deck</div>
                    <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Pick one provider to edit. The right panel shows the full default model, weight, and thinking configuration.
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {visibleProviders.map(([providerId, provider]) => {
                      const providerKey = providerId as ProviderId;
                      const authLabel = getProviderAuthLabel(providerKey);
                      const isActive = providerId === resolvedActiveProviderId;
                      const isWorkerDefault = editableSettings.workers.virtualWorkerProvider === providerId;
                      const isGlobalDefault = editableSettings.aiProvider.provider === providerId;

                      return (
                        <button
                          key={`provider-panel-${providerId}`}
                          type="button"
                          onClick={() => setActiveProviderPanel(providerKey)}
                          className={`rounded-[1.2rem] border px-4 py-3 text-left transition-all duration-200 ${
                            isActive
                              ? "border-signal-500/25 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)] dark:border-signal-400/25 dark:bg-signal-400/[0.12]"
                              : "border-black/[0.06] bg-white/78 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-void-900/50 dark:hover:border-white/[0.1]"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <ProviderLogo providerId={providerKey} disabled={!provider.enabled} />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className={`text-sm font-semibold ${isActive ? "text-signal-700 dark:text-signal-200" : "text-slate-800 dark:text-slate-100"}`}>
                                  {providerLabels[providerKey as ProviderId]}
                                </div>
                                {!provider.enabled ? (
                                  <span className="rounded-full border border-black/[0.08] bg-black/[0.04] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                                    Disabled
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                                {providerKey === "jules" ? "Managed by Jules API defaults." : provider.model}
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {authLabel ? (
                                  <span className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                                    {authLabel}
                                  </span>
                                ) : null}
                                {isGlobalDefault ? (
                                  <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700 dark:border-signal-400/20 dark:bg-signal-400/[0.1] dark:text-signal-200">
                                    Global default
                                  </span>
                                ) : null}
                                {isWorkerDefault ? (
                                  <span className="rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/[0.12] dark:text-amber-200">
                                    Worker default
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {resolvedActiveProviderId && activeProviderSettings ? (() => {
                  const providerKey = resolvedActiveProviderId;
                  const provider = activeProviderSettings;
                  const supportsModelSelection = providerSupportsModelSelection(providerKey);
                  const supportsThinkingMode = providerSupportsThinkingMode(providerKey);
                  const modelOptions = getProviderModelOptions(providerKey);
                  const cardTokens = PROVIDER_CARD_TOKENS[providerKey as ProviderId];
                  const authLabel = getProviderAuthLabel(providerKey);

                  return (
                    <div
                      className={`group relative overflow-hidden rounded-[1.7rem] border border-black/[0.06] bg-white/74 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.05)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/65 dark:shadow-[0_20px_44px_rgba(0,0,0,0.22)] ${provider.enabled ? "" : "opacity-70"}`}
                    >
                      <div aria-hidden className={`pointer-events-none absolute inset-0 ${cardTokens.glowClassName}`} />
                      <div aria-hidden className={`absolute left-0 top-6 bottom-6 w-1 rounded-r-full ${cardTokens.railClassName}`} />
                      <div aria-hidden className="pointer-events-none absolute -right-2 -top-3 select-none font-display text-[5.5rem] font-black leading-none tracking-tighter text-black/[0.035] dark:text-white/[0.03]">
                        {cardTokens.watermark}
                      </div>

                      <div className="relative z-10 flex flex-col gap-5">
                        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
                          <div className="flex items-start gap-3">
                            <ProviderLogo providerId={providerKey} disabled={!provider.enabled} />
                            <div>
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] ${cardTokens.badgeClassName}`}>
                                  {cardTokens.badgeLabel}
                                </span>
                                {authLabel ? (
                                  <span className="inline-flex items-center rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                                    {authLabel}
                                  </span>
                                ) : null}
                                {editableSettings.workers.virtualWorkerProvider === providerKey ? (
                                  <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/[0.08] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-300/20 dark:bg-amber-300/[0.12] dark:text-amber-200">
                                    Worker default
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xl font-semibold text-slate-900 dark:text-white">
                                {providerLabels[providerKey as ProviderId]}
                              </div>
                              <div className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                                {providerKey === "jules"
                                  ? "Use routing weight and availability to place Jules into the provider pool. Model behavior stays API-managed."
                                  : "Set the global fallback model and thinking behavior used by any invocation route that does not override this provider."}
                              </div>
                            </div>
                          </div>

                          <Toggle
                            value={provider.enabled}
                            onChange={() => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                              enabled: !provider.enabled,
                            }))}
                          />
                        </div>

                        <div className="grid gap-3 md:grid-cols-4">
                          <MetricPill label="Availability" value={provider.enabled ? "Enabled" : "Disabled"} tone={provider.enabled ? "signal" : "neutral"} />
                          <MetricPill label="Default model" value={providerKey === "jules" ? "Managed" : provider.model} />
                          <MetricPill label="Thinking" value={supportsThinkingMode ? provider.thinkingMode : "Managed"} />
                          <MetricPill label="Weight" value={String(provider.weight)} />
                        </div>

                        {!supportsModelSelection || !supportsThinkingMode ? (
                          <div className={`rounded-2xl border px-4 py-3 text-xs font-medium leading-relaxed ${cardTokens.noteClassName}`}>
                            Jules API currently does not expose model selection or thinking controls, so this provider uses Jules-managed defaults.
                          </div>
                        ) : null}

                        <div className={`grid gap-4 ${supportsModelSelection && supportsThinkingMode ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
                          {supportsModelSelection ? (
                            <div>
                              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                <span>Model</span>
                                {getFieldBadge(`aiProvider.providers.${providerKey}.model`) ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                      !
                                    </span>
                                    {getFieldBadge(`aiProvider.providers.${providerKey}.model`)}
                                  </span>
                                ) : null}
                              </div>
                              {modelOptions.length > 0 ? (
                                <SelectInput
                                  value={provider.model}
                                  onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                                    model: value,
                                  }))}
                                  options={modelOptions}
                                />
                              ) : (
                                <TextInput
                                  value={provider.model}
                                  onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                                    model: value,
                                  }))}
                                  mono
                                />
                              )}
                            </div>
                          ) : null}

                          {supportsThinkingMode ? (
                            <div>
                              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                                <span>Thinking mode</span>
                                {getFieldBadge(`aiProvider.providers.${providerKey}.thinkingMode`) ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                      !
                                    </span>
                                    {getFieldBadge(`aiProvider.providers.${providerKey}.thinkingMode`)}
                                  </span>
                                ) : null}
                              </div>
                              <SelectInput
                                value={provider.thinkingMode}
                                onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                                  thinkingMode: value as ThinkingMode,
                                }))}
                                options={thinkingModeOptions}
                              />
                            </div>
                          ) : null}

                          <div>
                            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                              <span>Weight</span>
                              {getFieldBadge(`aiProvider.providers.${providerKey}.weight`) ? (
                                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/12 px-2.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-amber-700 dark:border-amber-300/25 dark:bg-amber-300/14 dark:text-amber-200">
                                  <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-[9px] font-black leading-none text-white dark:bg-amber-300 dark:text-void-900">
                                    !
                                  </span>
                                  {getFieldBadge(`aiProvider.providers.${providerKey}.weight`)}
                                </span>
                              ) : null}
                            </div>
                            <NumberInput
                              value={provider.weight}
                              onChange={(value) => updateEditableSettings((current) => updateProviderSettings(current, providerKey, {
                                weight: value,
                              }))}
                              min={0}
                              max={100}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })() : null}
              </div>
            )}
          </div>
          <div className="mt-6 border-t border-black/[0.06] pt-6 dark:border-white/[0.06]">
            {(() => {
              const activeRouteDefinition = invocationRouteDefinitions.find((definition) => definition.id === activeInvocationRoute)
                ?? invocationRouteDefinitions[0]!;
              const route = editableSettings.aiProvider.invocationRouting[activeRouteDefinition.id];
              const manualProviderValue = route.provider || "__inherit__";
              const activeProviders = route.allowedProviders.length > 0
                ? route.allowedProviders.filter((providerId) => invocationVisibleProviders.includes(providerId))
                : invocationVisibleProviders;

              return (
                <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
                  <div className="rounded-[1.6rem] border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                    <div className="mb-3 px-2">
                      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">Invocation routes</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                        Choose the workflow you want to tune, then adjust its provider profile and overrides.
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      {invocationRouteDefinitions.map((definition) => {
                        const definitionRoute = editableSettings.aiProvider.invocationRouting[definition.id as InvocationRoutingId];
                        const isActive = definition.id === activeInvocationRoute;
                        const poolCount = definitionRoute.allowedProviders.length || invocationVisibleProviders.length;

                        return (
                          <button
                            key={definition.id}
                            type="button"
                            onClick={() => setActiveInvocationRoute(definition.id)}
                            className={`rounded-[1.2rem] border px-4 py-3 text-left transition-all duration-200 ${
                              isActive
                                ? "border-signal-500/25 bg-signal-500/[0.08] shadow-[0_12px_24px_rgba(0,224,160,0.08)] dark:border-signal-400/25 dark:bg-signal-400/[0.12]"
                                : "border-black/[0.06] bg-white/78 hover:border-black/[0.1] hover:bg-white dark:border-white/[0.06] dark:bg-void-900/50 dark:hover:border-white/[0.1]"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className={`text-sm font-semibold ${isActive ? "text-signal-700 dark:text-signal-200" : "text-slate-800 dark:text-slate-100"}`}>
                                  {definition.label}
                                </div>
                                <div className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                                  {definition.description}
                                </div>
                              </div>
                              <div className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${
                                isActive
                                  ? "bg-signal-500/12 text-signal-700 dark:text-signal-200"
                                  : "bg-black/[0.05] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400"
                              }`}>
                                {definitionRoute.profile}
                              </div>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                              <span>{definitionRoute.strategy}</span>
                              <span className="rounded-full bg-black/[0.04] px-2 py-1 dark:bg-white/[0.04]">
                                {poolCount} provider{poolCount === 1 ? "" : "s"}
                              </span>
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
                        <div className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                          {activeRouteDefinition.description}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                          {route.profile} profile
                        </span>
                        <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                          {route.strategy}
                        </span>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-3 md:grid-cols-3">
                      <MetricPill
                        label="Resolved default"
                        value={route.profile === "WORKER"
                          ? providerLabels[editableSettings.workers.virtualWorkerProvider]
                          : providerLabels[editableSettings.aiProvider.provider]}
                        tone="signal"
                      />
                      <MetricPill
                        label="Provider pool"
                        value={`${activeProviders.length} provider${activeProviders.length === 1 ? "" : "s"}`}
                      />
                      <MetricPill
                        label="Overrides"
                        value={`${Object.keys(route.providers).length} provider${Object.keys(route.providers).length === 1 ? "" : "s"}`}
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Profile</div>
                        <PillChoiceGroup
                          value={route.profile}
                          onChange={(value) => updateEditableSettings((current) => updateInvocationRouteSettings(current, activeRouteDefinition.id, {
                            profile: value as ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["profile"],
                            provider: null,
                          }))}
                          options={routingProfileOptions}
                        />
                      </div>
                      <div>
                        <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Strategy</div>
                        <PillChoiceGroup
                          value={route.strategy}
                          onChange={(value) => updateEditableSettings((current) => updateInvocationRouteSettings(current, activeRouteDefinition.id, {
                            strategy: value as ProjectSettings["aiProvider"]["invocationRouting"][InvocationRoutingId]["strategy"],
                          }))}
                          options={[
                            { value: "MANUAL", label: "Manual", hint: "Pin one provider." },
                            { value: "WEIGHTED", label: "Weighted", hint: "Use the route pool." },
                            { value: "ORCHESTRATOR", label: "Orchestrator", hint: "Let runtime choose." },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Primary provider</div>
                      <SelectInput
                        value={manualProviderValue}
                        onChange={(value) => updateEditableSettings((current) => updateInvocationRouteSettings(current, activeRouteDefinition.id, {
                          provider: value === "__inherit__" ? null : value as ProviderId,
                        }))}
                        options={[
                          {
                            value: "__inherit__",
                            label: route.profile === "WORKER"
                              ? `Inherit worker default (${providerLabels[editableSettings.workers.virtualWorkerProvider]})`
                              : `Inherit global default (${providerLabels[editableSettings.aiProvider.provider]})`,
                          },
                          ...invocationVisibleProviders.map((providerId) => ({
                            value: providerId,
                            label: providerLabels[providerId],
                          })),
                        ]}
                        disabled={route.strategy !== "MANUAL"}
                      />
                    </div>

                    <div className="mt-5 rounded-[1.35rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Allowed providers</div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-400">
                          {route.allowedProviders.length === 0
                            ? "Using all eligible providers"
                            : `${route.allowedProviders.length} pinned`}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {invocationVisibleProviders.map((providerId) => {
                          const active = route.allowedProviders.length === 0 || route.allowedProviders.includes(providerId);
                          return (
                            <button
                              key={`${activeRouteDefinition.id}-${providerId}`}
                              type="button"
                              onClick={() => updateEditableSettings((current) => toggleInvocationAllowedProvider(current, activeRouteDefinition.id, providerId))}
                              className={`rounded-full border px-3 py-2 text-[11px] font-semibold tracking-wide transition-colors ${
                                active
                                  ? "border-signal-500/35 bg-signal-500/12 text-signal-700 dark:border-signal-400/35 dark:bg-signal-400/12 dark:text-signal-200"
                                  : "border-black/[0.08] bg-white/78 text-slate-600 dark:border-white/[0.08] dark:bg-void-900/60 dark:text-slate-400"
                              }`}
                            >
                              {providerLabels[providerId]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {activeProviders.length > 0 ? (
                      <div className="mt-5 grid gap-3 lg:grid-cols-2">
                        {activeProviders.map((providerId) => {
                          const override = route.providers[providerId] || {};
                          const supportsModelSelection = providerSupportsModelSelection(providerId);
                          const supportsThinkingMode = providerSupportsThinkingMode(providerId);
                          const modelOptions = getProviderModelOptions(providerId);

                          return (
                            <div key={`${activeRouteDefinition.id}-${providerId}-override`} className="rounded-[1.35rem] border border-black/[0.06] bg-white/82 p-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{providerLabels[providerId]}</div>
                                <div className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                                  Override
                                </div>
                              </div>
                              <div className={`grid gap-3 ${supportsModelSelection && supportsThinkingMode ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
                                {supportsModelSelection ? (
                                  <div>
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Model</div>
                                    <SelectInput
                                      value={override.model || "__inherit__"}
                                      onChange={(value) => updateEditableSettings((current) => updateInvocationProviderOverride(current, activeRouteDefinition.id, providerId, {
                                        model: value === "__inherit__" ? undefined : value,
                                      }))}
                                      options={[
                                        { value: "__inherit__", label: `Inherit (${getInvocationBaseModel(activeRouteDefinition.id, providerId)})` },
                                        ...modelOptions,
                                      ]}
                                    />
                                  </div>
                                ) : null}
                                {supportsThinkingMode ? (
                                  <div>
                                    <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Thinking mode</div>
                                    <SelectInput
                                      value={override.thinkingMode || "__inherit__"}
                                      onChange={(value) => updateEditableSettings((current) => updateInvocationProviderOverride(current, activeRouteDefinition.id, providerId, {
                                        thinkingMode: value === "__inherit__" ? undefined : value as ThinkingMode,
                                      }))}
                                      options={[
                                        { value: "__inherit__", label: `Inherit (${getInvocationBaseThinkingMode(providerId)})` },
                                        ...thinkingModeOptions,
                                      ]}
                                    />
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })()}
          </div>
        </SectionCard>

      </div>
    );
  };
