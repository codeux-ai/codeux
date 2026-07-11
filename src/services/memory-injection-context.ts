import type { AgentMemoryConfig } from "../contracts/agent-preset-types.js";
import type { MemoryRecord, MemorySearchResult, MemoryScope } from "../contracts/memory-types.js";
import { estimateTokens } from "./embedding-vector-utils.js";
import type { MemoryService } from "./memory-service.js";

const DEFAULT_TOKEN_BUDGET = 1_600;
const DEFAULT_MAX_PER_TIER = 8;
const RECENT_CANDIDATE_LIMIT = 100;

export interface MemoryInjectionContextOptions {
  projectId: string;
  agentPresetId: string;
  sprintId?: string | null;
  query: string;
  config?: AgentMemoryConfig;
  tokenBudget?: number;
}

export interface MemoryInjectionContextResult {
  markdown?: string;
  selectedShortTerm: number;
  selectedLongTerm: number;
  estimatedTokens: number;
  semanticSearchUsed: boolean;
}

interface RankedMemory {
  memory: MemoryRecord;
  score: number;
}

const queryTerms = (value: string): Set<string> => new Set(
  value.toLowerCase().match(/[a-z0-9_./-]{3,}/g) ?? [],
);

const memoryFingerprint = (memory: MemoryRecord): string => memory.content
  .toLowerCase()
  .replace(/\s+/g, " ")
  .trim();

const passesConfig = (memory: MemoryRecord, config?: AgentMemoryConfig): boolean => {
  if (!config) return true;
  if (config.categories.length > 0 && !config.categories.includes(memory.category)) return false;
  const threshold = config.minStrengthPerCategory[memory.category] ?? config.minStrength;
  return memory.strength >= threshold;
};

const rankMemories = (
  records: MemoryRecord[],
  semanticResults: MemorySearchResult[],
  query: string,
): RankedMemory[] => {
  const semanticScores = new Map(semanticResults.map((result) => [result.memory.id, result.similarity]));
  const terms = queryTerms(query);
  const now = Date.now();
  const seen = new Set<string>();

  return records
    .map((memory) => {
      const fingerprint = memoryFingerprint(memory);
      if (!fingerprint || seen.has(fingerprint)) return null;
      seen.add(fingerprint);
      const contentTerms = queryTerms(`${memory.category} ${memory.content}`);
      const overlap = terms.size === 0
        ? 0
        : [...terms].filter((term) => contentTerms.has(term)).length / terms.size;
      const ageDays = Math.max(0, (now - Date.parse(memory.updatedAt)) / 86_400_000);
      const recency = 1 / (1 + ageDays / 30);
      const semantic = semanticScores.get(memory.id) ?? 0;
      return {
        memory,
        score: semantic * 0.55 + overlap * 0.2 + memory.strength * 0.2 + recency * 0.05,
      };
    })
    .filter((entry): entry is RankedMemory => entry !== null)
    .sort((a, b) => b.score - a.score || b.memory.updatedAt.localeCompare(a.memory.updatedAt) || a.memory.id.localeCompare(b.memory.id));
};

const formatTier = (
  heading: string,
  ranked: RankedMemory[],
  maximum: number,
  tokenBudget: number,
): { lines: string[]; count: number; tokens: number } => {
  if (ranked.length === 0 || maximum <= 0 || tokenBudget <= 0) {
    return { lines: [], count: 0, tokens: 0 };
  }
  const lines = [heading];
  let tokens = estimateTokens(heading);
  let count = 0;
  for (const { memory } of ranked) {
    if (count >= maximum) break;
    const prefix = `- [${memory.category}] `;
    const remaining = tokenBudget - tokens - estimateTokens(prefix);
    if (remaining < 12) break;
    const maxCharacters = Math.max(48, remaining * 4);
    const content = memory.content.length <= maxCharacters
      ? memory.content
      : `${memory.content.slice(0, Math.max(0, maxCharacters - 1)).trimEnd()}…`;
    const line = `${prefix}${content}`;
    const lineTokens = estimateTokens(line);
    if (tokens + lineTokens > tokenBudget) break;
    lines.push(line);
    tokens += lineTokens;
    count++;
  }
  return count > 0 ? { lines, count, tokens } : { lines: [], count: 0, tokens: 0 };
};

