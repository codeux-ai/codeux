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
  agentProvider?: ProviderConfigId | null;
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
  agentProvider?: {
    providerConfigId?: ProviderConfigId | null;
    model?: string | null;
  } | null;
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

const resolveInvocationStrategy = (
  settings: DashboardSettings,
  invocation: InvocationRoutingId,
): ProviderStrategy => {
  const route = settings.aiProvider.invocationRouting?.[invocation] || DEFAULT_INVOCATION_ROUTING[invocation];
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
  if (providerConfigId === "antigravity" || providerConfigId.startsWith("antigravity-")) {
    return "antigravity";
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
  agentProvider?: ResolveProviderForInvocationInput["agentProvider"],
): { manualProvider: ProviderConfigId | null; agentProviderConfigId: ProviderConfigId | null; providers: Record<ProviderConfigId, ProviderSettings> } => {
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

  const agentProviderConfigId = route.strategy === "AGENT"
    ? agentProvider?.providerConfigId?.trim() || null
    : null;
  const agentModel = route.strategy === "AGENT"
    ? agentProvider?.model?.trim() || null
    : null;

  if (agentProviderConfigId && providers[agentProviderConfigId] && route.providers[agentProviderConfigId]?.enabled !== false) {
    providers[agentProviderConfigId] = {
      ...providers[agentProviderConfigId],
      enabled: true,
      ...(agentModel && agentModel !== "default" ? { model: agentModel } : {}),
    };
  }

  return { manualProvider, agentProviderConfigId, providers };
};

const getEnabledProviders = (
  settings: DashboardSettings,
  input: ResolveProviderForInvocationInput,
  providers: Record<ProviderConfigId, ProviderSettings>,
): ProviderConfigId[] => {
  const route = settings.aiProvider.invocationRouting?.[input.invocation] || DEFAULT_INVOCATION_ROUTING[input.invocation];
  // The allowed-provider pool only constrains WEIGHTED/AGENT selection. Under MANUAL
  // the route uses its primary (manual) provider, so the weighted pool must be
  // ignored — otherwise a manual provider left out of the pool gets filtered away
  // and routing silently falls back to the first enabled provider. The Models UI
  // mirrors this by locking the pool ("Locked to primary") when strategy is MANUAL.
  const allowedProviders = route.strategy !== "MANUAL" && route.allowedProviders.length > 0
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

export class AgentRoutingStrategy implements ProviderRoutingStrategy {
  private readonly manualFallback = new ManualRoutingStrategy();

  choose(context: RoutingDecisionContext, task: Subtask): ProviderConfigId {
    if (context.enabledProviders.length === 0) {
      return getEmergencyFallbackProvider(context);
    }

    if (context.agentProvider && context.enabledProviders.includes(context.agentProvider)) {
      return context.agentProvider;
    }

    return this.manualFallback.choose(context, task);
  }
}

const resolveStrategy = (strategy: ProviderStrategy): ProviderRoutingStrategy => {
  switch (strategy) {
    case "MANUAL":
      return new ManualRoutingStrategy();
    case "WEIGHTED":
      return new WeightedRoutingStrategy();
    case "AGENT":
    default:
      return new AgentRoutingStrategy();
  }
};

export const resolveProviderForInvocation = (
  settings: DashboardSettings,
  input: ResolveProviderForInvocationInput,
): ResolvedProviderRoute => {
  const route = settings.aiProvider.invocationRouting?.[input.invocation] || DEFAULT_INVOCATION_ROUTING[input.invocation];
  const strategy = resolveInvocationStrategy(settings, input.invocation);
  const base = buildRouteProviders(settings, input.invocation, input.agentProvider);
  const manualProvider = base.manualProvider;
  const enabledProviders = getEnabledProviders(settings, input, base.providers);
  const context: RoutingDecisionContext = {
    strategy,
    manualProvider,
    agentProvider: base.agentProviderConfigId,
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
