import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft, Key, Plug, Plus, Settings2 } from "lucide-preact";
import type { SettingsPageState, IntegrationId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel, ActionButton } from "../SettingsSurface.js";
import { ProviderLogo, Row, TextInput, Toggle } from "../SettingsFormFields.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { ProviderInstanceCard } from "../ProviderInstanceCard.js";
import { JiraIcon } from "../../icons/JiraIcon.js";
import type { ProjectSettings, ProviderConfigId, ProviderId, SystemSettings } from "../../../../types.js";
import {
  countConnectedProviders,
  createProjectProviderDraft,
  createSystemProviderDraft,
  getOpenCodeConfiguredModel,
  getQwenConfiguredModel,
  getProviderAuthLabel,
  getProviderTypeLabel,
  getSystemProvidersByType,
  isProviderAvailable,
  sortProviderConfigEntries,
} from "../../../lib/settings-view-models.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];

const DEFAULT_JIRA_SETTINGS: SystemSettings["integrations"]["jira"] = {
  host: "",
  email: "",
  apiToken: "",
  autoCloseLinkedIssues: false,
  defaultProject: "",
  closeTransitionName: "Done",
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

const buildProviderConfigId = (providerId: ProviderId): ProviderConfigId => (
  `${providerId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
);

const getFirstCliProviderConfigId = (providers: ProjectSettings["aiProvider"]["providers"]): ProviderConfigId | null => (
  Object.entries(providers).find(([, provider]) => provider.provider !== "jules")?.[0] || null
);

const syncProjectProvidersToIntegrationCatalog = (
  settings: SystemSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  const nextProjectProviders = Object.fromEntries(
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]) => {
      const existingProvider = settings.defaults.aiProvider.providers[providerConfigId];
      const configuredOpenCodeModel = provider.provider === "opencode"
        ? getOpenCodeConfiguredModel(provider, existingProvider?.model)
        : null;
      const configuredQwenModel = provider.provider === "qwen-code"
        ? getQwenConfiguredModel(provider, existingProvider?.model)
        : null;
      return [
        providerConfigId,
        existingProvider
          ? {
            ...existingProvider,
            provider: provider.provider,
            name: provider.name,
            ...(configuredOpenCodeModel ? { model: configuredOpenCodeModel } : {}),
            ...(configuredQwenModel ? { model: configuredQwenModel } : {}),
          }
          : {
            ...createProjectProviderDraft(provider.provider, provider.name),
            ...(configuredOpenCodeModel ? { model: configuredOpenCodeModel } : {}),
            ...(configuredQwenModel ? { model: configuredQwenModel } : {}),
          },
      ];
    }),
  );

  const nextInvocationRouting = Object.fromEntries(
    Object.entries(settings.defaults.aiProvider.invocationRouting).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        provider: route.provider && nextProjectProviders[route.provider] ? route.provider : null,
        allowedProviders: route.allowedProviders.filter((providerConfigId) => nextProjectProviders[providerConfigId]),
        providers: Object.fromEntries(
          Object.entries(route.providers).filter(([providerConfigId]) => nextProjectProviders[providerConfigId]),
        ),
      },
    ]),
  ) as ProjectSettings["aiProvider"]["invocationRouting"];

  const fallbackGlobalProvider = settings.defaults.aiProvider.provider && nextProjectProviders[settings.defaults.aiProvider.provider]
    ? settings.defaults.aiProvider.provider
    : Object.keys(nextProjectProviders)[0] || null;
  const fallbackWorkerProvider = nextProjectProviders[settings.defaults.workers.virtualWorkerProvider]
    ? settings.defaults.workers.virtualWorkerProvider
    : getFirstCliProviderConfigId(nextProjectProviders)
      || fallbackGlobalProvider
      || settings.defaults.workers.virtualWorkerProvider;

  return {
    ...settings.defaults,
    aiProvider: {
      ...settings.defaults.aiProvider,
      provider: fallbackGlobalProvider,
      providers: nextProjectProviders,
      invocationRouting: nextInvocationRouting,
    },
    workers: {
      ...settings.defaults.workers,
      virtualWorkerProvider: fallbackWorkerProvider,
    },
  };
};

const CatalogActionButton: FunctionComponent<{
  label: string;
  icon: typeof Plus;
  onClick: () => void;
  disabled?: boolean;
  tone?: "primary" | "neutral";
}> = ({ label, icon: Icon, onClick, disabled = false, tone = "neutral" }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[0.9rem] border px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-[background-color,border-color,color,transform,box-shadow] duration-200 hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 ${
      tone === "primary"
        ? "border-signal-500/25 bg-signal-500/[0.1] text-signal-700 shadow-[0_10px_24px_rgba(0,224,160,0.08)] hover:border-signal-500/35 hover:bg-signal-500/[0.15] dark:text-signal-200"
        : "border-black/[0.08] bg-white/72 text-slate-600 hover:border-black/[0.14] hover:bg-white hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-300 dark:hover:border-white/[0.14] dark:hover:bg-white/[0.08] dark:hover:text-white"
    }`}
  >
    <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
    {label}
  </button>
);

