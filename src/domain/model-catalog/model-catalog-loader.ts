import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import type { TokenPricing } from "../../contracts/app-types.js";
import type { ModelCatalogEntry, ModelCatalogProviderSummary, ModelCatalogRaw, ModelCatalogRawCost } from "./model-catalog-types.js";

function resolveCatalogCandidates(): string[] {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return [
    path.join(process.cwd(), "assets", "models-dev", "catalog.json"),
    path.resolve(moduleDir, "../../../assets/models-dev/catalog.json"),
    path.resolve(moduleDir, "../../../../assets/models-dev/catalog.json"),
  ];
}

function toTokenPricing(cost: ModelCatalogRawCost | undefined): TokenPricing | undefined {
  if (!cost || (cost.input === undefined && cost.output === undefined && cost.cache_read === undefined)) {
    return undefined;
  }
  return {
    inputTokens: cost.input ?? 0,
    outputTokens: cost.output ?? 0,
    cachedInputTokens: cost.cache_read ?? 0,
  };
}

function flattenCatalog(raw: ModelCatalogRaw): ModelCatalogEntry[] {
  const entries: ModelCatalogEntry[] = [];
  for (const provider of Object.values(raw)) {
    if (!provider?.id || !provider.models) {
      continue;
    }
    for (const model of Object.values(provider.models)) {
      if (!model?.id) {
        continue;
      }
      entries.push({
        id: `${provider.id}/${model.id}`,
        providerId: provider.id,
        providerName: provider.name || provider.id,
        modelId: model.id,
        modelName: model.name || model.id,
        cost: toTokenPricing(model.cost),
        contextLimit: model.limit?.context,
        outputLimit: model.limit?.output,
        reasoning: Boolean(model.reasoning),
        toolCall: Boolean(model.tool_call),
        openWeights: Boolean(model.open_weights),
        knowledge: model.knowledge,
        releaseDate: model.release_date,
      });
    }
  }
  return entries;
}

function summarizeProviders(raw: ModelCatalogRaw): ModelCatalogProviderSummary[] {
  return Object.values(raw)
    .filter((provider): provider is NonNullable<typeof provider> => Boolean(provider?.id))
    .map((provider) => ({
      id: provider.id,
      name: provider.name || provider.id,
      apiBaseUrl: provider.api,
    }));
}

interface LoadedCatalog {
  entries: ModelCatalogEntry[];
  byId: Map<string, ModelCatalogEntry>;
  providers: ModelCatalogProviderSummary[];
  providersById: Map<string, ModelCatalogProviderSummary>;
}

let cached: LoadedCatalog | null = null;

function loadCatalog(): LoadedCatalog {
  if (cached) {
    return cached;
  }

  let raw: ModelCatalogRaw = {};
  for (const candidate of resolveCatalogCandidates()) {
    try {
      raw = JSON.parse(fs.readFileSync(candidate, "utf8"));
      break;
    } catch {
      continue;
    }
  }

  const entries = flattenCatalog(raw);
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const providers = summarizeProviders(raw);
  const providersById = new Map(providers.map((provider) => [provider.id, provider] as const));
  cached = { entries, byId, providers, providersById };
  return cached;
}

export function getModelCatalog(): ModelCatalogEntry[] {
  return loadCatalog().entries;
}

export function getModelCatalogEntry(canonicalId: string): ModelCatalogEntry | undefined {
  return loadCatalog().byId.get(canonicalId);
}

export function getModelCatalogProviders(): ModelCatalogProviderSummary[] {
  return loadCatalog().providers;
}

export function getModelCatalogProvider(providerId: string): ModelCatalogProviderSummary | undefined {
  return loadCatalog().providersById.get(providerId);
}

/** Test-only hook to force a reload on the next call. */
export function resetModelCatalogCache(): void {
  cached = null;
}
