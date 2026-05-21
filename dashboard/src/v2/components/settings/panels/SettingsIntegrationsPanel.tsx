import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft, Plus, Settings2, Trash2 } from "lucide-preact";
import type { SettingsPageState, IntegrationId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel, ActionButton } from "../SettingsSurface.js";
import { PillChoiceGroup, ProviderLogo, Row, SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { JiraIcon } from "../../icons/JiraIcon.js";
import type { ProjectSettings, ProviderConfigId, ProviderId, SystemSettings } from "../../../../types.js";
import {
  countConnectedProviders,
  createProjectProviderDraft,
  createSystemProviderDraft,
  getOpenCodeConfiguredModel,
  getProviderAuthLabel,
  getProviderTypeLabel,
  getSystemProvidersByType,
  isProviderAvailable,
  sortProviderConfigEntries,
} from "../../../lib/settings-view-models.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode"];

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
            : "CLD"
);

const qwenAuthModeOptions = [
  { value: "LOCAL_AUTH", label: "Local auth", hint: "Copy ~/.qwen OAuth cache" },
  { value: "ALIBABA_CODING_PLAN", label: "Coding Plan", hint: "Alibaba Cloud key + region" },
  { value: "MODEL_PROVIDER", label: "Custom endpoint", hint: "modelProviders settings" },
];

const qwenProtocolOptions = [
  { value: "openai", label: "OpenAI-compatible" },
  { value: "anthropic", label: "Anthropic" },
  { value: "gemini", label: "Gemini" },
];

const qwenRegionOptions = [
  { value: "international", label: "International" },
  { value: "china", label: "China" },
];

const openCodeAuthModeOptions = [
  { value: "LOCAL_AUTH", label: "Local auth", hint: "Copy auth.json cache" },
  { value: "ENV_KEY", label: "Provider key", hint: "Built-in OpenCode provider" },
  { value: "CUSTOM_PROVIDER", label: "Custom endpoint", hint: "OpenAI-compatible config" },
];

const getQwenEndpointForRegion = (region: string | undefined): string => (
  region === "china"
    ? "https://coding.dashscope.aliyuncs.com/v1"
    : "https://coding-intl.dashscope.aliyuncs.com/v1"
);

const maskSecret = (value: string): string => value.trim() ? "********" : "";

const buildQwenSettingsPreview = (
  provider: SystemSettings["integrations"]["providers"][ProviderConfigId],
  model: string,
): string => {
  const authMode = provider.qwenAuthMode || "LOCAL_AUTH";
  const envKey = authMode === "ALIBABA_CODING_PLAN"
    ? "BAILIAN_CODING_PLAN_API_KEY"
    : provider.qwenEnvKey || "DASHSCOPE_API_KEY";
  const baseUrl = authMode === "ALIBABA_CODING_PLAN"
    ? getQwenEndpointForRegion(provider.qwenRegion)
    : provider.qwenBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  const protocol = provider.qwenProtocol || "openai";
  const primaryProvider = {
    id: model || "qwen3-coder-plus",
    name: provider.name,
    baseUrl,
    description: authMode === "ALIBABA_CODING_PLAN" ? "Qwen via Alibaba Cloud Coding Plan" : "Qwen custom model provider",
    envKey,
  };
  const additional = (provider.qwenAdditionalModelProviders || []).map((entry) => ({
    id: entry.id,
    name: entry.name || entry.id,
    baseUrl: entry.baseUrl,
    description: entry.description,
    envKey: entry.envKey,
  }));
  return JSON.stringify({
    modelProviders: {
      [protocol]: [primaryProvider, ...additional],
    },
    env: {
      [envKey]: maskSecret(provider.apiKey),
      ...Object.fromEntries((provider.qwenAdditionalModelProviders || []).map((entry) => [entry.envKey, maskSecret(entry.apiKey)])),
    },
    security: {
      auth: {
        selectedType: protocol,
      },
    },
    model: {
      name: model || "qwen3-coder-plus",
    },
    ...(authMode === "ALIBABA_CODING_PLAN" ? { codingPlan: { region: provider.qwenRegion || "international" } } : {}),
  }, null, 2);
};

const splitOpenCodeModel = (model: string): { providerId: string; modelId: string } => {
  const [providerId, ...modelParts] = (model || "anthropic/claude-sonnet-4-5").split("/");
  return {
    providerId: providerId || "anthropic",
    modelId: modelParts.join("/") || "claude-sonnet-4-5",
  };
};

