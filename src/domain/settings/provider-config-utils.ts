import type {
  ExternalSettingsHints,
  InvocationProviderOverrideSettings,
  ProviderConfigId,
  ProviderId,
  ProviderSettings,
  ThinkingMode,
  VirtualWorkerProvider,
} from "../../contracts/app-types.js";
import type {
  ProjectProviderSettings,
  SystemIntegrationSettings,
  SystemProviderCredentialSettings,
} from "../../contracts/settings-scope-types.js";
import {
  DEFAULT_PROVIDER_AUTH_PATHS,
  DEFAULT_PROVIDER_CONFIG_FILE_PATHS,
  DEFAULT_PROVIDER_CONFIG_IDS,
  DEFAULT_PROVIDER_CONFIG_NAMES,
  DEFAULT_PROVIDER_SETTINGS,
  PROVIDER_IDS,
  isProviderThinkingModeSupported,
  normalizeProviderThinkingMode,
  VIRTUAL_WORKER_PROVIDERS,
} from "../../repositories/settings-defaults.js";

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

export const getHintApiKeyForProvider = (
  providerId: ProviderId,
  externalHints?: ExternalSettingsHints,
): string => {
  if (providerId === "jules") {
    return externalHints?.resolved.julesApiKey || "";
  }
  if (providerId === "gemini") {
    return externalHints?.resolved.geminiApiKey || "";
  }
  if (providerId === "codex") {
    return externalHints?.resolved.codexApiKey || "";
  }
  if (providerId === "claude-code") {
    return externalHints?.resolved.claudeCodeApiKey || "";
  }
  if (providerId === "qwen-code") {
    return externalHints?.resolved.qwenCodeApiKey || "";
  }
  if (providerId === "antigravity") {
    return externalHints?.resolved.antigravityApiKey || "";
  }
  if (providerId === "mockup-cli") {
    return "";
  }
  return externalHints?.resolved.openCodeApiKey || "";
};

