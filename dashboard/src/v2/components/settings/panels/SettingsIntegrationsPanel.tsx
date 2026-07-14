import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Activity, ArrowLeft, FolderOpen, Key, MessageCircle, Plug, Plus, RefreshCw, Settings2 } from "lucide-preact";
import type { SettingsPageState, IntegrationId } from "../../../hooks/use-settings-page-state.js";
import { NoticePanel, ActionButton } from "../SettingsSurface.js";
import { NumberInput, PillChoiceGroup, ProviderLogo, Row, SecretInput, SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { ProviderBrandIcon } from "../../providers/ProviderBrandIcon.js";
import { ProviderInstanceCard } from "../ProviderInstanceCard.js";
import { JiraIcon } from "../../icons/JiraIcon.js";
import type {
  ChatProviderKind,
  ProjectSettings,
  ProviderConfigId,
  ProviderId,
  SystemSettings,
} from "../../../../types.js";
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
import { sanitizeSystemProviderConfig } from "../../../lib/provider-runtime-preview.js";
import {
  buildChatProviderCatalogViewModel,
  createDefaultSetupForBridge,
  getChatProviderSetupNotes,
  isChatProviderKind,
} from "../../../lib/chat-provider-view-models.js";
import type {
  DashboardChatProviderConnectionRecord,
  DashboardChatProviderSetupDefinition,
} from "../../../lib/chat-provider-api.js";
import { isDeprecatedProvider, providerLifecycle } from "../../../lib/provider-lifecycle.js";
import { LocalFilePickerField } from "../LocalFilePickerField.js";
import { AutomationCredentialManager } from "../AutomationCredentialManager.js";
import { ActionFeedbackRegion } from "../../ui/ActionFeedbackRegion.js";
import { ChatConnectorCatalogCard } from "../chat-connectors/ChatConnectorCatalogCard.js";
import { ChatConnectorConnectionEditor } from "../chat-connectors/ChatConnectorConnectionEditor.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

type PublicProviderId = Exclude<ProviderId, "mockup-cli">;

const PROVIDER_TYPES: PublicProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];
const isPublicProviderId = (value: unknown): value is PublicProviderId => (
  typeof value === "string" && (PROVIDER_TYPES as readonly string[]).includes(value)
);
const isChatProviderIntegrationId = (value: unknown): value is ChatProviderKind => isChatProviderKind(value);

const DEFAULT_JIRA_SETTINGS: SystemSettings["integrations"]["jira"] = {
  host: "",
  email: "",
  apiToken: "",
  autoTransitionLinkedIssuesOnImport: true,
  importTransitionName: "In Work",
  autoCloseLinkedIssues: false,
  defaultProject: "",
  closeTransitionName: "Done",
};

type ImporterIntegrationId = Extract<IntegrationId, "notion" | "asana" | "linear" | "miro" | "lucid" | "figma" | "mural">;
type ImporterSettings = SystemSettings["integrations"]["notion"];
type ImporterTextField = Exclude<keyof ImporterSettings, "enabled" | "defaultSearchLimit">;

const DEFAULT_IMPORTER_SETTINGS: ImporterSettings = {
  enabled: false,
  apiToken: "",
  apiSecret: "",
  baseUrl: "",
  workspaceId: "",
  teamId: "",
  teamKey: "",
  projectId: "",
  databaseId: "",
  boardId: "",
  documentId: "",
  fileKey: "",
  defaultSearchLimit: 25,
};

const IMPORTER_IDS: readonly ImporterIntegrationId[] = ["notion", "asana", "linear", "miro", "lucid", "figma", "mural"];

const isImporterIntegrationId = (value: unknown): value is ImporterIntegrationId => (
  typeof value === "string" && (IMPORTER_IDS as readonly string[]).includes(value)
);

interface ImporterFieldDefinition {
  key: ImporterTextField;
  label: string;
  description: string;
  placeholder?: string;
  secret?: boolean;
}

interface ImporterDefinition {
  label: string;
  mark: string;
  accentClassName: string;
  fields: ImporterFieldDefinition[];
  requiredFields: ImporterTextField[];
}

