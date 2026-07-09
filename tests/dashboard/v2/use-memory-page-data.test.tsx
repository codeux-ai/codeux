/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMemoryPageData } from "../../../dashboard/src/v2/hooks/use-memory-page-data.js";
import {
  getEmbeddingMap,
  getMemoryStats,
  listEmbeddingModels,
  listMemories,
  type EmbeddingMapResult,
  type MemoryStats,
} from "../../../dashboard/src/v2/lib/memory-api.js";
import type { MemoryRecord, MemoryScope } from "../../../dashboard/src/v2/memory-types.js";

vi.mock("../../../dashboard/src/v2/lib/memory-api.js", () => ({
  createMemory: vi.fn(),
  deleteMemory: vi.fn(),
  deleteMemories: vi.fn(),
  getEmbeddingMap: vi.fn(),
  getMemoryStats: vi.fn(),
  listEmbeddingModels: vi.fn(),
  listMemories: vi.fn(),
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

const createMemoryRecord = (id: string, sprintId: string): MemoryRecord => ({
  id,
  projectId: "project-1",
  scope: "sprint",
  sprintId,
  agentPresetId: null,
  content: `Memory ${id}`,
  category: "learning",
  strength: 0.8,
  source: { type: "manual" },
  embeddingModel: null,
  embeddingDimension: null,
  embeddingBlob: null,
  promotedFromId: null,
  promotionReason: null,
  createdAt: "2026-07-09T00:00:00.000Z",
  updatedAt: "2026-07-09T00:00:00.000Z",
});

const createEmbeddingMap = (id: string): EmbeddingMapResult => ({
  hasEmbeddings: true,
  nodes: [{ id, x: 10, y: 20 }],
  edges: [],
});

const stats: MemoryStats = {
  sprint: 1,
  agent: 0,
  project: 0,
  activeModel: null,
  staleEmbeddings: 0,
};

const renderMemoryHook = (initialSprintId: string) => renderHook(
  ({ sprintId }: { sprintId: string }) => useMemoryPageData(
    "project-1",
    "sprint" as MemoryScope,
    "short_term",
    sprintId,
  ),
  { initialProps: { sprintId: initialSprintId } },
);

describe("useMemoryPageData", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listEmbeddingModels).mockResolvedValue([]);
    vi.mocked(getMemoryStats).mockResolvedValue(stats);
  });

  it("applies only the latest request data when older memory and map responses resolve last", async () => {
    const firstMemories = createDeferred<MemoryRecord[]>();
    const firstMap = createDeferred<EmbeddingMapResult>();
    const secondMemories = createDeferred<MemoryRecord[]>();
    const secondMap = createDeferred<EmbeddingMapResult>();

    vi.mocked(listMemories).mockImplementation((params) => {
      return params.sprintId === "sprint-a" ? firstMemories.promise : secondMemories.promise;
    });
    vi.mocked(getEmbeddingMap).mockImplementation((_projectId, _scope, sprintId) => {
      return sprintId === "sprint-a" ? firstMap.promise : secondMap.promise;
    });

    const { result, rerender } = renderMemoryHook("sprint-a");

    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(1));

    rerender({ sprintId: "sprint-b" });

    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(2));

    await act(async () => {
      secondMemories.resolve([createMemoryRecord("latest-memory", "sprint-b")]);
      secondMap.resolve(createEmbeddingMap("latest-memory"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.graphData?.map?.nodes[0]?.id).toBe("latest-memory");
    });

    await act(async () => {
      firstMemories.resolve([createMemoryRecord("stale-memory", "sprint-a")]);
      firstMap.resolve(createEmbeddingMap("stale-memory"));
      await Promise.resolve();
    });

    expect(result.current.records.map((record) => record.id)).toEqual(["latest-memory"]);
    expect(result.current.memoryCount).toBe(1);
    expect(result.current.graphData?.map?.nodes[0]?.id).toBe("latest-memory");
    expect(result.current.graphData?.graph.nodes.map((node) => node.id)).toEqual(["latest-memory"]);
    expect(result.current.loading).toBe(false);
  });

  it("does not let a stale rejection clear loading while a newer request is in flight", async () => {
    const firstMemories = createDeferred<MemoryRecord[]>();
    const secondMemories = createDeferred<MemoryRecord[]>();
    const secondMap = createDeferred<EmbeddingMapResult>();

    vi.mocked(listMemories).mockImplementation((params) => {
      return params.sprintId === "sprint-a" ? firstMemories.promise : secondMemories.promise;
    });
    vi.mocked(getEmbeddingMap).mockImplementation((_projectId, _scope, sprintId) => {
      return sprintId === "sprint-a" ? Promise.resolve(createEmbeddingMap("stale-memory")) : secondMap.promise;
    });

    const { result, rerender } = renderMemoryHook("sprint-a");

    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(1));

    rerender({ sprintId: "sprint-b" });

    await waitFor(() => expect(listMemories).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstMemories.reject(new Error("stale failure"));
      await Promise.resolve();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.loadError).toBeNull();

    await act(async () => {
      secondMemories.resolve([createMemoryRecord("latest-memory", "sprint-b")]);
      secondMap.resolve(createEmbeddingMap("latest-memory"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.graphData?.map?.nodes[0]?.id).toBe("latest-memory");
    });
  });
});