export const buildDefaultIntegrationProviders = (
  externalHints?: ExternalSettingsHints,
): Record<ProviderConfigId, SystemProviderCredentialSettings> => ({
  [DEFAULT_PROVIDER_CONFIG_IDS.jules]: {
    provider: "jules",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.jules,
    apiKey: getHintApiKeyForProvider("jules", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.jules,
    providerConfigMode: "none",
    providerConfigPath: "",
    authType: "apiKey",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS.gemini]: {
    provider: "gemini",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.gemini,
    apiKey: getHintApiKeyForProvider("gemini", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.gemini,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.gemini,
    authType: "apiKey",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS.codex]: {
    provider: "codex",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.codex,
    apiKey: getHintApiKeyForProvider("codex", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.codex,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.codex,
    authType: "apiKey",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS["claude-code"]]: {
    provider: "claude-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["claude-code"],
    apiKey: getHintApiKeyForProvider("claude-code", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["claude-code"],
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS["claude-code"],
    authType: "apiKey",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS["qwen-code"]]: {
    provider: "qwen-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["qwen-code"],
    apiKey: getHintApiKeyForProvider("qwen-code", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["qwen-code"],
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS["qwen-code"],
    authType: "apiKey",
    qwenAuthMode: "LOCAL_AUTH",
    qwenRegion: "international",
    qwenBaseUrl: "http://127.0.0.1:11434/v1",
    qwenEnvKey: "OLLAMA_API_KEY",
    qwenModelId: "glm-4.7-flash",
    qwenProtocol: "openai",
    qwenAdditionalModelProviders: [],
  },
  [DEFAULT_PROVIDER_CONFIG_IDS.opencode]: {
    provider: "opencode",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.opencode,
    apiKey: getHintApiKeyForProvider("opencode", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.opencode,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.opencode,
    authType: "apiKey",
    openCodeAuthMode: "LOCAL_AUTH",
    openCodeProviderId: "ollama",
    openCodeModelId: "glm-4.7-flash",
    openCodeBaseUrl: "http://127.0.0.1:11434/v1",
    openCodeEnvKey: "OLLAMA_API_KEY",
    openCodePackage: "@ai-sdk/openai-compatible",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS.antigravity]: {
    provider: "antigravity",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.antigravity,
    apiKey: getHintApiKeyForProvider("antigravity", externalHints),
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.antigravity,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.antigravity,
    authType: "apiKey",
  },
  [DEFAULT_PROVIDER_CONFIG_IDS["mockup-cli"]]: {
    provider: "mockup-cli",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["mockup-cli"],
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["mockup-cli"],
    providerConfigMode: "none",
    providerConfigPath: "",
    authType: "apiKey",
  },
});

const normalizeProviderId = (value: unknown): ProviderId | null => (
  typeof value === "string" && PROVIDER_IDS.includes(value as ProviderId)
    ? value as ProviderId
    : null
);

const inferProviderIdFromConfigId = (providerConfigId: string): ProviderId | null => (
  PROVIDER_IDS.find((providerId) => providerConfigId === providerId || providerConfigId.startsWith(`${providerId}-`)) || null
);

const normalizeProviderName = (providerId: ProviderId, value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return DEFAULT_PROVIDER_CONFIG_NAMES[providerId];
};

const normalizeProviderAuthPath = (providerId: ProviderId, value: unknown): string => {
  if (providerId === "jules") {
    return "";
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return DEFAULT_PROVIDER_AUTH_PATHS[providerId];
};

const supportsProviderConfigFile = (providerId: ProviderId): boolean => (
  providerId !== "jules" && providerId !== "mockup-cli"
);

const normalizeProviderConfig = (
  providerId: ProviderId,
  modeValue: unknown,
  pathValue: unknown,
): Pick<SystemProviderCredentialSettings, "providerConfigMode" | "providerConfigPath"> => {
  if (!supportsProviderConfigFile(providerId)) {
    return { providerConfigMode: "none", providerConfigPath: "" };
  }

  const standardPath = DEFAULT_PROVIDER_CONFIG_FILE_PATHS[providerId];
  const requestedMode = modeValue === "none" || modeValue === "copyHost" || modeValue === "file"
    ? modeValue
    : "copyHost";

  if (requestedMode === "none") {
    return { providerConfigMode: "none", providerConfigPath: "" };
  }

  if (requestedMode === "file") {
    const customPath = typeof pathValue === "string" ? pathValue.trim() : "";
    if (customPath) {
      return { providerConfigMode: "file", providerConfigPath: customPath };
    }
    return { providerConfigMode: "copyHost", providerConfigPath: standardPath };
  }

  return { providerConfigMode: "copyHost", providerConfigPath: standardPath };
};

const normalizeQwenAuthMode = (value: unknown): SystemProviderCredentialSettings["qwenAuthMode"] => (
  value === "ALIBABA_CODING_PLAN" || value === "MODEL_PROVIDER" || value === "LOCAL_AUTH"
    ? value
    : "LOCAL_AUTH"
);

const normalizeQwenRegion = (value: unknown): SystemProviderCredentialSettings["qwenRegion"] => (
  value === "china" || value === "international" ? value : "international"
);

const normalizeQwenProtocol = (value: unknown): NonNullable<SystemProviderCredentialSettings["qwenProtocol"]> => (
  value === "anthropic" || value === "gemini" || value === "openai" ? value : "openai"
);

const normalizeOpenCodeAuthMode = (value: unknown): NonNullable<SystemProviderCredentialSettings["openCodeAuthMode"]> => (
  value === "ENV_KEY" || value === "CUSTOM_PROVIDER" || value === "LOCAL_AUTH" ? value : "LOCAL_AUTH"
);

const normalizeNonEmptyString = (value: unknown, fallback: string): string => (
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
);

export const normalizeSystemIntegrationProviders = (
  integrationsInput: unknown,
  externalHints?: ExternalSettingsHints,
): Record<ProviderConfigId, SystemProviderCredentialSettings> => {
  const defaults = buildDefaultIntegrationProviders(externalHints);
  const input = isRecord(integrationsInput) ? integrationsInput : {};
  const hasModernProviders = isRecord(input.providers);
  const result: Record<ProviderConfigId, SystemProviderCredentialSettings> = {};

  if (!hasModernProviders) {
    Object.assign(result, defaults);
  }

  const providersInput = isRecord(input.providers) ? input.providers : {};
  for (const [providerConfigId, rawValue] of Object.entries(providersInput)) {
    if (!isRecord(rawValue)) {
      continue;
    }
    const providerId = normalizeProviderId(rawValue.provider) || inferProviderIdFromConfigId(providerConfigId);
    if (!providerId) {
      continue;
    }

    const rawAuthType = rawValue.authType;
    let authType: "apiKey" | "localAuth" | "dashboardAuth" = "apiKey";
    if (rawAuthType === "apiKey" || rawAuthType === "localAuth" || rawAuthType === "dashboardAuth") {
      authType = rawAuthType;
    } else if (rawValue.mountAuth === true) {
      const pathStr = String(rawValue.authPath || "");
      if (pathStr.includes(".code-ux") && pathStr.includes("credentials")) {
        authType = "dashboardAuth";
      } else {
        authType = "localAuth";
      }
    }

    const usesApiKeyAuth = authType === "apiKey";

    result[providerConfigId] = {
      provider: providerId,
      name: normalizeProviderName(providerId, rawValue.name),
      apiKey: usesApiKeyAuth && typeof rawValue.apiKey === "string" ? rawValue.apiKey : "",
      mountAuth: providerId === "jules"
        ? false
        // Dashboard login exists solely to mount the credentials it saves under
        // ~/.code-ux/credentials, so it must always enable the mount. Honoring a
        // stale/seeded mountAuth=false here (primaries seed false) would leave the
        // instance unmounted at runtime AND ineligible for routing, which is why
        // dashboard login appeared to work for added instances but not primaries.
        : authType === "dashboardAuth"
          ? true
          : (typeof rawValue.mountAuth === "boolean" ? rawValue.mountAuth : (authType === "apiKey" ? false : true)),
      authPath: authType === "dashboardAuth"
        ? `~/.code-ux/credentials/${providerConfigId}`
        : normalizeProviderAuthPath(providerId, rawValue.authPath),
      ...normalizeProviderConfig(providerId, rawValue.providerConfigMode, rawValue.providerConfigPath),
      authType,
      ...(typeof rawValue.lastLoginAt === "number" ? { lastLoginAt: rawValue.lastLoginAt } : {}),
      ...(usesApiKeyAuth && typeof rawValue.customBaseUrl === "string" && rawValue.customBaseUrl.trim().length > 0
        ? { customBaseUrl: rawValue.customBaseUrl.trim() }
        : {}),
      ...(usesApiKeyAuth && typeof rawValue.customModel === "string" && rawValue.customModel.trim().length > 0
        ? { customModel: rawValue.customModel.trim() }
        : {}),
      ...(usesApiKeyAuth && typeof rawValue.customProviderId === "string" && rawValue.customProviderId.trim().length > 0
        ? { customProviderId: rawValue.customProviderId.trim() }
        : {}),
      ...(providerId === "qwen-code" ? {
        qwenAuthMode: usesApiKeyAuth ? normalizeQwenAuthMode(rawValue.qwenAuthMode) : "LOCAL_AUTH",
        qwenRegion: normalizeQwenRegion(rawValue.qwenRegion),
        qwenBaseUrl: typeof rawValue.qwenBaseUrl === "string" && rawValue.qwenBaseUrl.trim().length > 0
          ? rawValue.qwenBaseUrl.trim()
          : "http://127.0.0.1:11434/v1",
        qwenEnvKey: typeof rawValue.qwenEnvKey === "string" && rawValue.qwenEnvKey.trim().length > 0
          ? rawValue.qwenEnvKey.trim()
          : "OLLAMA_API_KEY",
        qwenModelId: normalizeNonEmptyString(rawValue.qwenModelId, "glm-4.7-flash"),
        qwenProtocol: normalizeQwenProtocol(rawValue.qwenProtocol),
        ...(typeof rawValue.qwenApiProviderId === "string" && rawValue.qwenApiProviderId.trim().length > 0
          ? { qwenApiProviderId: rawValue.qwenApiProviderId.trim() }
          : {}),
        qwenAdditionalModelProviders: Array.isArray(rawValue.qwenAdditionalModelProviders)
          ? rawValue.qwenAdditionalModelProviders
            .filter(isRecord)
            .map((entry) => ({
              id: typeof entry.id === "string" ? entry.id.trim() : "",
              name: typeof entry.name === "string" ? entry.name.trim() : "",
              authType: normalizeQwenProtocol(entry.authType),
              envKey: typeof entry.envKey === "string" ? entry.envKey.trim() : "",
              apiKey: typeof entry.apiKey === "string" ? entry.apiKey : "",
              baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl.trim() : "",
              description: typeof entry.description === "string" ? entry.description.trim() : undefined,
            }))
            .filter((entry) => entry.id && entry.envKey)
          : [],
      } : {}),
      ...(providerId === "opencode" ? {
        openCodeAuthMode: usesApiKeyAuth ? normalizeOpenCodeAuthMode(rawValue.openCodeAuthMode) : "LOCAL_AUTH",
        openCodeProviderId: normalizeNonEmptyString(rawValue.openCodeProviderId, "ollama"),
        openCodeModelId: normalizeNonEmptyString(rawValue.openCodeModelId, "glm-4.7-flash"),
        openCodeBaseUrl: normalizeNonEmptyString(rawValue.openCodeBaseUrl, "http://127.0.0.1:11434/v1"),
        openCodeEnvKey: normalizeNonEmptyString(rawValue.openCodeEnvKey, "OLLAMA_API_KEY"),
        openCodePackage: normalizeNonEmptyString(rawValue.openCodePackage, "@ai-sdk/openai-compatible"),
      } : {}),
    };
  }

  const legacyEntries: Array<[ProviderId, unknown]> = [
    ["jules", input.julesApiKey],
    ["gemini", input.geminiApiKey],
    ["codex", input.codexApiKey],
    ["claude-code", input.claudeCodeApiKey],
    ["qwen-code", input.qwenCodeApiKey],
    ["opencode", input.openCodeApiKey],
    ["antigravity", input.antigravityApiKey],
  ];

  for (const [providerId, legacyApiKey] of legacyEntries) {
    if (typeof legacyApiKey !== "string") {
      continue;
    }
    const defaultId = DEFAULT_PROVIDER_CONFIG_IDS[providerId];
    if (hasModernProviders && !result[defaultId]) {
      continue;
    }
    result[defaultId] = {
      ...result[defaultId],
      provider: providerId,
      name: result[defaultId]?.name || DEFAULT_PROVIDER_CONFIG_NAMES[providerId],
      apiKey: legacyApiKey,
      mountAuth: result[defaultId]?.mountAuth ?? false,
      authPath: result[defaultId]?.authPath || DEFAULT_PROVIDER_AUTH_PATHS[providerId],
      providerConfigMode: result[defaultId]?.providerConfigMode || (supportsProviderConfigFile(providerId) ? "copyHost" : "none"),
      providerConfigPath: result[defaultId]?.providerConfigPath || DEFAULT_PROVIDER_CONFIG_FILE_PATHS[providerId],
      authType: result[defaultId]?.authType || (result[defaultId]?.mountAuth ? "localAuth" : "apiKey"),
    };
  }

  return result;
};

const normalizeWeight = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.round(value));
};

const normalizeThinkingMode = (providerId: ProviderId, value: unknown, fallback: ThinkingMode): ThinkingMode => (
  normalizeProviderThinkingMode(providerId, value, fallback)
);

const normalizeMaxConcurrentTasks = (value: unknown, fallback: number): number => (
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback
);

const normalizeProviderAuthType = (value: unknown): SystemProviderCredentialSettings["authType"] => (
  value === "apiKey" || value === "localAuth" || value === "dashboardAuth" ? value : undefined
);

const collectProjectProviderIntegrations = (
  providersInput: Record<string, unknown>,
  integrationProviders: Record<ProviderConfigId, SystemProviderCredentialSettings>,
): Record<ProviderConfigId, SystemProviderCredentialSettings> => {
  const result: Record<ProviderConfigId, SystemProviderCredentialSettings> = { ...integrationProviders };
  const defaultIntegrations = buildDefaultIntegrationProviders();

  for (const [providerConfigId, rawValue] of Object.entries(providersInput)) {
    if (result[providerConfigId] || !isRecord(rawValue)) {
      continue;
    }

    const providerId = normalizeProviderId(rawValue.provider) || inferProviderIdFromConfigId(providerConfigId);
    if (!providerId) {
      continue;
    }

    const defaultIntegration = defaultIntegrations[DEFAULT_PROVIDER_CONFIG_IDS[providerId]];
    const requestedAuthType = normalizeProviderAuthType(rawValue.authType);
    const authType = requestedAuthType || defaultIntegration.authType || "apiKey";
    const normalizedProviderConfig = normalizeProviderConfig(
      providerId,
      rawValue.providerConfigMode ?? defaultIntegration.providerConfigMode,
      rawValue.providerConfigPath ?? defaultIntegration.providerConfigPath,
    );

    result[providerConfigId] = {
      ...defaultIntegration,
      provider: providerId,
      name: normalizeProviderName(providerId, rawValue.name ?? defaultIntegration.name),
      apiKey: authType === "apiKey" && typeof rawValue.apiKey === "string"
        ? rawValue.apiKey
        : defaultIntegration.apiKey,
      mountAuth: providerId === "jules"
        ? false
        : authType === "dashboardAuth"
          ? true
          : (typeof rawValue.mountAuth === "boolean" ? rawValue.mountAuth : defaultIntegration.mountAuth),
      authPath: authType === "dashboardAuth"
        ? `~/.code-ux/credentials/${providerConfigId}`
        : normalizeProviderAuthPath(providerId, rawValue.authPath ?? defaultIntegration.authPath),
      ...normalizedProviderConfig,
      authType,
    };
  }

  return result;
};

export const buildProjectProviderSettings = (
  providersInput: unknown,
  integrationProviders: Record<ProviderConfigId, SystemProviderCredentialSettings>,
): Record<ProviderConfigId, ProjectProviderSettings> => {
  const result: Record<ProviderConfigId, ProjectProviderSettings> = {};
  const input = isRecord(providersInput) ? providersInput : {};
  const availableIntegrations = collectProjectProviderIntegrations(input, integrationProviders);

  for (const [providerConfigId, integration] of Object.entries(availableIntegrations)) {
    const directSource = isRecord(input[providerConfigId]) ? input[providerConfigId] : {};
    const defaults = DEFAULT_PROVIDER_SETTINGS[integration.provider];
    result[providerConfigId] = {
      provider: integration.provider,
      name: typeof directSource.name === "string" && directSource.name.trim().length > 0
        ? directSource.name.trim()
        : integration.name,
      enabled: typeof directSource.enabled === "boolean" ? directSource.enabled : defaults.enabled,
      model: typeof directSource.model === "string" && directSource.model.trim().length > 0
        ? directSource.model.trim()
        : defaults.model,
      weight: normalizeWeight(directSource.weight, defaults.weight),
      thinkingMode: normalizeThinkingMode(integration.provider, directSource.thinkingMode, defaults.thinkingMode),
      maxConcurrentTasks: normalizeMaxConcurrentTasks(directSource.maxConcurrentTasks, defaults.maxConcurrentTasks),
    };
  }

  return result;
};

export const buildDashboardProviderSettings = (
  projectProviders: Record<ProviderConfigId, ProjectProviderSettings>,
  integrationProviders: Record<ProviderConfigId, SystemProviderCredentialSettings>,
): Record<ProviderConfigId, ProviderSettings> => (
  Object.fromEntries(
    Object.entries(projectProviders).map(([providerConfigId, projectProvider]) => {
      const providerId = projectProvider.provider || inferProviderIdFromConfigId(providerConfigId) || "jules";
      const defaults = DEFAULT_PROVIDER_SETTINGS[providerId];
      return [
        providerConfigId,
        {
          provider: providerId,
          name: projectProvider.name || DEFAULT_PROVIDER_CONFIG_NAMES[providerId],
          enabled: typeof projectProvider.enabled === "boolean" ? projectProvider.enabled : defaults.enabled,
          model: typeof projectProvider.model === "string" && projectProvider.model.trim().length > 0
            ? projectProvider.model
            : defaults.model,
          weight: normalizeWeight(projectProvider.weight, defaults.weight),
          thinkingMode: normalizeThinkingMode(providerId, projectProvider.thinkingMode, defaults.thinkingMode),
          maxConcurrentTasks: normalizeMaxConcurrentTasks(projectProvider.maxConcurrentTasks, defaults.maxConcurrentTasks),
          apiKey: integrationProviders[providerConfigId]?.apiKey || "",
          mountAuth: integrationProviders[providerConfigId]?.mountAuth
            || false,
          authPath: integrationProviders[providerConfigId]?.authPath
            || DEFAULT_PROVIDER_AUTH_PATHS[providerId],
          providerConfigMode: integrationProviders[providerConfigId]?.providerConfigMode
            || (supportsProviderConfigFile(providerId) ? "copyHost" : "none"),
          providerConfigPath: integrationProviders[providerConfigId]?.providerConfigPath
            || DEFAULT_PROVIDER_CONFIG_FILE_PATHS[providerId],
          ...(integrationProviders[providerConfigId]?.customBaseUrl
            ? { customBaseUrl: integrationProviders[providerConfigId].customBaseUrl }
            : {}),
          ...(integrationProviders[providerConfigId]?.customModel
            ? { customModel: integrationProviders[providerConfigId].customModel }
            : {}),
          ...(providerId === "qwen-code" ? {
            qwenAuthMode: integrationProviders[providerConfigId]?.qwenAuthMode,
            qwenRegion: integrationProviders[providerConfigId]?.qwenRegion,
            qwenBaseUrl: integrationProviders[providerConfigId]?.qwenBaseUrl,
            qwenEnvKey: integrationProviders[providerConfigId]?.qwenEnvKey,
            qwenModelId: integrationProviders[providerConfigId]?.qwenModelId,
            qwenProtocol: integrationProviders[providerConfigId]?.qwenProtocol,
            qwenAdditionalModelProviders: integrationProviders[providerConfigId]?.qwenAdditionalModelProviders,
          } : {}),
          ...(providerId === "opencode" ? {
            openCodeAuthMode: integrationProviders[providerConfigId]?.openCodeAuthMode,
            openCodeProviderId: integrationProviders[providerConfigId]?.openCodeProviderId,
            openCodeModelId: integrationProviders[providerConfigId]?.openCodeModelId,
            openCodeBaseUrl: integrationProviders[providerConfigId]?.openCodeBaseUrl,
            openCodeEnvKey: integrationProviders[providerConfigId]?.openCodeEnvKey,
            openCodePackage: integrationProviders[providerConfigId]?.openCodePackage,
          } : {}),
        },
      ];
    }),
  )
);

export const resolveProviderConfigId = (
  candidate: unknown,
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
  fallbackProviderId?: ProviderId | null,
): ProviderConfigId | null => {
  if (typeof candidate === "string" && candidate in providers) {
    return candidate;
  }

  if (fallbackProviderId) {
    return Object.entries(providers).find(([, provider]) => provider.provider === fallbackProviderId)?.[0] || null;
  }

  return null;
};

export const resolveAllowedProviderConfigIds = (
  candidates: unknown,
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
): ProviderConfigId[] => {
  if (!Array.isArray(candidates)) {
    return [];
  }

  const resolved = candidates
    .map((candidate) => resolveProviderConfigId(candidate, providers))
    .filter((providerConfigId): providerConfigId is ProviderConfigId => typeof providerConfigId === "string");

  return [...new Set(resolved)];
};

export const resolveInvocationProviderOverrides = (
  input: unknown,
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
): Record<ProviderConfigId, InvocationProviderOverrideSettings> => {
  if (!isRecord(input)) {
    return {};
  }

  const result: Record<ProviderConfigId, InvocationProviderOverrideSettings> = {};
  for (const [candidateKey, rawValue] of Object.entries(input)) {
    if (!isRecord(rawValue)) {
      continue;
    }
    const providerConfigId = resolveProviderConfigId(candidateKey, providers);
    if (!providerConfigId) {
      continue;
    }

    const override: InvocationProviderOverrideSettings = {};
    if (typeof rawValue.enabled === "boolean") {
      override.enabled = rawValue.enabled;
    }
    if (typeof rawValue.model === "string" && rawValue.model.trim().length > 0) {
      override.model = rawValue.model.trim();
    }
    if (typeof rawValue.weight === "number" && Number.isFinite(rawValue.weight)) {
      override.weight = Math.max(0, Math.round(rawValue.weight));
    }
    if (typeof rawValue.thinkingMode === "string" && isProviderThinkingModeSupported(providers[providerConfigId].provider, rawValue.thinkingMode)) {
      override.thinkingMode = normalizeProviderThinkingMode(providers[providerConfigId].provider, rawValue.thinkingMode);
    }

    if (Object.keys(override).length > 0) {
      result[providerConfigId] = override;
    }
  }

  return result;
};

export const getProviderConfigIdsByType = (
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
  providerId: ProviderId,
): ProviderConfigId[] => (
  Object.entries(providers)
    .filter(([, provider]) => provider.provider === providerId)
    .map(([providerConfigId]) => providerConfigId)
);

export const getFirstProviderConfigIdByType = (
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
  providerId: ProviderId,
): ProviderConfigId | null => getProviderConfigIdsByType(providers, providerId)[0] || null;

export const getFirstVirtualWorkerProviderConfigId = (
  providers: Record<ProviderConfigId, { provider: ProviderId }>,
): ProviderConfigId | null => (
  Object.entries(providers).find(([, provider]) => VIRTUAL_WORKER_PROVIDERS.includes(provider.provider as VirtualWorkerProvider))?.[0] || null
);
