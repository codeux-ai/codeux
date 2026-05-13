import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { ArrowLeft, Plus, Settings2, Trash2 } from "lucide-preact";
import type { SettingsPageState, IntegrationId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel, ActionButton } from "../SettingsSurface.js";
import { PillChoiceGroup, ProviderLogo, Row, SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import type { ProjectSettings, ProviderConfigId, ProviderId, SystemSettings } from "../../../../types.js";
import {
  countConnectedProviders,
  createProjectProviderDraft,
  createSystemProviderDraft,
  getProviderAuthLabel,
  getProviderTypeLabel,
  getSystemProvidersByType,
  isProviderAvailable,
  sortProviderConfigEntries,
} from "../../../lib/settings-view-models.js";
import { SectionCard, getBadge as getBadgeHelper, getFieldBadge as getFieldBadgeHelper } from "./SharedPanelComponents.js";

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode"];

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

const buildOpenCodeConfigPreview = (
  provider: SystemSettings["integrations"]["providers"][ProviderConfigId],
  model: string,
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
          baseURL: provider.openCodeBaseUrl || "https://api.openai.com/v1",
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
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]) => [
      providerConfigId,
      settings.defaults.aiProvider.providers[providerConfigId]
        ? {
          ...settings.defaults.aiProvider.providers[providerConfigId],
          provider: provider.provider,
          name: provider.name,
        }
        : createProjectProviderDraft(provider.provider, provider.name),
    ]),
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

    if (integrationId === "github") {
      return (
        <>
          {backButton}
          <SectionCard title="Git Host Configuration" watermark="GIT">
            {activeScope === "system" ? (
              <Row label="GitHub token" description="System token used for repository, PR, and CI integration.">
                <TextInput
                  value={systemSettings.integrations.githubToken}
                  onChange={(value) => updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      githubToken: value,
                    },
                  }))}
                  mono
                />
              </Row>
            ) : (
              <NoticePanel title="System-owned token">
                GitHub tokens are stored at system scope. This scope still controls whether Docker copies host git credentials.
              </NoticePanel>
            )}
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
            <NoticePanel title="GitLab status">
              GitLab CLI support is already present in the backend via `glab`, host detection, and GitLab CI queries. Dashboard token storage is still GitHub-only right now, so GitLab tokens currently come from `GITLAB_TOKEN` or `GLAB_TOKEN`.
            </NoticePanel>
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
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.3rem] border border-black/[0.06] bg-black/[0.02] px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{getProviderTypeLabel(providerId)} instances</div>
              <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Add as many named credentials as you need. AI Models routes each one independently for manual or weighted selection.
              </div>
            </div>
            <ActionButton label="Add instance" onClick={() => addProviderInstance(providerId)} />
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
              <div key={providerConfigId} className="rounded-[1.45rem] border border-black/[0.06] bg-white/82 p-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
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
                    <Row label="Generated config preview" description="Masked OpenCode config injected through OPENCODE_CONFIG_CONTENT for host and Docker runs." last={index === providerEntries.length - 1}>
                      <pre className="max-h-72 min-w-[280px] overflow-auto rounded-[1rem] border border-black/[0.06] bg-black/[0.04] p-3 text-left font-mono text-[11px] leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                        {buildOpenCodeConfigPreview(provider, providerModel)}
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
            <div className="rounded-[1.5rem] border border-black/[0.06] bg-black/[0.02] p-4 dark:border-white/[0.06] dark:bg-white/[0.03]">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.06] pb-4 dark:border-white/[0.06]">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Integration catalog</div>
                  <div className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    Add and manage named provider credentials. The AI Models page routes each configured instance independently.
                  </div>
                </div>
                <ActionButton label="Import host hints" onClick={() => void handleImportHints()} busy={importingHints} />
              </div>

              <div className="flex flex-col gap-3">
                {integrations.map((integration, index) => {
                  if (integration.id === "github") {
                    return (
                      <div key={integration.id} className={`flex items-center justify-between gap-4 rounded-[1.25rem] border border-black/[0.06] bg-white/82 px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.04] ${index === integrations.length - 1 ? "" : ""}`}>
                        <div className="flex items-start gap-3">
                          <ProviderBrandIcon id="github" />
                          <div>
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{integration.label}</div>
                            <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{integration.description}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => setSelectedIntegration("github")} className="rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
                            Manage
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const providerId = integration.id as ProviderId;
                  const connectedCount = countConnectedProviders(providerId, systemSettings, externalHints);
                  const active = isProviderAvailable(providerId, systemSettings, externalHints);
                  const authLabel = getProviderAuthLabel(providerId, systemSettings, externalHints, dockerExecutionEnabled);

                  return (
                    <div key={integration.id} className="flex items-center justify-between gap-4 rounded-[1.25rem] border border-black/[0.06] bg-white/82 px-4 py-4 dark:border-white/[0.06] dark:bg-white/[0.04]">
                      <div className="flex items-start gap-3">
                        <ProviderLogo providerId={providerId} disabled={!active} />
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{integration.label}</div>
                            {active ? (
                              <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.16em] text-signal-700 dark:text-signal-200">
                                Active
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{integration.description}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                              {connectedCount} connected
                            </span>
                            {authLabel ? (
                              <span className="rounded-full border border-black/[0.08] bg-black/[0.03] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                                {authLabel}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={activeScope !== "system"}
                          onClick={() => addProviderInstance(providerId)}
                          className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-200"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedIntegration(providerId)}
                          className="rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
                        >
                          Manage
                        </button>
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