const IMPORTER_DEFINITIONS: Record<ImporterIntegrationId, ImporterDefinition> = {
  notion: {
    label: "Notion",
    mark: "NO",
    accentClassName: "border-[#000000]/12 bg-black/[0.06] text-slate-900 dark:border-white/[0.16] dark:bg-white/[0.08] dark:text-white",
    requiredFields: ["apiToken", "databaseId"],
    fields: [
      { key: "workspaceId", label: "Workspace ID", description: "Default Notion workspace used for guided imports.", placeholder: "workspace-id" },
      { key: "databaseId", label: "Database ID", description: "Default Notion database searched by sprint imports.", placeholder: "database-id" },
    ],
  },
  asana: {
    label: "Asana",
    mark: "AS",
    accentClassName: "border-[#F06A6A]/20 bg-[#F06A6A]/10 text-[#B83A3A] dark:border-[#F06A6A]/24 dark:bg-[#F06A6A]/12 dark:text-[#FFB0B0]",
    requiredFields: ["apiToken", "workspaceId"],
    fields: [
      { key: "workspaceId", label: "Workspace GID", description: "Default Asana workspace for task searches.", placeholder: "workspace-gid" },
      { key: "teamId", label: "Team GID", description: "Optional team used to narrow Asana imports.", placeholder: "team-gid" },
      { key: "projectId", label: "Project GID", description: "Default Asana project for issue import searches.", placeholder: "project-gid" },
    ],
  },
  linear: {
    label: "Linear",
    mark: "LN",
    accentClassName: "border-[#5E6AD2]/22 bg-[#5E6AD2]/10 text-[#4B55B8] dark:border-[#9EA5FF]/22 dark:bg-[#9EA5FF]/12 dark:text-[#C7CBFF]",
    requiredFields: ["apiToken", "teamKey"],
    fields: [
      { key: "workspaceId", label: "Workspace URL key", description: "Linear workspace slug or identifier for imports.", placeholder: "company" },
      { key: "teamKey", label: "Team key", description: "Default Linear team key used in guided searches.", placeholder: "ENG" },
      { key: "projectId", label: "Project ID", description: "Optional default Linear project identifier.", placeholder: "project-id" },
    ],
  },
  miro: {
    label: "Miro",
    mark: "MI",
    accentClassName: "border-[#FFD02F]/28 bg-[#FFD02F]/16 text-[#7A5B00] dark:border-[#FFD02F]/28 dark:bg-[#FFD02F]/14 dark:text-[#FFE58A]",
    requiredFields: ["apiToken", "boardId"],
    fields: [
      { key: "teamId", label: "Team ID", description: "Default Miro team used to scope board imports.", placeholder: "team-id" },
      { key: "boardId", label: "Board ID", description: "Default Miro board for read-only import.", placeholder: "board-id" },
    ],
  },
  lucid: {
    label: "Lucid",
    mark: "LC",
    accentClassName: "border-[#FF7A00]/22 bg-[#FF7A00]/10 text-[#A64C00] dark:border-[#FFB36B]/24 dark:bg-[#FFB36B]/12 dark:text-[#FFD2AA]",
    requiredFields: ["apiToken", "documentId"],
    fields: [
      { key: "workspaceId", label: "Workspace ID", description: "Optional Lucid workspace identifier.", placeholder: "workspace-id" },
      { key: "documentId", label: "Document ID", description: "Default Lucid or Lucidspark document to import.", placeholder: "document-id" },
    ],
  },
  figma: {
    label: "Figma / FigJam",
    mark: "FG",
    accentClassName: "border-[#A259FF]/22 bg-[#A259FF]/10 text-[#7A35C5] dark:border-[#C9A4FF]/24 dark:bg-[#C9A4FF]/12 dark:text-[#E0C7FF]",
    requiredFields: ["apiToken", "fileKey"],
    fields: [
      { key: "teamId", label: "Team ID", description: "Optional Figma team used for import searches.", placeholder: "team-id" },
      { key: "projectId", label: "Project ID", description: "Optional Figma project for default file discovery.", placeholder: "project-id" },
      { key: "fileKey", label: "File key", description: "Default Figma or FigJam file key.", placeholder: "file-key" },
    ],
  },
  mural: {
    label: "Mural",
    mark: "MU",
    accentClassName: "border-[#FF4F8B]/22 bg-[#FF4F8B]/10 text-[#B82D5D] dark:border-[#FF9ABC]/24 dark:bg-[#FF9ABC]/12 dark:text-[#FFC6D8]",
    requiredFields: ["apiToken", "boardId"],
    fields: [
      { key: "workspaceId", label: "Workspace ID", description: "Default Mural workspace for imports.", placeholder: "workspace-id" },
      { key: "boardId", label: "Mural ID", description: "Default mural used by read-only imports.", placeholder: "mural-id" },
    ],
  },
};

const getImporterWatermark = (providerId: ImporterIntegrationId): string => IMPORTER_DEFINITIONS[providerId].mark;

const getImporterSettings = (
  providerId: ImporterIntegrationId,
  settings: Partial<Record<ImporterIntegrationId, ImporterSettings>>,
): ImporterSettings => ({
  ...DEFAULT_IMPORTER_SETTINGS,
  ...(settings[providerId] || {}),
});

const isImporterConfigured = (providerId: ImporterIntegrationId, settings: ImporterSettings): boolean => (
  IMPORTER_DEFINITIONS[providerId].requiredFields.every((field) => String(settings[field] || "").trim().length > 0)
);

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