const IntegrationPill: FunctionComponent<{
  label: string;
  tone?: "active" | "neutral" | "muted";
}> = ({ label, tone = "neutral" }) => (
  <span
    className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[9px] font-bold uppercase tracking-[0.15em] ${
      tone === "active"
        ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:text-signal-200"
        : tone === "muted"
          ? "border-black/[0.06] bg-black/[0.025] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.035] dark:text-slate-500"
          : "border-black/[0.08] bg-black/[0.035] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-400"
    }`}
  >
    {label}
  </span>
);

export const SettingsIntegrationsPanel: FunctionComponent<{ state: SettingsPageState }> = ({ state }) => {
  const {
    activeScope,
    editableSettings,
    systemSettings,
    projectSources,
    selectedIntegration,
    setSelectedIntegration,
    integrations,
    importingHints,
    externalHints,
    handleImportHints,
    updateEditableSettings,
    updateSystem,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const [activeIntegrationDetail, setActiveIntegrationDetail] = useState<IntegrationId | null>(selectedIntegration);
  const isInitialMount = useRef(true);

  useLayoutEffect(() => {
    if (!containerRef.current || !listRef.current || !detailRef.current) return;

    if (isInitialMount.current) {
      isInitialMount.current = false;
      if (selectedIntegration === null) {
        gsap.set(listRef.current, { display: "block", position: "relative", x: "0%", opacity: 1 });
        gsap.set(detailRef.current, { display: "none", position: "absolute", top: 0, left: 0, x: "100%", opacity: 0 });
      } else {
        gsap.set(listRef.current, { display: "none", position: "relative", x: "-100%", opacity: 0 });
        gsap.set(detailRef.current, { display: "block", position: "relative", top: "auto", left: "auto", x: "0%", opacity: 1 });
        gsap.set(containerRef.current, { height: "auto" });
      }
      return;
    }

    const enteringDetail = selectedIntegration !== null;
    const tl = gsap.timeline();

    if (enteringDetail) {
      setActiveIntegrationDetail(selectedIntegration);
      gsap.set(listRef.current, { display: "block", position: "relative", x: "0%", opacity: 1 });
      gsap.set(detailRef.current, { display: "block", position: "absolute", top: 0, left: 0, x: "100%", opacity: 0 });
      gsap.set(containerRef.current, { height: detailRef.current.offsetHeight });
      tl.to(listRef.current, { x: "-100%", opacity: 0, duration: 0.4, ease: "power3.inOut" }, 0)
        .to(detailRef.current, {
          x: "0%",
          opacity: 1,
          duration: 0.4,
          ease: "power3.inOut",
          onComplete: () => {
            if (listRef.current) gsap.set(listRef.current, { display: "none" });
            if (detailRef.current) gsap.set(detailRef.current, { position: "relative", top: "auto", left: "auto", x: "0%", opacity: 1 });
            if (containerRef.current) gsap.set(containerRef.current, { height: "auto" });
          },
        }, 0);
    } else {
      gsap.set(listRef.current, { display: "block", position: "absolute", top: 0, left: 0, x: "-100%", opacity: 0 });
      gsap.set(detailRef.current, { display: "block", position: "absolute", top: 0, left: 0, x: "0%", opacity: 1 });
      gsap.set(containerRef.current, { height: containerRef.current.offsetHeight });
      tl.to(detailRef.current, {
        x: "100%",
        opacity: 0,
        duration: 0.4,
        ease: "power3.inOut",
        onComplete: () => {
          setActiveIntegrationDetail(null);
          if (detailRef.current) gsap.set(detailRef.current, { display: "none" });
        },
      }, 0).to(listRef.current, {
        x: "0%",
        opacity: 1,
        duration: 0.4,
        ease: "power3.inOut",
        onComplete: () => {
          if (listRef.current) gsap.set(listRef.current, { position: "relative", top: "auto", left: "auto", x: "0%", opacity: 1 });
          if (containerRef.current) gsap.set(containerRef.current, { height: "auto" });
        },
      }, 0);
    }
  }, [selectedIntegration]);

  if (!editableSettings || !systemSettings) {
    return null;
  }

  const dockerExecutionEnabled = editableSettings.cliWorkflow.executionMode === "DOCKER";
  const integrationGroups = [
    {
      id: "api",
      label: "API",
      purpose: "Hosted orchestration and provider services",
      items: integrations.filter((integration) => integration.id === "jules"),
    },
    {
      id: "cli",
      label: "CLI",
      purpose: "Provider credentials and local auth-copy settings",
      items: integrations.filter((integration) => PROVIDER_TYPES.includes(integration.id as ProviderId) && integration.id !== "jules"),
    },
    {
      id: "git",
      label: "GIT",
      purpose: "Source-control tokens, CI, PRs, and git identity",
      items: integrations.filter((integration) => integration.id === "github" || integration.id === "gitlab"),
    },
    {
      id: "pm",
      label: "PM",
      purpose: "Project management and issue tracker connections",
      items: integrations.filter((integration) => integration.id === "jira"),
    },
  ].filter((group) => group.items.length > 0);

  const updateIntegrationProviders = (
    transform: (providers: SystemSettings["integrations"]["providers"]) => SystemSettings["integrations"]["providers"],
  ): void => {
    updateSystem((current) => {
      const nextProviders = transform({ ...current.integrations.providers });
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };
    });
  };

  const addProviderInstance = (providerId: ProviderId): void => {
    if (activeScope !== "system") {
      setSelectedIntegration(providerId);
      return;
    }
    const count = getSystemProvidersByType(systemSettings, providerId).length + 1;
    const providerConfigId = buildProviderConfigId(providerId);
    const providerName = `${getProviderTypeLabel(providerId)} ${count}`;
    updateIntegrationProviders((providers) => ({
      ...providers,
      [providerConfigId]: createSystemProviderDraft(providerId, providerName),
    }));
    setSelectedIntegration(providerId);
  };

  const updateProviderInstance = (
    providerConfigId: ProviderConfigId,
    updates: Partial<SystemSettings["integrations"]["providers"][ProviderConfigId]>,
  ): void => {
    updateSystem((current) => {
      const nextProviders = {
        ...current.integrations.providers,
        [providerConfigId]: {
          ...current.integrations.providers[providerConfigId],
          ...updates,
        },
      };
      return {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };
    });
  };

  const removeProviderInstance = (providerConfigId: ProviderConfigId): void => {
    updateIntegrationProviders((providers) => {
      const nextProviders = { ...providers };
      delete nextProviders[providerConfigId];
      return nextProviders;
    });
  };

  const renderIntegrationDetail = () => {
    const integrationId = activeIntegrationDetail || selectedIntegration;
    if (!integrationId) return null;

    const backButton = (
      <button className="mb-4 flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-white" onClick={() => setSelectedIntegration(null)}>
        <ArrowLeft className="h-4 w-4" />
        Back to Integrations
      </button>
    );

    if (integrationId === "github" || integrationId === "gitlab") {
      const isGitLab = integrationId === "gitlab";
      const hostLabel = isGitLab ? "GitLab" : "GitHub";
      const tokenKey = isGitLab ? "gitlabToken" : "githubToken";
      return (
        <>
          {backButton}
          <SectionCard title={`${hostLabel} Configuration`} watermark={isGitLab ? "GLB" : "GIT"} icon={<Settings2 strokeWidth={2.4} />}>
            {activeScope === "system" ? (
              <Row label={`${hostLabel} token`} description={`System token used for ${hostLabel} repository, ${isGitLab ? "merge request" : "pull request"}, and CI integration.`}>
                <TextInput
                  value={systemSettings.integrations[tokenKey] || ""}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      [tokenKey]: value,
                    },
                  }))}
                  mono
                />
              </Row>
            ) : (
              <NoticePanel title="System-owned token">
                {hostLabel} tokens are stored at system scope. This scope still controls whether Docker copies host git configuration.
              </NoticePanel>
            )}
            {isGitLab ? null : (
              <>
                <Row label="Mount GitHub auth" description="Copy the host `gh` credential directory into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountGithubAuth")}>
                  <Toggle
                    value={editableSettings.cliWorkflow.containerMountGithubAuth}
                    onChange={() => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerMountGithubAuth: !current.cliWorkflow.containerMountGithubAuth,
                      },
                    }))}
                  />
                </Row>
                <Row label="GitHub auth path" description="Host path copied into the Docker runtime for GitHub CLI auth." badge={getFieldBadge("cliWorkflow.containerGithubAuthPath")}>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerGithubAuthPath}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerGithubAuthPath: value,
                      },
                    }))}
                    disabled={!editableSettings.cliWorkflow.containerMountGithubAuth}
                    mono
                  />
                </Row>
              </>
            )}
            <Row label="Copy local git config" description="Use host `.gitconfig` in Docker instead of the configured Code UX git identity." badge={getFieldBadge("cliWorkflow.containerMountGitConfig")} last={editableSettings.cliWorkflow.containerMountGitConfig}>
              <Toggle
                value={editableSettings.cliWorkflow.containerMountGitConfig}
                onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  cliWorkflow: {
                    ...current.cliWorkflow,
                    containerMountGitConfig: !current.cliWorkflow.containerMountGitConfig,
                  },
                }))}
              />
            </Row>
            {!editableSettings.cliWorkflow.containerMountGitConfig ? (
              <>
                <Row label="Git user name" description="Git author name configured inside provider containers." badge={getFieldBadge("cliWorkflow.containerGitUserName")}>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerGitUserName}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerGitUserName: value,
                      },
                    }))}
                    placeholder="Code UX"
                  />
                </Row>
                <Row label="Git email" description="Git author email configured inside provider containers." badge={getFieldBadge("cliWorkflow.containerGitUserEmail")} last>
                  <TextInput
                    value={editableSettings.cliWorkflow.containerGitUserEmail}
                    onChange={(value) => updateEditableSettings((current) => ({
                      ...current,
                      cliWorkflow: {
                        ...current.cliWorkflow,
                        containerGitUserEmail: value,
                      },
                    }))}
                    placeholder="agents@codeux.ai"
                    mono
                  />
                </Row>
              </>
            ) : null}
          </SectionCard>
        </>
      );
    }

    if (integrationId === "jira") {
      const jiraSettings = systemSettings.integrations.jira || DEFAULT_JIRA_SETTINGS;
      const updateJira = (updates: Partial<SystemSettings["integrations"]["jira"]>): void => {
        updateSystem((current) => ({
          ...current,
          integrations: {
            ...current.integrations,
            jira: {
              ...(current.integrations.jira || DEFAULT_JIRA_SETTINGS),
              ...updates,
            },
          },
        }));
      };

      return (
        <>
          {backButton}
          <SectionCard title="Jira Configuration" watermark="JRA" icon={<Settings2 strokeWidth={2.4} />}>
            {activeScope === "system" ? (
              <>
                <Row label="Jira site URL" description="Base URL for Jira Cloud or Data Center, for example `https://company.atlassian.net`.">
                  <TextInput value={jiraSettings.host} onChange={(value) => updateJira({ host: value })} mono />
                </Row>
                <Row label="Account email" description="Email used with Jira Cloud API tokens. Leave empty for bearer-token Jira deployments.">
                  <TextInput value={jiraSettings.email} onChange={(value) => updateJira({ email: value })} mono />
                </Row>
                <Row label="API token" description="Jira API token used for issue search, issue context loading, and transitions.">
                  <TextInput value={jiraSettings.apiToken} onChange={(value) => updateJira({ apiToken: value })} mono />
                </Row>
                <Row label="Default project" description="Project key used to prefill the Jira import JQL.">
                  <TextInput value={jiraSettings.defaultProject} onChange={(value) => updateJira({ defaultProject: value.toUpperCase() })} mono />
                </Row>
                <Row label="Close transition" description="Transition name used when auto-closing linked Jira issues after sprint completion.">
                  <TextInput value={jiraSettings.closeTransitionName} onChange={(value) => updateJira({ closeTransitionName: value })} />
                </Row>
                <Row label="Auto-close Jira issues" description="Move linked Jira issues through the configured transition after the sprint completes." last>
                  <Toggle
                    value={jiraSettings.autoCloseLinkedIssues}
                    onChange={() => updateJira({ autoCloseLinkedIssues: !jiraSettings.autoCloseLinkedIssues })}
                  />
                </Row>
              </>
            ) : (
              <NoticePanel title="System-owned Jira connection">
                Jira site, account, API token, import defaults, and close transition are stored at system scope so every project uses the same trusted integration.
              </NoticePanel>
            )}
          </SectionCard>
        </>
      );
    }

    const providerId = integrationId as ProviderId;
    const providerEntries = sortProviderConfigEntries(getSystemProvidersByType(systemSettings, providerId));

    if (activeScope !== "system") {
      return (
        <>
          {backButton}
          <SectionCard title={`${getProviderTypeLabel(providerId)} Integration`} watermark={getProviderWatermark(providerId)} icon={<Plug strokeWidth={2.4} />}>
            <NoticePanel title="System-owned credentials">
              Provider credentials and auth-copy mounts are managed per instance at system scope. This keeps multiple named providers independent across every route.
            </NoticePanel>
            <NoticePanel title="Scope behavior">
              Project and sprint scopes still control GitHub auth-copy mounts and git config. Provider-specific key or local-auth choices now live on each named provider instance.
            </NoticePanel>
          </SectionCard>
        </>
      );
    }

    return (
      <>
        {backButton}
        <SectionCard title={`${getProviderTypeLabel(providerId)} Credentials`} watermark={getProviderWatermark(providerId)} icon={<Key strokeWidth={2.4} />}>
          <div className="relative overflow-hidden rounded-[1.45rem] border border-black/[0.06] bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(248,250,252,0.62))] px-5 py-4 shadow-[0_14px_34px_rgba(15,23,42,0.045)] dark:border-white/[0.06] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.065),rgba(255,255,255,0.025))]">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-start gap-3">
                <ProviderLogo providerId={providerId} />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{getProviderTypeLabel(providerId)} instances</div>
                  <div className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    Add as many named credentials as you need. AI Models routes each one independently for manual or weighted selection.
                  </div>
                </div>
              </div>
              <CatalogActionButton label="Add instance" icon={Plus} tone="primary" onClick={() => addProviderInstance(providerId)} />
            </div>
          </div>

          {providerEntries.length === 0 ? (
            <NoticePanel title="No credentials yet">
              Add a {getProviderTypeLabel(providerId)} instance to make it available for routing.
            </NoticePanel>
          ) : (
            providerEntries.map(([providerConfigId, provider], index) => {
              const providerModel = systemSettings.defaults.aiProvider.providers[providerConfigId]?.model
                || (provider.provider === "opencode" ? "anthropic/claude-sonnet-4-5" : "qwen3-coder-plus");
              return (
                <ProviderInstanceCard
                  key={providerConfigId}
                  provider={provider}
                  providerModel={providerModel}
                  dockerExecutionEnabled={dockerExecutionEnabled}
                  onUpdate={(updates) => updateProviderInstance(providerConfigId, updates)}
                  onRemove={providerEntries.length > 1 ? () => removeProviderInstance(providerConfigId) : undefined}
                  isLast={index === providerEntries.length - 1}
                  index={index}
                  total={providerEntries.length}
                />
              );
            })
          )}

          <div className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 text-xs leading-relaxed text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400">
            Routing uses named provider instances exactly as configured on the AI Models page. If Docker mode is active, a provider instance marked with local auth will copy only that instance’s configured auth path into the runtime.
          </div>
        </SectionCard>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionCard
        title="Integrations"
        watermark="INT"
        badge={getBadge("integrations", "cliWorkflow")}
        icon={<Plug strokeWidth={2.4} />}
        actions={
          selectedIntegration ? null : (
            <>
              <IntegrationPill label={`${integrations.length} integrations`} />
              <IntegrationPill label={dockerExecutionEnabled ? "Docker auth copy" : "Host execution"} tone={dockerExecutionEnabled ? "active" : "neutral"} />
              <ActionButton label="Import host hints" onClick={() => void handleImportHints()} busy={importingHints} />
            </>
          )
        }
      >
        <div ref={containerRef} className="relative w-full overflow-hidden">
          <div ref={listRef} className="w-full">
            <div className="space-y-4">
              {integrationGroups.map((group, groupIndex) => (
                <div key={group.id} className="space-y-3">
                  {groupIndex > 0 ? <div aria-hidden className="h-px bg-black/[0.06] dark:bg-white/[0.06]" /> : null}
                  <div className="flex flex-wrap items-center gap-3 px-1">
                    <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">{group.label}</div>
                    <div className="h-px min-w-8 flex-1 bg-black/[0.06] dark:bg-white/[0.06]" />
                    <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{group.purpose}</div>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {group.items.map((integration) => {
                  if (integration.id === "github" || integration.id === "gitlab" || integration.id === "jira") {
                    const isGitLab = integration.id === "gitlab";
                    const isJira = integration.id === "jira";
                    const jiraConfigured = Boolean(systemSettings.integrations.jira?.host.trim() && systemSettings.integrations.jira?.apiToken.trim());
                    return (
                      <div key={integration.id} className="group relative min-h-[156px] overflow-hidden rounded-[1.35rem] border border-black/[0.06] bg-white/88 p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-black/[0.12] hover:bg-white hover:shadow-[0_18px_42px_rgba(15,23,42,0.07)] dark:border-white/[0.08] dark:bg-void-800/80 dark:hover:border-white/[0.14] dark:hover:bg-void-800/90">
                        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.12]" />
                        <div className="flex h-full flex-col gap-4">
                          <div className="flex items-start gap-3">
                            {isJira ? (
                              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-[#0052CC]/18 bg-[#0052CC]/10 text-[#0052CC] dark:border-[#4C9AFF]/18 dark:bg-[#4C9AFF]/10 dark:text-[#4C9AFF]" aria-hidden title="Jira">
                                <JiraIcon className="h-6 w-6" />
                              </span>
                            ) : (
                              <ProviderBrandIcon id={integration.id} />
                            )}
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{integration.label}</div>
                                {isJira && jiraConfigured ? <IntegrationPill label="Active" tone="active" /> : null}
                              </div>
                              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{integration.description}</div>
                            </div>
                          </div>
                          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pl-14">
                            <div className="flex flex-wrap gap-2">
                              <IntegrationPill label={isJira ? "Issue tracker" : "Git host"} />
                              <IntegrationPill
                                label={isJira ? (jiraConfigured ? "Search + transitions" : "Not configured") : isGitLab ? "Token + CI" : "Token + auth mount"}
                                tone={isJira && jiraConfigured ? "neutral" : "muted"}
                              />
                            </div>
                            <CatalogActionButton label="Manage" icon={Settings2} onClick={() => setSelectedIntegration(integration.id)} />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const providerId = integration.id as ProviderId;
                  const connectedCount = countConnectedProviders(providerId, systemSettings, externalHints);
                  const active = isProviderAvailable(providerId, systemSettings, externalHints);
                  const authLabel = getProviderAuthLabel(providerId, systemSettings, externalHints, dockerExecutionEnabled);

                  return (
                    <div key={integration.id} className={`group relative min-h-[156px] overflow-hidden rounded-[1.35rem] border p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] transition-[border-color,background-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_42px_rgba(15,23,42,0.07)] ${
                      active
                        ? "border-signal-500/24 bg-white/90 hover:border-signal-500/34 dark:border-signal-400/24 dark:bg-void-800/82 dark:hover:border-signal-400/34 dark:hover:bg-void-800/92"
                        : "border-black/[0.06] bg-white/88 hover:border-black/[0.12] hover:bg-white dark:border-white/[0.08] dark:bg-void-800/78 dark:hover:border-white/[0.14] dark:hover:bg-void-800/88"
                    }`}>
                      <div aria-hidden className={`absolute left-0 top-5 bottom-5 w-1 rounded-r-full transition-opacity ${active ? "bg-signal-500 opacity-100 dark:bg-signal-400" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
                      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.12]" />
                      <div className="flex h-full flex-col gap-4">
                        <div className="flex items-start gap-3">
                          <ProviderLogo providerId={providerId} disabled={!active} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">{integration.label}</div>
                              {active ? <IntegrationPill label="Active" tone="active" /> : null}
                            </div>
                            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{integration.description}</div>
                          </div>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pl-14">
                          <div className="flex flex-wrap gap-2">
                            <IntegrationPill label={`${connectedCount} connected`} tone={connectedCount > 0 ? "neutral" : "muted"} />
                            {authLabel ? <IntegrationPill label={authLabel} /> : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <CatalogActionButton
                              label="Add"
                              icon={Plus}
                              disabled={activeScope !== "system"}
                              tone="primary"
                              onClick={() => addProviderInstance(providerId)}
                            />
                            <CatalogActionButton label="Manage" icon={Settings2} onClick={() => setSelectedIntegration(providerId)} />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div ref={detailRef} className="w-full">
            {renderIntegrationDetail()}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
