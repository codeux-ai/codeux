import { describe, expect, it, vi } from "vitest";
import type { JulesActivity } from "../../../../src/contracts/app-types.js";
import type { JulesClient } from "../../../../src/domain/jules/jules-client.js";
import {
  countJulesTokensInChunks,
  JULES_TOKENIZER_CHUNK_CHARS,
} from "../../../../src/domain/jules/jules-usage-estimator.js";
import { JulesUsageService } from "../../../../src/domain/jules/jules-usage-service.js";
import type { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import type { Logger } from "../../../../src/shared/logging/logger.js";

function createService(getFullConversation: (sessionId: string) => Promise<JulesActivity[]>): JulesUsageService {
  const julesClient = {
    getFullConversation,
  } as unknown as JulesClient;
  const executionRepository = {
    getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
    createProviderInvocationUsage: vi.fn().mockReturnValue({
      id: "usage-1",
      createdAt: "2026-07-17T00:00:00.000Z",
      sprintId: null,
      taskId: "task-1",
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      attentionItemId: null,
    }),
    updateProviderInvocationUsage: vi.fn(),
    listExecutionInvocationsByProviderInvocationId: vi.fn().mockReturnValue([]),
    createExecutionInvocation: vi.fn().mockReturnValue({ id: "invocation-1" }),
    syncExecutionInvocationMessages: vi.fn(),
  } as unknown as ExecutionRepository;
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
  return new JulesUsageService(julesClient, executionRepository, logger);
}

describe("Jules usage memory bounds", () => {
  it("passes bounded slices to the tokenizer", () => {
    const text = "x".repeat(JULES_TOKENIZER_CHUNK_CHARS * 3 + 17);
    const chunkLengths: number[] = [];

    const tokens = countJulesTokensInChunks(text, (chunk) => {
      chunkLengths.push(chunk.length);
      return chunk.length;
    });

    expect(tokens).toBe(text.length);
    expect(chunkLengths).toHaveLength(4);
    expect(Math.max(...chunkLengths)).toBeLessThanOrEqual(JULES_TOKENIZER_CHUNK_CHARS);
  });

  it("keeps only one full-conversation fetch active across sessions", async () => {
    const resolvers = new Map<string, (activities: JulesActivity[]) => void>();
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    const service = createService(async (sessionId) => {
      activeFetches += 1;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      const activities = await new Promise<JulesActivity[]>((resolve) => {
        resolvers.set(sessionId, resolve);
      });
      activeFetches -= 1;
      return activities;
    });

    const first = service.syncLiveInvocation("project-1", "task-1", "session-a", "prompt");
    const second = service.syncLiveInvocation("project-1", "task-2", "session-b", "prompt");
    await vi.waitFor(() => expect(resolvers.has("session-a")).toBe(true));
    expect(resolvers.has("session-b")).toBe(false);

    resolvers.get("session-a")?.([]);
    await vi.waitFor(() => expect(resolvers.has("session-b")).toBe(true));
    resolvers.get("session-b")?.([]);
    await Promise.all([first, second]);

    expect(maximumActiveFetches).toBe(1);
  });
});
