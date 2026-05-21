import type {
  DashboardSettings,
  InvocationRoutingId,
  ProviderConfigId,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  Subtask,
} from "../contracts/app-types.js";
import { AI_MODEL_CATALOG, DEFAULT_INVOCATION_ROUTING } from "../repositories/settings-defaults.js";

interface RoutingDecisionContext {
  strategy: ProviderStrategy;
  manualProvider: ProviderConfigId | null;
  providers: Record<ProviderConfigId, ProviderSettings>;
  enabledProviders: ProviderConfigId[];
}

export interface ResolvedProviderRoute extends RoutingDecisionContext {
  invocation: InvocationRoutingId;
  provider: ProviderId;
  providerConfigId: ProviderConfigId;
}

export interface ResolveProviderForInvocationInput {
  invocation: InvocationRoutingId;
  task: Subtask;
  providerPool?: ProviderId[];
}

export interface ProviderRoutingStrategy {
  choose(context: RoutingDecisionContext, task: Subtask): ProviderConfigId;
}

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const resolveWeightedSeed = (task: Subtask): string => {
  const prompt = typeof task.prompt === "string" ? task.prompt : "";
  return `${task.id}:${prompt}`;
};

const routeInheritsGlobalStrategy = (
  settings: DashboardSettings,
  invocation: InvocationRoutingId,
): boolean => {
  const route = settings.aiProvider.invocationRouting?.[invocation] || DEFAULT_INVOCATION_ROUTING[invocation];
  const defaults = DEFAULT_INVOCATION_ROUTING[invocation];

  return route.profile === "GLOBAL"
    && route.strategy === defaults.strategy
    && route.provider === defaults.provider
    && route.allowedProviders.length === 0
    && Object.keys(route.providers).length === 0;
};

const resolveInvocationStrategy = (
  settings: DashboardSettings,
  invocation: InvocationRoutingId,
): ProviderStrategy => {
  const route = settings.aiProvider.invocationRouting?.[invocation] || DEFAULT_INVOCATION_ROUTING[invocation];

  if (routeInheritsGlobalStrategy(settings, invocation)) {
    return settings.aiProvider.strategy;
  }

  return route.strategy;
};

const inferProviderTypeFromConfigId = (providerConfigId: ProviderConfigId): ProviderId | null => {
  if (providerConfigId === "jules" || providerConfigId.startsWith("jules-")) {
    return "jules";
  }
  if (providerConfigId === "gemini" || providerConfigId.startsWith("gemini-")) {
    return "gemini";
  }
  if (providerConfigId === "codex" || providerConfigId.startsWith("codex-")) {
    return "codex";
  }
  if (providerConfigId === "claude-code" || providerConfigId.startsWith("claude-code-") || providerConfigId.startsWith("claude-")) {
    return "claude-code";
  }
  if (providerConfigId === "qwen-code" || providerConfigId.startsWith("qwen-code-") || providerConfigId.startsWith("qwen-")) {
    return "qwen-code";
  }
  if (providerConfigId === "opencode" || providerConfigId.startsWith("opencode-")) {
    return "opencode";
  }
  return null;
};

const getProviderType = (
  providers: Record<ProviderConfigId, ProviderSettings>,
  providerConfigId: ProviderConfigId | null | undefined,
): ProviderId | null => (
  providerConfigId
    ? (providers[providerConfigId]?.provider || inferProviderTypeFromConfigId(providerConfigId))
    : null
);

const chooseWeightedConfig = (
  providers: Record<ProviderConfigId, ProviderSettings>,
  enabledProviderIds: ProviderConfigId[],
  task: Subtask,
): ProviderConfigId => {
  const weighted = enabledProviderIds.map((providerConfigId) => ({
    providerConfigId,
    weight: Math.max(0, providers[providerConfigId]?.weight || 0),
  }));
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight <= 0) {
    return enabledProviderIds[0]!;
  }

  let cursor = hashString(resolveWeightedSeed(task)) % totalWeight;
  for (const entry of weighted) {
    cursor -= entry.weight;
    if (cursor < 0) {
      return entry.providerConfigId;
    }
  }
  return weighted[weighted.length - 1]!.providerConfigId;
};