const rewriteDockerLoopbackUrl = (rawUrl: string, dockerExecutionEnabled: boolean): string => {
  if (!dockerExecutionEnabled) {
    return rawUrl;
  }
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]") {
      url.hostname = "host.docker.internal";
      return url.toString();
    }
  } catch {
    return rawUrl;
  }
  return rawUrl;
};

const buildOpenCodeConfigPreview = (
  provider: SystemSettings["integrations"]["providers"][ProviderConfigId],
  model: string,
  dockerExecutionEnabled: boolean,
): string => {
  const authMode = provider.openCodeAuthMode || "LOCAL_AUTH";
  const modelParts = splitOpenCodeModel(model);
  const providerId = provider.openCodeProviderId || modelParts.providerId;
  const modelId = provider.openCodeModelId || modelParts.modelId;
  const selectedModel = authMode === "CUSTOM_PROVIDER" ? `${providerId}/${modelId}` : model || `${providerId}/${modelId}`;
  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    model: selectedModel,
    autoupdate: false,
  };
  if (authMode === "ENV_KEY") {
    config.provider = {
      [providerId]: {
        options: {
          apiKey: "{env:OPENCODE_API_KEY}",
        },
      },
    };
  }
  if (authMode === "CUSTOM_PROVIDER") {
    config.provider = {
      [providerId]: {
        npm: provider.openCodePackage || "@ai-sdk/openai-compatible",
        name: providerId,
        options: {
          baseURL: rewriteDockerLoopbackUrl(provider.openCodeBaseUrl || "https://api.openai.com/v1", dockerExecutionEnabled),
          apiKey: "{env:OPENCODE_API_KEY}",
        },
        models: {
          [modelId]: { name: modelId },
        },
      },
    };
  }
  return JSON.stringify({
    ...config,
    env: {
      [provider.openCodeEnvKey || "ANTHROPIC_API_KEY"]: maskSecret(provider.apiKey),
      OPENCODE_API_KEY: maskSecret(provider.apiKey),
    },
  }, null, 2);
};

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
      return [
        providerConfigId,
        existingProvider
          ? {
            ...existingProvider,
            provider: provider.provider,
            name: provider.name,
            ...(configuredOpenCodeModel ? { model: configuredOpenCodeModel } : {}),
          }
          : {
            ...createProjectProviderDraft(provider.provider, provider.name),
            ...(configuredOpenCodeModel ? { model: configuredOpenCodeModel } : {}),
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
          <SectionCard title={`${hostLabel} Configuration`} watermark={isGitLab ? "GLB" : "GIT"}>
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
            <Row label="Mount git config" description="Share host `.gitconfig` with Docker for repository identity and git defaults." badge={getFieldBadge("cliWorkflow.containerMountGitConfig")} last>
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
          <SectionCard title="Jira Configuration" watermark="JRA">
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
          <SectionCard title={`${getProviderTypeLabel(providerId)} Integration`} watermark={getProviderWatermark(providerId)}>
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
        <SectionCard title={`${getProviderTypeLabel(providerId)} Credentials`} watermark={getProviderWatermark(providerId)}>
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
              <div key={providerConfigId} className="space-y-3 rounded-[1.45rem] border border-black/[0.06] bg-white/84 p-5 shadow-[0_16px_38px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
                  <div className="flex items-start gap-3">
                    <ProviderLogo providerId={provider.provider} />
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{provider.name}</div>
                      <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{getProviderTypeLabel(provider.provider)} instance</div>
                    </div>
                  </div>
                  {providerEntries.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => removeProviderInstance(providerConfigId)}
                      className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/[0.06] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-status-red"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove
                    </button>
                  ) : null}
                </div>
                <Row label="Display name" description="Used throughout AI Models and runtime route summaries.">
                  <TextInput value={provider.name} onChange={(value) => updateProviderInstance(providerConfigId, { name: value })} />
                </Row>
                <Row label="API key" description="Stored for this named provider instance.">
                  <TextInput value={provider.apiKey} onChange={(value) => updateProviderInstance(providerConfigId, { apiKey: value })} mono />
                </Row>
                {provider.provider === "qwen-code" ? (
                  <>
                    <Row label="Authentication mode" description="Choose how this Qwen instance should authenticate and generate its runtime settings.">
                      <PillChoiceGroup
                        value={provider.qwenAuthMode || "LOCAL_AUTH"}
                        onChange={(value) => updateProviderInstance(providerConfigId, { qwenAuthMode: value as SystemSettings["integrations"]["providers"][ProviderConfigId]["qwenAuthMode"] })}
                        options={qwenAuthModeOptions}
                      />
                    </Row>
                    {(provider.qwenAuthMode || "LOCAL_AUTH") === "LOCAL_AUTH" ? (
                      <>
                        <Row label="Mount Qwen auth" description="Copy local Qwen OAuth/cache files into Docker for browser-authenticated Qwen Code runs.">
                          <Toggle
                            value={provider.mountAuth}
                            onChange={() => updateProviderInstance(providerConfigId, { mountAuth: !provider.mountAuth })}
                          />
                        </Row>
                        <Row label="Qwen auth path" description="Usually `~/.qwen`; contains settings.json, .env, and cached OAuth state.">
                          <TextInput value={provider.authPath} onChange={(value) => updateProviderInstance(providerConfigId, { authPath: value })} disabled={!provider.mountAuth} mono />
                        </Row>
                      </>
                    ) : null}
                    {(provider.qwenAuthMode || "LOCAL_AUTH") === "ALIBABA_CODING_PLAN" ? (
                      <>
                        <Row label="Coding Plan region" description="Controls the dedicated Alibaba Cloud Coding Plan endpoint.">
                          <SelectInput
                            value={provider.qwenRegion || "international"}
                            onChange={(value) => updateProviderInstance(providerConfigId, {
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
                    ) : null}
                    {(provider.qwenAuthMode || "LOCAL_AUTH") === "MODEL_PROVIDER" ? (
                      <>
                        <Row label="Provider protocol" description="Qwen Code groups modelProviders by API protocol.">
                          <SelectInput
                            value={provider.qwenProtocol || "openai"}
                            onChange={(value) => updateProviderInstance(providerConfigId, { qwenProtocol: value as "openai" | "anthropic" | "gemini" })}
                            options={qwenProtocolOptions}
                          />
                        </Row>
                        <Row label="Environment key" description="Variable name Qwen reads for this instance's API key.">
                          <TextInput value={provider.qwenEnvKey || "DASHSCOPE_API_KEY"} onChange={(value) => updateProviderInstance(providerConfigId, { qwenEnvKey: value })} mono />
                        </Row>
                        <Row label="Base URL" description="OpenAI-compatible, Anthropic, Gemini, or local endpoint used by this model entry.">
                          <TextInput value={provider.qwenBaseUrl || "https://dashscope.aliyuncs.com/compatible-mode/v1"} onChange={(value) => updateProviderInstance(providerConfigId, { qwenBaseUrl: value })} mono />
                        </Row>
                      </>
                    ) : null}
                    <Row label="Generated settings preview" description="Masked Qwen settings.json fragment produced for Docker runtime." last={index === providerEntries.length - 1}>
                      <pre className="max-h-72 min-w-[280px] overflow-auto rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                        {buildQwenSettingsPreview(provider, providerModel)}
                      </pre>
                    </Row>
                  </>
                ) : provider.provider === "opencode" ? (
                  <>
                    <Row label="Authentication mode" description="Choose how this OpenCode instance authenticates and how its runtime opencode.json is generated.">
                      <PillChoiceGroup
                        value={provider.openCodeAuthMode || "LOCAL_AUTH"}
                        onChange={(value) => updateProviderInstance(providerConfigId, { openCodeAuthMode: value as SystemSettings["integrations"]["providers"][ProviderConfigId]["openCodeAuthMode"] })}
                        options={openCodeAuthModeOptions}
                      />
                    </Row>
                    {(provider.openCodeAuthMode || "LOCAL_AUTH") === "LOCAL_AUTH" ? (
                      <>
                        <Row label="Mount OpenCode auth" description="Copy OpenCode auth.json and related local auth state into Docker.">
                          <Toggle
                            value={provider.mountAuth}
                            onChange={() => updateProviderInstance(providerConfigId, { mountAuth: !provider.mountAuth })}
                          />
                        </Row>
                        <Row label="OpenCode auth path" description="Usually `~/.local/share/opencode`; contains auth.json created by `/connect` or `opencode auth login`.">
                          <TextInput value={provider.authPath} onChange={(value) => updateProviderInstance(providerConfigId, { authPath: value })} disabled={!provider.mountAuth} mono />
                        </Row>
                      </>
                    ) : null}
                    {(provider.openCodeAuthMode || "LOCAL_AUTH") !== "LOCAL_AUTH" ? (
                      <>
                        <Row label="Provider id" description="The provider segment in OpenCode's `provider/model` selector.">
                          <TextInput value={provider.openCodeProviderId || splitOpenCodeModel(providerModel).providerId} onChange={(value) => updateProviderInstance(providerConfigId, { openCodeProviderId: value })} mono />
                        </Row>
                        <Row label="Environment key" description="Host environment variable to import when the stored API key is empty. Runtime config maps it to OPENCODE_API_KEY.">
                          <TextInput value={provider.openCodeEnvKey || "ANTHROPIC_API_KEY"} onChange={(value) => updateProviderInstance(providerConfigId, { openCodeEnvKey: value })} mono />
                        </Row>
                      </>
                    ) : null}
                    {(provider.openCodeAuthMode || "LOCAL_AUTH") === "CUSTOM_PROVIDER" ? (
                      <>
                        <Row label="Model id" description="The model segment registered under the custom provider.">
                          <TextInput value={provider.openCodeModelId || splitOpenCodeModel(providerModel).modelId} onChange={(value) => updateProviderInstance(providerConfigId, { openCodeModelId: value })} mono />
                        </Row>
                        <Row label="Provider package" description="OpenCode provider adapter package. OpenAI-compatible endpoints use the AI SDK compatible adapter.">
                          <TextInput value={provider.openCodePackage || "@ai-sdk/openai-compatible"} onChange={(value) => updateProviderInstance(providerConfigId, { openCodePackage: value })} mono />
                        </Row>
                        <Row label="Base URL" description="OpenAI-compatible endpoint for OpenRouter, Ollama, vLLM, LM Studio, LiteLLM, or a private gateway.">
                          <TextInput value={provider.openCodeBaseUrl || "https://api.openai.com/v1"} onChange={(value) => updateProviderInstance(providerConfigId, { openCodeBaseUrl: value })} mono />
                        </Row>
                      </>
                    ) : null}
                    <Row label="Generated config preview" description="Masked OpenCode config materialized from OPENCODE_CONFIG_CONTENT for host and Docker runs." last={index === providerEntries.length - 1}>
                      <pre className="max-h-72 min-w-[280px] overflow-auto rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                        {buildOpenCodeConfigPreview(provider, providerModel, dockerExecutionEnabled)}
                      </pre>
                    </Row>
                  </>
                ) : provider.provider !== "jules" ? (
                  <>
                    <Row label="Mount local auth" description={`Use a copied host auth directory for ${getProviderTypeLabel(provider.provider)} instead of, or alongside, an API key.`}>
                      <Toggle
                        value={provider.mountAuth}
                        onChange={() => updateProviderInstance(providerConfigId, { mountAuth: !provider.mountAuth })}
                      />
                    </Row>
                    <Row label="Auth path" description="Host path copied into the Docker runtime for this exact provider instance." last={index === providerEntries.length - 1}>
                      <TextInput
                        value={provider.authPath}
                        onChange={(value) => updateProviderInstance(providerConfigId, { authPath: value })}
                        disabled={!provider.mountAuth}
                        mono
                      />
                    </Row>
                  </>
                ) : (
                  <Row label="Jules auth mode" description="Jules uses API keys only and does not support a local auth mount." last={index === providerEntries.length - 1}>
                    <div className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">API key only</div>
                  </Row>
                )}
              </div>
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
      <SectionCard title="Integrations" watermark="INT" badge={getBadge("integrations", "cliWorkflow")}>
        <div ref={containerRef} className="relative w-full overflow-hidden">
          <div ref={listRef} className="w-full">
            <div className="space-y-4">
              <div className="relative overflow-hidden rounded-[1.55rem] border border-black/[0.06] bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(248,250,252,0.72))] p-5 shadow-[0_18px_44px_rgba(15,23,42,0.055)] dark:border-white/[0.08] dark:bg-[linear-gradient(135deg,rgba(15,23,42,0.88),rgba(15,23,42,0.68))]">
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-signal-500/35 to-transparent" />
                <div aria-hidden className="pointer-events-none absolute -right-14 -top-16 h-44 w-44 rounded-full bg-signal-500/[0.075] blur-3xl" />
                <div className="relative z-10 flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-2xl">
                    <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-signal-700 dark:text-signal-300">Integration catalog</div>
                    <div className="mt-2 text-lg font-semibold tracking-tight text-slate-950 dark:text-white">Provider credentials and source-control auth in one place</div>
                    <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                      Add named provider credentials, import local auth hints, and keep routing targets aligned with AI Models without leaving this workspace.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <IntegrationPill label={`${integrations.length} integrations`} />
                    <IntegrationPill label={dockerExecutionEnabled ? "Docker auth copy" : "Host execution"} tone={dockerExecutionEnabled ? "active" : "neutral"} />
                    <ActionButton label="Import host hints" onClick={() => void handleImportHints()} busy={importingHints} />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-2">
                {integrations.map((integration) => {
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
          </div>

          <div ref={detailRef} className="w-full">
            {renderIntegrationDetail()}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
