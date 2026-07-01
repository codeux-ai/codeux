import type { TokenPricing } from "../../contracts/app-types.js";

/** Raw shapes as served by https://models.dev/api.json (subset we actually use). */
export interface ModelCatalogRawCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface ModelCatalogRawLimit {
  context?: number;
  output?: number;
}

export interface ModelCatalogRawModel {
  id: string;
  name?: string;
  family?: string;
  cost?: ModelCatalogRawCost;
  limit?: ModelCatalogRawLimit;
  reasoning?: boolean;
  tool_call?: boolean;
  open_weights?: boolean;
  knowledge?: string;
  release_date?: string;
}

export interface ModelCatalogRawProvider {
  id: string;
  name?: string;
  env?: string[];
  npm?: string;
  doc?: string;
  /** Base API endpoint, when the provider doesn't use its SDK's hardcoded default. */
  api?: string;
  models?: Record<string, ModelCatalogRawModel>;
}

export type ModelCatalogRaw = Record<string, ModelCatalogRawProvider>;

/** Flattened, app-facing view of a single model entry. */
export interface ModelCatalogEntry {
  /** Canonical id, "<modelsDevProviderId>/<modelId>", e.g. "anthropic/claude-sonnet-4-5". */
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  /** USD per 1M tokens, already in TokenPricing's units. Undefined fields mean "not published". */
  cost: TokenPricing | undefined;
  contextLimit: number | undefined;
  outputLimit: number | undefined;
  reasoning: boolean;
  toolCall: boolean;
  openWeights: boolean;
  knowledge: string | undefined;
  releaseDate: string | undefined;
}

/** Provider-level summary used to drive the "API provider" picker and its base-URL autofill. */
export interface ModelCatalogProviderSummary {
  id: string;
  name: string;
  /** Known base API endpoint, if models.dev publishes one (many first-party providers rely on their SDK's built-in default and have none). */
  apiBaseUrl: string | undefined;
}