const getEmergencyFallbackProvider = (
  context: RoutingDecisionContext,
): ProviderConfigId => (
  context.enabledProviders.find((providerConfigId) => getProviderType(context.providers, providerConfigId) === "jules")
  || Object.keys(context.providers).find((providerConfigId) => getProviderType(context.providers, providerConfigId) === "jules")
  || context.manualProvider
  || context.enabledProviders[0]
  || Object.keys(context.providers)[0]
  || "jules"
);

export const resolveWorkerModelForProvider = (
  provider: Exclude<ProviderId, "jules">,
  workerModel: string | null | undefined,
  fallbackModel: string,
): string => {
  const normalizedModel = typeof workerModel === "string" ? workerModel.trim() : "";
  if (!normalizedModel || normalizedModel === "default") {
    return fallbackModel;
  }

  const catalog = AI_MODEL_CATALOG[provider] || [];
  return catalog.includes(normalizedModel) ? normalizedModel : fallbackModel;
};

const buildRouteProviders = (
  settings: DashboardSettings,
  invocation: InvocationRoutingId,
): { manualProvider: ProviderConfigId | null; providers: Record<ProviderConfigId, ProviderSettings> } => {
  const route = settings.aiProvider.invocationRouting?.[invocation] || DEFAULT_INVOCATION_ROUTING[invocation];
  const providers: Record<ProviderConfigId, ProviderSettings> = Object.fromEntries(
    Object.entries(settings.aiProvider.providers).map(([providerConfigId, provider]) => [
      providerConfigId,
      {
        ...provider,
        provider: provider.provider || inferProviderTypeFromConfigId(providerConfigId) || "jules",
      },
    ]),
  );

  const inheritedManualProvider = route.profile === "WORKER"
    ? settings.workers.virtualWorkerProvider
    : settings.aiProvider.provider;
  const manualProvider = route.provider ?? inheritedManualProvider;

  if (route.profile === "WORKER" && inheritedManualProvider && providers[inheritedManualProvider]) {
    const workerProviderType = providers[inheritedManualProvider].provider;
    providers[inheritedManualProvider] = {
      ...providers[inheritedManualProvider],
      enabled: true,
      model: workerProviderType === "jules"
        ? providers[inheritedManualProvider].model
        : resolveWorkerModelForProvider(
          workerProviderType,
          settings.workers.model,
          providers[inheritedManualProvider].model,
        ),
    };
  }

  for (const [providerConfigId, overrides] of Object.entries(route.providers)) {
    if (!providers[providerConfigId]) {
      continue;
    }
    providers[providerConfigId] = {
      ...providers[providerConfigId],
      ...(typeof overrides.enabled === "boolean" ? { enabled: overrides.enabled } : {}),
      ...(typeof overrides.model === "string" ? { model: overrides.model } : {}),
      ...(typeof overrides.weight === "number" ? { weight: overrides.weight } : {}),
      ...(typeof overrides.thinkingMode === "string" ? { thinkingMode: overrides.thinkingMode } : {}),
    };
  }

  if (route.provider && providers[route.provider] && route.providers[route.provider]?.enabled !== false) {
    providers[route.provider] = {
      ...providers[route.provider],
      enabled: true,
    };
  }

  return { manualProvider, providers };
};

const getEnabledProviders = (
  settings: DashboardSettings,
  input: ResolveProviderForInvocationInput,
  providers: Record<ProviderConfigId, ProviderSettings>,
): ProviderConfigId[] => {
  const route = settings.aiProvider.invocationRouting?.[input.invocation] || DEFAULT_INVOCATION_ROUTING[input.invocation];
  const allowedProviders = route.allowedProviders.length > 0
    ? new Set(route.allowedProviders)
    : null;
  const providerPool = input.providerPool ? new Set(input.providerPool) : null;

  return Object.entries(providers)
    .filter(([providerConfigId, provider]) => {
      if (!provider.enabled) {
        return false;
      }
      if (settings.git.githubMode === "LOCAL" && provider.provider === "jules") {
        return false;
      }
      if (allowedProviders && !allowedProviders.has(providerConfigId) && route.provider !== providerConfigId) {
        return false;
      }
      if (providerPool && !providerPool.has(provider.provider)) {
        return false;
      }
      return true;
    })
    .map(([providerConfigId]) => providerConfigId);
};

