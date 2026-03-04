import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";

const PROVIDER_ORDER: ProviderId[] = ["jules", "gemini", "codex", "claude-code"];

export interface ProviderRoutingStrategy {
  choose(settings: DashboardSettings, task: Subtask, enabledProviders: ProviderId[]): ProviderId;
}

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const getEnabledProviders = (settings: DashboardSettings): ProviderId[] => {
  return PROVIDER_ORDER.filter((provider) => settings.aiProvider.providers[provider]?.enabled);
};

export class ManualRoutingStrategy implements ProviderRoutingStrategy {
  choose(settings: DashboardSettings, _task: Subtask, enabledProviders: ProviderId[]): ProviderId {
    if (enabledProviders.length === 0) return "jules";
    return enabledProviders.includes(settings.aiProvider.provider)
      ? settings.aiProvider.provider
      : enabledProviders[0];
  }
}

export class WeightedRoutingStrategy implements ProviderRoutingStrategy {
  choose(settings: DashboardSettings, task: Subtask, enabledProviders: ProviderId[]): ProviderId {
    if (enabledProviders.length === 0) return "jules";
    
    const seed = task.prompt;
    const weighted = enabledProviders.map((provider) => ({
      provider,
      weight: Math.max(0, settings.aiProvider.providers[provider].weight),
    }));
    const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    if (totalWeight <= 0) return enabledProviders[0];

    let cursor = hashString(seed) % totalWeight;
    for (const entry of weighted) {
      cursor -= entry.weight;
      if (cursor < 0) {
        return entry.provider;
      }
    }
    return weighted[weighted.length - 1].provider;
  }
}

export class OrchestratedRoutingStrategy implements ProviderRoutingStrategy {
  private weightedFallback = new WeightedRoutingStrategy();

  choose(settings: DashboardSettings, task: Subtask, enabledProviders: ProviderId[]): ProviderId {
    if (enabledProviders.length === 0) return "jules";

    const prompt = task.prompt.toLowerCase();
    const dependencyCount = task.depends_on.length;
    const complexKeyword = /(refactor|architecture|migration|orchestrator|integration|performance|atomic|multi-step)/i.test(prompt);
    const longPrompt = task.prompt.length > 800;
    const simplePrompt = task.prompt.length < 260;

    if ((complexKeyword || longPrompt || dependencyCount > 1) && enabledProviders.includes("claude-code")) {
      return "claude-code";
    }
    if ((complexKeyword || longPrompt || dependencyCount > 1) && enabledProviders.includes("codex")) {
      return "codex";
    }
    if (simplePrompt && dependencyCount === 0 && enabledProviders.includes("gemini")) {
      return "gemini";
    }
    if (enabledProviders.includes("jules")) {
      return "jules";
    }

    // Fallback to weighted if no orchestration rule matches but we have enabled providers
    const legacySeed = `${task.id}:${task.title}:${task.prompt}`;
    return this.weightedFallback.choose(settings, { ...task, prompt: legacySeed } as any, enabledProviders);
  }
}

export const chooseProviderForTask = (settings: DashboardSettings, task: Subtask): ProviderId => {
  const enabledProviders = getEnabledProviders(settings);
  if (enabledProviders.length === 0) {
    return "jules";
  }

  let strategy: ProviderRoutingStrategy;

  switch (settings.aiProvider.strategy) {
    case "MANUAL":
      strategy = new ManualRoutingStrategy();
      break;
    case "WEIGHTED":
      {
        strategy = new WeightedRoutingStrategy();
        // Ensure we use the correct seed format for WEIGHTED strategy
        const weightedTask = { ...task, prompt: `${task.id}:${task.prompt}` };
        return strategy.choose(settings, weightedTask as any, enabledProviders);
      }
    case "ORCHESTRATOR":
      strategy = new OrchestratedRoutingStrategy();
      break;
    default:
      strategy = new OrchestratedRoutingStrategy();
      break;
  }

  return strategy.choose(settings, task, enabledProviders);
};