const syncProjectSettingsToIntegrationCatalog = (
  projectSettings: ProjectSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  const nextProjectProviders = Object.fromEntries(
    Object.entries(nextIntegrationProviders).map(([providerConfigId, provider]) => {
      const existingProvider = projectSettings.aiProvider.providers[providerConfigId];
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
    Object.entries(projectSettings.aiProvider.invocationRouting).map(([routeId, route]) => [
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

  const fallbackGlobalProvider = projectSettings.aiProvider.provider && nextProjectProviders[projectSettings.aiProvider.provider]
    ? projectSettings.aiProvider.provider
    : Object.keys(nextProjectProviders)[0] || null;
  const fallbackWorkerProvider = nextProjectProviders[projectSettings.workers.virtualWorkerProvider]
    ? projectSettings.workers.virtualWorkerProvider
    : getFirstCliProviderConfigId(nextProjectProviders)
      || fallbackGlobalProvider
      || projectSettings.workers.virtualWorkerProvider;

  return {
    ...projectSettings,
    aiProvider: {
      ...projectSettings.aiProvider,
      provider: fallbackGlobalProvider,
      providers: nextProjectProviders,
      invocationRouting: nextInvocationRouting,
    },
    workers: {
      ...projectSettings.workers,
      virtualWorkerProvider: fallbackWorkerProvider,
    },
  };
};

const syncProjectProvidersToIntegrationCatalog = (
  settings: SystemSettings,
  nextIntegrationProviders: SystemSettings["integrations"]["providers"],
): ProjectSettings => {
  return syncProjectSettingsToIntegrationCatalog(settings.defaults, nextIntegrationProviders);
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

const EMPTY_CHAT_PROVIDER_STATE = {
  definitions: [],
  connections: [],
  bindings: [],
  deliveriesByConnection: {},
  deliveryErrorsByConnection: {},
  verificationOutcomes: {},
  health: null,
  loading: false,
  healthPending: false,
  savingId: null,
  pendingConnections: {},
  pendingDeliveries: {},
  error: null,
  statusMessage: null,
  clearError: () => undefined,
  load: async () => undefined,
  refreshHealth: async () => null,
  verifyConnection: async () => null,
  inspectDelivery: async () => null,
  retryDelivery: async () => null,
  cancelDelivery: async () => null,
  createConnection: async () => null,
  updateConnection: async () => null,
  deleteConnection: async () => undefined,
  createBinding: async () => null,
  updateBinding: async () => null,
  deleteBinding: async () => undefined,
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
    updateProject,
  } = state;

  const getBadge = (...prefixes: string[]) => getBadgeHelper(activeScope, projectSources, ...prefixes);
  const getFieldBadge = (path: string) => getFieldBadgeHelper(activeScope, projectSources, path);

  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [activeIntegrationDetail, setActiveIntegrationDetail] = useState<IntegrationId | null>(selectedIntegration);
  const isInitialMount = useRef(true);
  const chatProviders = { ...EMPTY_CHAT_PROVIDER_STATE, ...(state.chatProviders ?? {}) };
  const chatProviderDefinitionsLength = chatProviders.definitions.length;
  const chatProvidersLoading = chatProviders.loading;
  const loadChatProviderSettings = chatProviders.load;
  const projectOptions = (state.projects ?? (state.selectedProject ? [state.selectedProject] : []))
    .map((project) => ({ value: project.id, label: project.name || project.id }));
  const agentPresetOptions = [
    { value: "", label: "Built-in project manager" },
    ...(state.projectAgentPresetOptions ?? []).map((option) => ({ value: option.value, label: option.label })),
  ];
  const chatProviderCards = useMemo(() => buildChatProviderCatalogViewModel({
    definitions: chatProviders.definitions,
    connections: chatProviders.connections,
    bindings: chatProviders.bindings,
    deliveriesByConnection: chatProviders.deliveriesByConnection,
  }), [
    chatProviders.bindings,
    chatProviders.connections,
    chatProviders.definitions,
    chatProviders.deliveriesByConnection,
  ]);

  useEffect(() => {
    if (selectedIntegration && isChatProviderIntegrationId(selectedIntegration) && chatProviderDefinitionsLength === 0 && !chatProvidersLoading) {
      void loadChatProviderSettings();
    }
  }, [chatProviderDefinitionsLength, chatProvidersLoading, loadChatProviderSettings, selectedIntegration]);

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
    if (reducedMotion) {
      setActiveIntegrationDetail(enteringDetail ? selectedIntegration : null);
      if (enteringDetail) {
        gsap.set(listRef.current, { display: "none", position: "relative", top: "auto", left: "auto", x: "-100%", opacity: 0 });
        gsap.set(detailRef.current, { display: "block", position: "relative", top: "auto", left: "auto", x: "0%", opacity: 1 });
      } else {
        gsap.set(listRef.current, { display: "block", position: "relative", top: "auto", left: "auto", x: "0%", opacity: 1 });
        gsap.set(detailRef.current, { display: "none", position: "absolute", top: 0, left: 0, x: "100%", opacity: 0 });
      }
      gsap.set(containerRef.current, { height: "auto" });
      return;
    }

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
  }, [reducedMotion, selectedIntegration]);

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
      items: integrations.filter((integration) => isPublicProviderId(integration.id) && integration.id !== "jules"),
    },
    {
      id: "chat",
      label: "CHAT CONNECTORS",
      purpose: "Chat bridges, delivery health, and project/channel bindings",
      items: integrations
        .filter((integration) => isChatProviderIntegrationId(integration.id))
        .sort((left, right) => left.id === "discord" ? -1 : right.id === "discord" ? 1 : 0),
    },
    {
      id: "git",
      label: "GIT",
      purpose: "Source-control tokens, CI, PRs, and git identity",
      items: integrations.filter((integration) => integration.id === "github" || integration.id === "gitlab"),
    },
    {
      id: "storage",
      label: "STORAGE & MOUNTS",
      purpose: "Project-linked host storage mounted into Docker workspaces",
      items: integrations.filter((integration) => integration.id === "google-drive"),
    },
    {
      id: "pm",
      label: "PM",
      purpose: "Project management and issue tracker connections",
      items: integrations.filter((integration) => integration.id === "jira" || integration.id === "notion" || integration.id === "asana" || integration.id === "linear"),
    },
    {
      id: "canvas",
      label: "CANVAS",
      purpose: "Whiteboard, diagram, and design imports",
      items: integrations.filter((integration) => integration.id === "miro" || integration.id === "lucid" || integration.id === "figma" || integration.id === "mural"),
    },
  ].filter((group) => group.items.length > 0);

  const updateIntegrationProviders = (
    transform: (providers: SystemSettings["integrations"]["providers"]) => SystemSettings["integrations"]["providers"],
  ): void => {
    updateSystem((current) => {
      const nextProviders = transform({ ...current.integrations.providers });
      const nextSystem = {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };

      if (state.projectSettings) {
        updateProject((proj) => syncProjectSettingsToIntegrationCatalog(proj, nextProviders));
      }

      return nextSystem;
    });
  };

  const addProviderInstance = (providerId: PublicProviderId): void => {
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
        [providerConfigId]: sanitizeSystemProviderConfig({
          ...current.integrations.providers[providerConfigId],
          ...updates,
        }),
      };
      const nextSystem = {
        ...current,
        integrations: {
          ...current.integrations,
          providers: nextProviders,
        },
        defaults: syncProjectProvidersToIntegrationCatalog(current, nextProviders),
      };

      if (state.projectSettings) {
        updateProject((proj) => syncProjectSettingsToIntegrationCatalog(proj, nextProviders));
      }

      return nextSystem;
    });
  };

  const removeProviderInstance = (providerConfigId: ProviderConfigId): void => {
    updateIntegrationProviders((providers) => {
      const nextProviders = { ...providers };
      delete nextProviders[providerConfigId];
      return nextProviders;
    });
  };

  const addChatProviderConnection = async (definition: DashboardChatProviderSetupDefinition): Promise<void> => {
    const count = chatProviders.connections.filter((connection) => connection.providerKind === definition.kind).length + 1;
    await chatProviders.createConnection({
      providerKind: definition.kind,
      displayName: `${definition.label} Bridge ${count}`,
      bridgeMode: definition.defaultBridgeMode,
      status: "draft",
      enabled: false,
      setup: createDefaultSetupForBridge(definition, definition.defaultBridgeMode),
      secrets: {},
    });
  };

  const renderChatProviderConnectionEditor = (
    connection: DashboardChatProviderConnectionRecord,
    definition: DashboardChatProviderSetupDefinition,
  ) => {
    return (
      <ChatConnectorConnectionEditor
        key={connection.id}
        connection={connection}
        definition={definition}
        bindings={chatProviders.bindings.filter((binding) => binding.providerConnectionId === connection.id)}
        deliveries={chatProviders.deliveriesByConnection[connection.id] ?? []}
        deliveryError={chatProviders.deliveryErrorsByConnection[connection.id]}
        verificationOutcome={chatProviders.verificationOutcomes[connection.id]}
        projectOptions={projectOptions}
        agentPresetOptions={agentPresetOptions}
        pendingAction={chatProviders.pendingConnections[connection.id] ?? (chatProviders.savingId === `connection:${connection.id}` ? "save" : undefined)}
        pendingDeliveries={chatProviders.pendingDeliveries}
        onUpdate={chatProviders.updateConnection}
        onDelete={chatProviders.deleteConnection}
        onVerify={chatProviders.verifyConnection}
        onCreateBinding={chatProviders.createBinding}
        onUpdateBinding={chatProviders.updateBinding}
        onDeleteBinding={chatProviders.deleteBinding}
        onInspectDelivery={chatProviders.inspectDelivery}
        onRetryDelivery={chatProviders.retryDelivery}
        onCancelDelivery={chatProviders.cancelDelivery}
      />
    );
  };

  const renderChatProviderDetail = (providerKind: ChatProviderKind) => {
    const definition = chatProviders.definitions.find((entry) => entry.kind === providerKind);
    const providerCard = chatProviderCards.find((card) => card.providerKind === providerKind);
    const providerConnections = chatProviders.connections.filter((connection) => connection.providerKind === providerKind);
    const label = definition?.label ?? providerKind;
    return (
      <>
        <button className="mb-4 flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-white" onClick={() => setSelectedIntegration(null)}>
          <ArrowLeft className="h-4 w-4" />
          Back to Integrations
        </button>
        <SectionCard
          title={`${label} Connector`}
          watermark={providerKind === "microsoft-teams" ? "TMS" : providerKind.slice(0, 3).toUpperCase()}
          icon={<MessageCircle strokeWidth={2.4} />}
          actions={
            <>
              <IntegrationPill label={`${providerCard?.connectionCount ?? providerConnections.length} connections`} />
              <IntegrationPill label={`${providerCard?.failedOutboundCount ?? 0} failed outbound`} tone={(providerCard?.failedOutboundCount ?? 0) > 0 ? "muted" : "neutral"} />
              {chatProviders.health ? <IntegrationPill label={`${chatProviders.health.verifiedCount}/${chatProviders.health.configuredCount} verified`} tone={chatProviders.health.errorCount > 0 ? "muted" : "active"} /> : null}
              <CatalogActionButton label="Refresh" icon={RefreshCw} disabled={chatProviders.loading} onClick={() => void chatProviders.load()} />
              <CatalogActionButton label={chatProviders.healthPending ? "Checking health" : "Refresh health"} icon={Activity} disabled={chatProviders.healthPending} onClick={() => void chatProviders.refreshHealth()} />
              {definition ? <CatalogActionButton label="Add connection" icon={Plus} tone="primary" disabled={Boolean(chatProviders.savingId)} onClick={() => void addChatProviderConnection(definition)} /> : null}
            </>
          }
        >
          {chatProviders.loading ? (
            <NoticePanel tone="pending" title="Loading chat connectors">Loading connector setup definitions, connections, bindings, and delivery health.</NoticePanel>
          ) : null}
          <ActionFeedbackRegion status={chatProviders.error ? "error" : chatProviders.statusMessage ? "success" : "idle"} message={chatProviders.error ?? chatProviders.statusMessage} clearError={chatProviders.clearError} autoDismiss={false} />
          {definition ? (
            <NoticePanel title={`${definition.label} setup guidance`}>
              <ul className="list-disc space-y-1 pl-4">
                {getChatProviderSetupNotes(definition.kind).map((note) => <li key={note}>{note}</li>)}
              </ul>
              {(definition.limitations ?? []).length > 0 ? <><div className="mt-3 font-bold">Limitations</div><ul className="mt-1 list-disc space-y-1 pl-4">{(definition.limitations ?? []).map((limitation) => <li key={limitation}>{limitation}</li>)}</ul></> : null}
              {(definition.officialDocumentation ?? []).length > 0 ? <div className="mt-3 flex flex-wrap gap-3">{(definition.officialDocumentation ?? []).map((link) => <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="font-semibold underline decoration-current/30 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)]">{link.label}</a>)}</div> : null}
            </NoticePanel>
          ) : (
            <NoticePanel tone="warning" title="Setup definition unavailable">Refresh chat connector settings to load setup fields for this connector.</NoticePanel>
          )}
          {definition && providerConnections.length > 0 ? (
            <div className="space-y-5">
              {providerConnections.map((connection) => renderChatProviderConnectionEditor(connection, definition))}
            </div>
          ) : definition ? (
            <NoticePanel title="No connections yet">Add a connection to configure bridge setup fields, secrets, ingress, and channel bindings for {definition.label}.</NoticePanel>
          ) : null}
        </SectionCard>
      </>
    );
  };

  const renderJulesAutomationSettings = () => {
    const localGitMode = editableSettings.git.githubMode === "LOCAL";

    return (
      <SectionCard title="Jules Automation" watermark="JLS" icon={<Settings2 strokeWidth={2.4} />} badge={getBadge("automationInterventions", "ciIntelligence")}>
        <Row label="Auto-answer clarifications" description="Answer routine clarification requests automatically when the configured template is sufficient." badge={getFieldBadge("automationInterventions.autoAnswerClarification")}>
          <Toggle
            aria-label="Toggle setting"
            value={editableSettings.automationInterventions.autoAnswerClarification}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              automationInterventions: {
                ...current.automationInterventions,
                autoAnswerClarification: !current.automationInterventions.autoAnswerClarification,
              },
            }))}
          />
        </Row>
        {editableSettings.automationInterventions.autoAnswerClarification ? (
          <Row label="Clarification answer mode" description="Choose whether to use a static template or let a worker generate a contextual answer." badge={getFieldBadge("automationInterventions.autoAnswerClarificationMode")}>
            <PillChoiceGroup
              value={editableSettings.automationInterventions.autoAnswerClarificationMode}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  autoAnswerClarificationMode: value as ProjectSettings["automationInterventions"]["autoAnswerClarificationMode"],
                },
              }))}
              options={[
                { value: "TEMPLATE", label: "Template", hint: "Fast static reply." },
                { value: "WORKER", label: "Worker", hint: "Contextual provider-generated reply." },
              ]}
            />
          </Row>
        ) : null}
        {(!editableSettings.automationInterventions.autoAnswerClarification || editableSettings.automationInterventions.autoAnswerClarificationMode === "TEMPLATE") ? (
          <Row label="Clarification answer template" description="Template used when Jules asks for routine clarification and template mode is active." badge={getFieldBadge("automationInterventions.clarificationAnswerTemplate")}>
            <TextInput
              value={editableSettings.automationInterventions.clarificationAnswerTemplate}
              onChange={(value) => updateEditableSettings((current) => ({
                ...current,
                automationInterventions: {
                  ...current.automationInterventions,
                  clarificationAnswerTemplate: value,
                },
              }))}
              placeholder="Respond with the usual clarification template..."
            />
          </Row>
        ) : null}
        <Row label="Jules CI autofix" description={localGitMode ? "Allow Jules to attempt CI autofixes before escalating to a worker. (Disabled in Local mode)" : "Allow Jules to attempt CI autofixes before escalating to a worker."} badge={getFieldBadge("ciIntelligence.waitForJulesCiAutofix")}>
          <Toggle
            aria-label="Toggle setting"
            value={localGitMode ? false : editableSettings.ciIntelligence.waitForJulesCiAutofix}
            disabled={localGitMode}
            onChange={() => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                waitForJulesCiAutofix: !current.ciIntelligence.waitForJulesCiAutofix,
              },
            }))}
          />
        </Row>
        <Row label="Jules CI autofix max retries" description={localGitMode ? "Maximum Jules CI autofix attempts before guardrail escalation. (Disabled in Local mode)" : "Maximum Jules CI autofix attempts before guardrail escalation."} badge={getFieldBadge("ciIntelligence.julesCiAutofixMaxRetries")} last>
          <NumberInput
            value={editableSettings.ciIntelligence.julesCiAutofixMaxRetries}
            min={0}
            max={20}
            disabled={localGitMode}
            onChange={(value) => updateEditableSettings((current) => ({
              ...current,
              ciIntelligence: {
                ...current.ciIntelligence,
                julesCiAutofixMaxRetries: value,
              },
            }))}
          />
        </Row>
      </SectionCard>
    );
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

    if (isChatProviderIntegrationId(integrationId)) {
      return renderChatProviderDetail(integrationId);
    }

    if (integrationId === "google-drive") {
      const googleDrive = editableSettings.googleDrive;
      const hasLinkedDirectory = googleDrive.hostPath.trim().length > 0;
      return (
        <>
          {backButton}
          <SectionCard
            title="Google Drive Configuration"
            watermark="DRV"
            icon={<FolderOpen strokeWidth={2.4} />}
            badge={getBadge("googleDrive.enabled", "googleDrive.hostPath", "googleDrive.accessMode")}
            helpId="integrations"
          >
            <NoticePanel tone="neutral" title="Docker-only linked directory">
              Google Drive must already be linked and synced on this host. Code UX mounts the selected directory at the fixed <code>/mnt/code-ux/google-drive</code> container path for Docker runs only; no Google credentials are stored.
            </NoticePanel>
            <Row
              label="Enable Google Drive mount"
              description={hasLinkedDirectory
                ? "Make the linked directory available to Docker-backed provider workspaces."
                : "Choose a linked directory before this mount can become active."}
              badge={getFieldBadge("googleDrive.enabled")}
            >
              <Toggle
                aria-label="Enable Google Drive mount"
                value={googleDrive.enabled}
                onChange={() => updateEditableSettings((current) => ({
                  ...current,
                  googleDrive: {
                    ...current.googleDrive,
                    enabled: !current.googleDrive.enabled,
                  },
                }))}
              />
            </Row>
            <Row
              label="Linked Drive directory"
              description="Select the host directory maintained by Google Drive for desktop. The host path is used only to create the Docker mount."
              badge={getFieldBadge("googleDrive.hostPath")}
            >
              <LocalFilePickerField
                value={googleDrive.hostPath}
                onChange={(hostPath) => updateEditableSettings((current) => ({
                  ...current,
                  googleDrive: {
                    ...current.googleDrive,
                    hostPath,
                  },
                }))}
                label="Linked Drive directory"
                placeholder="Select a linked Google Drive directory"
                helperText={hasLinkedDirectory
                  ? "This host path stays inside the editable control and mounts at /mnt/code-ux/google-drive."
                  : "No directory linked. Browse or enter the local Google Drive directory to configure the mount."}
              />
            </Row>
            <Row
              label="Access mode"
              description="Read-only is the recommended default. Read-write lets containerized agents modify synced Drive files."
              badge={getFieldBadge("googleDrive.accessMode")}
              last
            >
              <SelectInput
                value={googleDrive.accessMode}
                onChange={(accessMode) => updateEditableSettings((current) => ({
                  ...current,
                  googleDrive: {
                    ...current.googleDrive,
                    accessMode: accessMode === "read-write" ? "read-write" : "read-only",
                  },
                }))}
                options={[
                  { value: "read-only", label: "Read-only (recommended)" },
                  { value: "read-write", label: "Read-write" },
                ]}
                aria-label="Google Drive access mode"
              />
            </Row>
          </SectionCard>
        </>
      );
    }

    if (integrationId === "github" || integrationId === "gitlab") {
      const isGitLab = integrationId === "gitlab";
      const hostLabel = isGitLab ? "GitLab" : "GitHub";
      const tokenKey = isGitLab ? "gitlabToken" : "githubToken";
      return (
        <>
          {backButton}
          <SectionCard title={`${hostLabel} Configuration`} watermark={isGitLab ? "GLB" : "GIT"} icon={<Settings2 strokeWidth={2.4} />}>
            <Row
              label={`${hostLabel} token`}
              description={activeScope === "system"
                ? `System token used for ${hostLabel} repository, ${isGitLab ? "merge request" : "pull request"}, and CI integration. Projects inherit this unless they override it.`
                : `Override the ${hostLabel} token for this scope. Leave blank to inherit the system token.`}
              badge={activeScope === "system" ? undefined : getFieldBadge(`git.${tokenKey}`)}
            >
              <SecretInput
                value={activeScope === "system"
                  ? (systemSettings.integrations[tokenKey] || "")
                  : (editableSettings.git[tokenKey] || "")}
                onChange={(value) => activeScope === "system"
                  ? updateSystem((current) => ({
                    ...current,
                    integrations: {
                      ...current.integrations,
                      [tokenKey]: value,
                    },
                  }))
                  : updateEditableSettings((current) => ({
                    ...current,
                    git: {
                      ...current.git,
                      [tokenKey]: value,
                    },
                  }))}
                mono
              />
            </Row>
            {isGitLab ? null : (
              <>
                <Row label="Mount GitHub auth" description="Copy the host `gh` credential directory into Docker for this scope." badge={getFieldBadge("cliWorkflow.containerMountGithubAuth")}>
                  <Toggle aria-label="Toggle setting"                     value={editableSettings.cliWorkflow.containerMountGithubAuth}
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
              <Toggle aria-label="Toggle setting"                 value={editableSettings.cliWorkflow.containerMountGitConfig}
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
      const jiraSettings = activeScope === "system"
        ? { ...DEFAULT_JIRA_SETTINGS, ...(systemSettings.integrations.jira || {}) }
        : { ...DEFAULT_JIRA_SETTINGS, ...(editableSettings.jira || {}) };
      const updateJira = (updates: Partial<SystemSettings["integrations"]["jira"]>): void => {
        if (activeScope === "system") {
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
          return;
        }
        updateEditableSettings((current) => ({
          ...current,
          jira: {
            ...(current.jira || DEFAULT_JIRA_SETTINGS),
            ...updates,
          },
        }));
      };

      return (
        <>
          {backButton}
          <SectionCard title="Jira Configuration" watermark="JRA" icon={<Settings2 strokeWidth={2.4} />}>
            {activeScope === "system" ? null : (
              <NoticePanel title="Project-scope Jira override">
                These fields override the system Jira connection for this scope. Cleared fields fall back to the system values.
              </NoticePanel>
            )}
            <Row label="Jira site URL" description="Base URL for Jira Cloud or Data Center, for example `https://company.atlassian.net`." badge={activeScope === "system" ? undefined : getFieldBadge("jira.host")}>
              <TextInput value={jiraSettings.host} onChange={(value) => updateJira({ host: value })} mono />
            </Row>
            <Row label="Account email" description="Email used with Jira Cloud API tokens. Leave empty for bearer-token Jira deployments." badge={activeScope === "system" ? undefined : getFieldBadge("jira.email")}>
              <TextInput value={jiraSettings.email} onChange={(value) => updateJira({ email: value })} mono />
            </Row>
            <Row label="API token" description="Jira API token used for issue search, issue context loading, and transitions." badge={activeScope === "system" ? undefined : getFieldBadge("jira.apiToken")}>
              <SecretInput value={jiraSettings.apiToken} onChange={(value) => updateJira({ apiToken: value })} mono />
            </Row>
            <Row label="Default project" description="Project key used to prefill the Jira import JQL." badge={activeScope === "system" ? undefined : getFieldBadge("jira.defaultProject")}>
              <TextInput value={jiraSettings.defaultProject} onChange={(value) => updateJira({ defaultProject: value.toUpperCase() })} mono />
            </Row>
            <Row label="Import transition" description="Transition name used when linked Jira issues are imported into a sprint. The default moves issues to In Work." badge={activeScope === "system" ? undefined : getFieldBadge("jira.importTransitionName")}>
              <TextInput value={jiraSettings.importTransitionName} onChange={(value) => updateJira({ importTransitionName: value })} />
            </Row>
            <Row label="Move Jira issues on import" description="Move linked Jira issues through the import transition as they are attached to a sprint." badge={activeScope === "system" ? undefined : getFieldBadge("jira.autoTransitionLinkedIssuesOnImport")}>
              <Toggle
                aria-label="Toggle setting"
                value={jiraSettings.autoTransitionLinkedIssuesOnImport}
                onChange={() => updateJira({ autoTransitionLinkedIssuesOnImport: !jiraSettings.autoTransitionLinkedIssuesOnImport })}
              />
            </Row>
            <Row label="Close transition" description="Transition name used when auto-closing linked Jira issues after sprint completion." badge={activeScope === "system" ? undefined : getFieldBadge("jira.closeTransitionName")}>
              <TextInput value={jiraSettings.closeTransitionName} onChange={(value) => updateJira({ closeTransitionName: value })} />
            </Row>
            <Row label="Auto-close Jira issues" description="Move linked Jira issues through the configured transition after the sprint completes." badge={activeScope === "system" ? undefined : getFieldBadge("jira.autoCloseLinkedIssues")} last>
              <Toggle aria-label="Toggle setting"                 value={jiraSettings.autoCloseLinkedIssues}
                onChange={() => updateJira({ autoCloseLinkedIssues: !jiraSettings.autoCloseLinkedIssues })}
              />
            </Row>
          </SectionCard>
        </>
      );
    }

    if (isImporterIntegrationId(integrationId)) {
      const definition = IMPORTER_DEFINITIONS[integrationId];
      const importerSettings = activeScope === "system"
        ? getImporterSettings(integrationId, systemSettings.integrations)
        : getImporterSettings(integrationId, editableSettings);
      const configured = isImporterConfigured(integrationId, importerSettings);
      const active = importerSettings.enabled && configured;
      const updateImporter = (updates: Partial<ImporterSettings>): void => {
        if (activeScope === "system") {
          updateSystem((current) => ({
            ...current,
            integrations: {
              ...current.integrations,
              [integrationId]: {
                ...getImporterSettings(integrationId, current.integrations),
                ...updates,
              },
            },
          }));
          return;
        }
        updateEditableSettings((current) => ({
          ...current,
          [integrationId]: {
            ...getImporterSettings(integrationId, current),
            ...updates,
          },
        }));
      };
      const fieldBadge = (field: keyof ImporterSettings) => activeScope === "system" ? undefined : getFieldBadge(`${integrationId}.${field}`);

      return (
        <>
          {backButton}
          <SectionCard
            title={`${definition.label} Configuration`}
            watermark={getImporterWatermark(integrationId)}
            icon={<Settings2 strokeWidth={2.4} />}
            helpId="importer-configuration"
            actions={
              <>
                {active ? <IntegrationPill label="Active" tone="active" /> : null}
                {configured ? <IntegrationPill label="Configured" /> : <IntegrationPill label="Not configured" tone="muted" />}
                <IntegrationPill label="Read-only import" />
              </>
            }
          >
            {activeScope === "system" ? (
              <NoticePanel title="System-owned importer credentials">
                Store shared read-only importer credentials here. Projects inherit these values unless they save an override.
              </NoticePanel>
            ) : (
              <NoticePanel title="Project-scope importer override">
                These fields override the system {definition.label} importer for this project. Cleared fields fall back after reset.
              </NoticePanel>
            )}
            <NoticePanel title="Read-only importer support">
              Code UX uses these settings to find and attach external context to sprints. It does not write back to this provider.
            </NoticePanel>
            <Row label={`Enable ${definition.label}`} description="Allow this importer to appear in sprint import flows once required fields are configured." badge={fieldBadge("enabled")}>
              <Toggle
                aria-label={`Enable ${definition.label} importer`}
                value={importerSettings.enabled}
                onChange={() => updateImporter({ enabled: !importerSettings.enabled })}
              />
            </Row>
            <Row label="API token" description={`Token used for read-only ${definition.label} API requests.`} badge={fieldBadge("apiToken")}>
              <SecretInput
                value={importerSettings.apiToken}
                onChange={(value) => updateImporter({ apiToken: value })}
                aria-label={`${definition.label} API token`}
                mono
              />
            </Row>
            <Row label="API secret" description="Optional secondary secret for deployments that require one." badge={fieldBadge("apiSecret")}>
              <SecretInput
                value={importerSettings.apiSecret}
                onChange={(value) => updateImporter({ apiSecret: value })}
                aria-label={`${definition.label} API secret`}
                mono
              />
            </Row>
            <Row label="Base URL" description="Optional custom API base URL for enterprise or regional deployments." badge={fieldBadge("baseUrl")}>
              <TextInput
                value={importerSettings.baseUrl}
                onChange={(value) => updateImporter({ baseUrl: value })}
                placeholder="https://api.example.com"
                mono
              />
            </Row>
            {definition.fields.map((field) => (
              <Row key={field.key} label={field.label} description={field.description} badge={fieldBadge(field.key)}>
                {field.secret ? (
                  <SecretInput
                    value={importerSettings[field.key]}
                    onChange={(value) => updateImporter({ [field.key]: value })}
                    placeholder={field.placeholder}
                    aria-label={`${definition.label} ${field.label}`}
                    mono
                  />
                ) : (
                  <TextInput
                    value={importerSettings[field.key]}
                    onChange={(value) => updateImporter({ [field.key]: value })}
                    placeholder={field.placeholder}
                    aria-label={`${definition.label} ${field.label}`}
                    mono
                  />
                )}
              </Row>
            ))}
            <Row label="Search limit" description="Maximum matching external items shown in import search." badge={fieldBadge("defaultSearchLimit")} last>
              <NumberInput
                value={importerSettings.defaultSearchLimit}
                min={1}
                max={250}
                onChange={(value) => updateImporter({ defaultSearchLimit: value })}
                aria-label={`${definition.label} search limit`}
              />
            </Row>
          </SectionCard>
        </>
      );
    }

    if (!isPublicProviderId(integrationId)) {
      return null;
    }

    const providerId = integrationId;
    const providerEntries = sortProviderConfigEntries(getSystemProvidersByType(systemSettings, providerId));

    if (activeScope !== "system") {
      return (
        <>
          {backButton}
          {providerId === "jules" ? renderJulesAutomationSettings() : null}
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
        {providerId === "jules" ? renderJulesAutomationSettings() : null}
        <SectionCard title={`${getProviderTypeLabel(providerId)} Credentials`} watermark={getProviderWatermark(providerId)} icon={<Key strokeWidth={2.4} />}>
          {isDeprecatedProvider(providerId) ? (
            <NoticePanel title="Deprecated provider">
              {providerLifecycle[providerId].message} Existing and new instances remain usable during the migration period.
            </NoticePanel>
          ) : null}
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
                  providerConfigId={providerConfigId}
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
      {state.selectedProject?.id ? <AutomationCredentialManager projectId={state.selectedProject.id} /> : null}
      <SectionCard
        title="Integrations"
        watermark="INT"
        badge={getBadge("integrations", "cliWorkflow")}
        icon={<Plug strokeWidth={2.4} />}
        drilldown={false}
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
                  if (isChatProviderIntegrationId(integration.id)) {
                    const providerKind = integration.id;
                    const providerCard = chatProviderCards.find((card) => card.providerKind === providerKind);
                    return (
                      <ChatConnectorCatalogCard key={integration.id} providerKind={providerKind} label={integration.label} description={integration.description} viewModel={providerCard} prominent={providerKind === "discord"} onManage={() => setSelectedIntegration(integration.id)} />
                    );
                  }

                  if (integration.id === "github" || integration.id === "gitlab" || integration.id === "jira") {
                    const isGitLab = integration.id === "gitlab";
                    const isJira = integration.id === "jira";
                    const effectiveJira = activeScope === "system"
                      ? systemSettings.integrations.jira
                      : editableSettings.jira;
                    const jiraConfigured = Boolean(effectiveJira?.host?.trim() && effectiveJira?.apiToken?.trim());
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

                  if (isImporterIntegrationId(integration.id)) {
                    const definition = IMPORTER_DEFINITIONS[integration.id];
                    const importerSettings = activeScope === "system"
                      ? getImporterSettings(integration.id, systemSettings.integrations)
                      : getImporterSettings(integration.id, editableSettings);
                    const configured = isImporterConfigured(integration.id, importerSettings);
                    const active = importerSettings.enabled && configured;
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
                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border text-[11px] font-black uppercase tracking-[0.12em] ${definition.accentClassName}`} aria-hidden title={definition.label}>
                              {definition.mark}
                            </span>
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
                              <IntegrationPill label="Read-only import" />
                              <IntegrationPill label={configured ? "Configured" : "Not configured"} tone={configured ? "neutral" : "muted"} />
                            </div>
                            <CatalogActionButton label="Manage" icon={Settings2} onClick={() => setSelectedIntegration(integration.id)} />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (integration.id === "google-drive") {
                    const googleDrive = editableSettings.googleDrive;
                    const configured = googleDrive.hostPath.trim().length > 0;
                    const active = googleDrive.enabled && configured;
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
                            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border ${active ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:border-signal-400/20 dark:bg-signal-400/[0.12] dark:text-signal-200" : "border-black/[0.06] bg-black/[0.035] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500"}`} aria-hidden title="Google Drive">
                              <FolderOpen className="h-5 w-5" />
                            </span>
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
                              <IntegrationPill label="Docker mount" />
                              <IntegrationPill label={configured ? "Configured" : "Not configured"} tone={configured ? "neutral" : "muted"} />
                            </div>
                            <CatalogActionButton label="Manage" icon={Settings2} onClick={() => setSelectedIntegration(integration.id)} />
                          </div>
                        </div>
                      </div>
                    );
                  }

                  if (!isPublicProviderId(integration.id)) {
                    return null;
                  }

                  const providerId = integration.id;
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