const dedupeRankedTiers = (
  longTerm: RankedMemory[],
  shortTerm: RankedMemory[],
): { longTerm: RankedMemory[]; shortTerm: RankedMemory[] } => {
  const winnerByFingerprint = new Map<string, { tier: "long" | "short"; entry: RankedMemory }>();
  for (const [tier, entries] of [["long", longTerm], ["short", shortTerm]] as const) {
    for (const entry of entries) {
      const fingerprint = memoryFingerprint(entry.memory);
      const current = winnerByFingerprint.get(fingerprint);
      if (!current || entry.score > current.entry.score) {
        winnerByFingerprint.set(fingerprint, { tier, entry });
      }
    }
  }
  return {
    longTerm: longTerm.filter((entry) => winnerByFingerprint.get(memoryFingerprint(entry.memory))?.entry === entry),
    shortTerm: shortTerm.filter((entry) => winnerByFingerprint.get(memoryFingerprint(entry.memory))?.entry === entry),
  };
};

export async function buildRelevantMemoryInjectionContext(
  memoryService: Pick<MemoryService, "listBySprintAndAgent" | "listLongTermByAgent" | "search">,
  options: MemoryInjectionContextOptions,
): Promise<MemoryInjectionContextResult> {
  const fetchShort = options.config?.tier !== "long_term" && Boolean(options.sprintId);
  const fetchLong = options.config?.tier !== "short_term";
  const shortTerm = fetchShort
    ? memoryService.listBySprintAndAgent(options.projectId, options.sprintId!, options.agentPresetId, RECENT_CANDIDATE_LIMIT)
      .filter((memory) => passesConfig(memory, options.config))
    : [];
  const longTerm = fetchLong
    ? memoryService.listLongTermByAgent(options.projectId, options.agentPresetId, RECENT_CANDIDATE_LIMIT)
      .filter((memory) => passesConfig(memory, options.config))
    : [];

  let shortSemantic: MemorySearchResult[] = [];
  let longSemantic: MemorySearchResult[] = [];
  if (options.query.trim()) {
    const searchTier = async (scope: MemoryScope, sprintId?: string): Promise<MemorySearchResult[]> => {
      try {
        return await memoryService.search({
          projectId: options.projectId,
          query: options.query,
          scope,
          sprintId,
          agentPresetId: options.agentPresetId,
          limit: 40,
          minSimilarity: 0.15,
        });
      } catch {
        return [];
      }
    };
    [shortSemantic, longSemantic] = await Promise.all([
      fetchShort ? searchTier("sprint", options.sprintId ?? undefined) : Promise.resolve([]),
      fetchLong ? searchTier("project") : Promise.resolve([]),
    ]);
  }

  const budget = Math.max(256, options.tokenBudget ?? DEFAULT_TOKEN_BUDGET);
  const headingTokens = estimateTokens("## RELEVANT MEMORY CONTEXT");
  const contentBudget = Math.max(0, budget - headingTokens);
  const longBudget = Math.floor(contentBudget * 0.6);
  const shortBudget = contentBudget - longBudget;
  const maxShort = options.config?.maxShortTerm && options.config.maxShortTerm > 0
    ? options.config.maxShortTerm
    : DEFAULT_MAX_PER_TIER;
  const maxLong = options.config?.maxLongTerm && options.config.maxLongTerm > 0
    ? options.config.maxLongTerm
    : DEFAULT_MAX_PER_TIER;

  const ranked = dedupeRankedTiers(
    rankMemories(longTerm, longSemantic, options.query),
    rankMemories(shortTerm, shortSemantic, options.query),
  );
  const longSection = formatTier(
    "### Long-Term Knowledge",
    ranked.longTerm,
    maxLong,
    longBudget,
  );
  const shortSection = formatTier(
    "### Recent Sprint Learnings",
    ranked.shortTerm,
    maxShort,
    shortBudget,
  );
  const sections = [longSection, shortSection].filter((section) => section.count > 0);
  if (sections.length === 0) {
    return {
      selectedShortTerm: 0,
      selectedLongTerm: 0,
      estimatedTokens: 0,
      semanticSearchUsed: shortSemantic.length > 0 || longSemantic.length > 0,
    };
  }

  const markdown = ["## RELEVANT MEMORY CONTEXT", ...sections.flatMap((section) => section.lines)].join("\n");
  return {
    markdown,
    selectedShortTerm: shortSection.count,
    selectedLongTerm: longSection.count,
    estimatedTokens: estimateTokens(markdown),
    semanticSearchUsed: shortSemantic.length > 0 || longSemantic.length > 0,
  };
}
