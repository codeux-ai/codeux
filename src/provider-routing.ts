import type { DashboardSettings, ProviderId, Subtask } from "./types.js";

const PROVIDER_ORDER: ProviderId[] = ["jules", "gemini", "codex", "claude-code"];

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

const pickWeightedProvider = (settings: DashboardSettings, seed: string, enabledProviders: ProviderId[]): ProviderId => {
  if (enabledProviders.length === 0) return "jules";
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
};

const chooseOrchestratedProvider = (settings: DashboardSettings, task: Subtask, enabledProviders: ProviderId[]): ProviderId => {
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
  return pickWeightedProvider(settings, `${task.id}:${task.title}:${task.prompt}`, enabledProviders);
};

export const chooseProviderForTask = (settings: DashboardSettings, task: Subtask): ProviderId => {
  const enabledProviders = getEnabledProviders(settings);
  if (enabledProviders.length === 0) {
    return "jules";
  }

  if (settings.aiProvider.strategy === "MANUAL") {
    return enabledProviders.includes(settings.aiProvider.provider)
      ? settings.aiProvider.provider
      : enabledProviders[0];
  }

  if (settings.aiProvider.strategy === "WEIGHTED") {
    return pickWeightedProvider(settings, `${task.id}:${task.prompt}`, enabledProviders);
  }

  return chooseOrchestratedProvider(settings, task, enabledProviders);
};