export class ManualRoutingStrategy implements ProviderRoutingStrategy {
  choose(context: RoutingDecisionContext, _task: Subtask): ProviderConfigId {
    if (context.enabledProviders.length === 0) {
      return getEmergencyFallbackProvider(context);
    }
    return context.manualProvider && context.enabledProviders.includes(context.manualProvider)
      ? context.manualProvider
      : context.enabledProviders[0]!;
  }
}

export class WeightedRoutingStrategy implements ProviderRoutingStrategy {
  choose(context: RoutingDecisionContext, task: Subtask): ProviderConfigId {
    if (context.enabledProviders.length === 0) {
      return getEmergencyFallbackProvider(context);
    }
    return chooseWeightedConfig(context.providers, context.enabledProviders, task);
  }
}

export class OrchestratedRoutingStrategy implements ProviderRoutingStrategy {
  private readonly weightedFallback = new WeightedRoutingStrategy();

  choose(context: RoutingDecisionContext, task: Subtask): ProviderConfigId {
    if (context.enabledProviders.length === 0) {
      return getEmergencyFallbackProvider(context);
    }

    const promptText = typeof task.prompt === "string" ? task.prompt : "";
    const prompt = promptText.toLowerCase();
    const dependencyCount = Array.isArray(task.depends_on) ? task.depends_on.length : 0;
    const complexKeyword = /(refactor|architecture|migration|orchestrator|integration|performance|atomic|multi-step)/i.test(prompt);
    const longPrompt = promptText.length > 800;
    const simplePrompt = promptText.length < 260;

    const chooseByType = (providerId: ProviderId): ProviderConfigId | null => {
      const matchingProviders = context.enabledProviders.filter((providerConfigId) => getProviderType(context.providers, providerConfigId) === providerId);
      if (matchingProviders.length === 0) {
        return null;
      }
      return chooseWeightedConfig(context.providers, matchingProviders, task);
    };

    if (complexKeyword || longPrompt || dependencyCount > 1) {
      return chooseByType("claude-code")
        || chooseByType("codex")
        || chooseByType("jules")
        || this.weightedFallback.choose(context, task);
    }

    if (simplePrompt && dependencyCount === 0) {
      return chooseByType("gemini")
        || chooseByType("jules")
        || this.weightedFallback.choose(context, task);
    }

    return chooseByType("jules") || this.weightedFallback.choose(context, task);
  }
}

const resolveStrategy = (strategy: ProviderStrategy): ProviderRoutingStrategy => {
  switch (strategy) {
    case "MANUAL":
      return new ManualRoutingStrategy();
    case "WEIGHTED":
      return new WeightedRoutingStrategy();
    case "ORCHESTRATOR":
    default:
      return new OrchestratedRoutingStrategy();
  }
};

export const resolveProviderForInvocation = (
  settings: DashboardSettings,
  input: ResolveProviderForInvocationInput,
): ResolvedProviderRoute => {
  const route = settings.aiProvider.invocationRouting?.[input.invocation] || DEFAULT_INVOCATION_ROUTING[input.invocation];
  const strategy = resolveInvocationStrategy(settings, input.invocation);
  const base = buildRouteProviders(settings, input.invocation);
  const manualProvider = base.manualProvider;
  const enabledProviders = getEnabledProviders(settings, input, base.providers);
  const context: RoutingDecisionContext = {
    strategy,
    manualProvider,
    providers: base.providers,
    enabledProviders,
  };

  const providerConfigId = resolveStrategy(strategy).choose(context, input.task);
  const provider = getProviderType(base.providers, providerConfigId) || "jules";

  return {
    invocation: input.invocation,
    provider,
    providerConfigId,
    ...context,
  };
};

export const chooseProviderForTask = (settings: DashboardSettings, task: Subtask): ProviderId => {
  return resolveProviderForInvocation(settings, {
    invocation: "task_coding",
    task,
  }).provider;
};
