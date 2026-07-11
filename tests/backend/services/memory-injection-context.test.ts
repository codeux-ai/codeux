import { describe, expect, it, vi } from "vitest";
import type { MemoryRecord, MemorySearchResult } from "../../../src/contracts/memory-types.js";
import { buildRelevantMemoryInjectionContext } from "../../../src/services/memory-injection-context.js";
import type { MemoryService } from "../../../src/services/memory-service.js";

const memory = (overrides: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "content">): MemoryRecord => ({
  id: overrides.id,
  projectId: "project-1",
  scope: "project",
  sprintId: null,
  agentPresetId: "agent-1",
  content: overrides.content,
  category: "context",
  strength: 0.7,
  source: { type: "manual" },
  embeddingModel: null,
  embeddingDimension: null,
  embeddingBlob: null,
  promotedFromId: null,
  promotionReason: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  ...overrides,
});

const service = (args: {
  short?: MemoryRecord[];
  long?: MemoryRecord[];
  semantic?: MemorySearchResult[];
  searchError?: Error;
}): Pick<MemoryService, "listBySprintAndAgent" | "listLongTermByAgent" | "search"> => ({
  listBySprintAndAgent: vi.fn().mockReturnValue(args.short ?? []),
  listLongTermByAgent: vi.fn().mockReturnValue(args.long ?? []),
  search: args.searchError
    ? vi.fn().mockRejectedValue(args.searchError)
    : vi.fn().mockResolvedValue(args.semantic ?? []),
});

describe("buildRelevantMemoryInjectionContext", () => {
  it("uses semantic relevance ahead of recency and strength while respecting per-tier caps", async () => {
    const relevant = memory({ id: "relevant", content: "The authentication boundary uses signed session tokens.", strength: 0.45 });
    const recent = memory({ id: "recent", content: "Unrelated formatting preference.", strength: 1, updatedAt: new Date().toISOString() });
    const result = await buildRelevantMemoryInjectionContext(service({
      long: [recent, relevant],
      semantic: [{ memory: relevant, similarity: 0.98 }],
    }), {
      projectId: "project-1",
      agentPresetId: "agent-1",
      query: "repair authentication session tokens",
      config: {
        tier: "long_term",
        categories: [],
        minStrength: 0,
        minStrengthPerCategory: {},
        maxShortTerm: 0,
        maxLongTerm: 1,
      },
    });

    expect(result.markdown).toContain(relevant.content);
    expect(result.markdown).not.toContain(recent.content);
    expect(result.selectedLongTerm).toBe(1);
    expect(result.semanticSearchUsed).toBe(true);
  });

  it("falls back to deterministic lexical ranking when semantic search is unavailable", async () => {
    const matching = memory({ id: "matching", content: "Run the release validation and security audit before merging.", strength: 0.6 });
    const unrelated = memory({ id: "unrelated", content: "Prefer compact cards in the dashboard.", strength: 0.8 });
    const result = await buildRelevantMemoryInjectionContext(service({
      long: [unrelated, matching],
      searchError: new Error("embedding model offline"),
    }), {
      projectId: "project-1",
      agentPresetId: "agent-1",
      query: "release validation security audit",
      config: {
        tier: "long_term",
        categories: [],
        minStrength: 0,
        minStrengthPerCategory: {},
        maxShortTerm: 0,
        maxLongTerm: 1,
      },
    });

    expect(result.markdown).toContain(matching.content);
    expect(result.markdown).not.toContain(unrelated.content);
    expect(result.semanticSearchUsed).toBe(false);
  });

  it("deduplicates repeated knowledge across tiers and stays inside the token budget", async () => {
    const duplicateLong = memory({ id: "long", content: "Use read-only skill mounts inside provider containers.", strength: 0.7 });
    const duplicateShort = memory({
      id: "short",
      content: duplicateLong.content,
      scope: "sprint",
      sprintId: "sprint-1",
      strength: 0.9,
    });
    const verbose = memory({ id: "verbose", content: "Repository context ".repeat(500), strength: 0.8 });
    const result = await buildRelevantMemoryInjectionContext(service({
      short: [duplicateShort],
      long: [duplicateLong, verbose],
    }), {
      projectId: "project-1",
      sprintId: "sprint-1",
      agentPresetId: "agent-1",
      query: "skill mounts repository context",
      tokenBudget: 256,
    });

    expect(result.markdown?.match(/Use read-only skill mounts/g)).toHaveLength(1);
    expect(result.estimatedTokens).toBeLessThanOrEqual(256);
  });

  it("filters categories and strength before ranking", async () => {
    const allowed = memory({ id: "allowed", content: "Architecture contract", category: "architecture", strength: 0.8 });
    const weak = memory({ id: "weak", content: "Weak architecture note", category: "architecture", strength: 0.4 });
    const wrongCategory = memory({ id: "wrong", content: "Error recovery", category: "error", strength: 1 });
    const result = await buildRelevantMemoryInjectionContext(service({ long: [allowed, weak, wrongCategory] }), {
      projectId: "project-1",
      agentPresetId: "agent-1",
      query: "architecture",
      config: {
        tier: "long_term",
        categories: ["architecture"],
        minStrength: 0.5,
        minStrengthPerCategory: { architecture: 0.75 },
        maxShortTerm: 0,
        maxLongTerm: 8,
      },
    });

    expect(result.markdown).toContain(allowed.content);
    expect(result.markdown).not.toContain(weak.content);
    expect(result.markdown).not.toContain(wrongCategory.content);
  });
});
