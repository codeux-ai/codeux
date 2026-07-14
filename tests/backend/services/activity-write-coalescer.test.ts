import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ActivityWriteCoalescer } from "../../../src/services/activity-write-coalescer.js";

interface Batch {
  sessionId: string;
  items: Array<{ originator?: string; description: string; createTime?: string }>;
}

function makeSink() {
  const batches: Batch[] = [];
  return {
    batches,
    appendActivities: (sessionId: string, items: Batch["items"]) => {
      batches.push({ sessionId, items: items.map((item) => ({ ...item })) });
    },
  };
}

describe("ActivityWriteCoalescer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("flushes buffered activities as a single batch on the interval", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 250, maxBuffer: 100 });

    coalescer.push("line 1", "agent");
    coalescer.push("line 2", "agent");
    expect(sink.batches).toHaveLength(0); // nothing written yet

    vi.advanceTimersByTime(250);
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0].sessionId).toBe("s1");
    expect(sink.batches[0].items.map((i) => i.description)).toEqual(["line 1\nline 2"]);
  });

  it("flushes immediately once the buffer hits maxBuffer", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 1000, maxBuffer: 3 });

    coalescer.push("a");
    coalescer.push("b");
    expect(sink.batches).toHaveLength(0);
    coalescer.push("c");
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0].items).toHaveLength(1);
    expect(sink.batches[0].items[0].description).toBe("a\nb\nc");
  });

  it("keeps the first timestamp when adjacent rows are compacted", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 250 });

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    coalescer.push("first");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    coalescer.push("second");
    coalescer.stop();

    const [a] = sink.batches[0].items;
    expect(a.createTime).toBe("2026-01-01T00:00:00.000Z");
    expect(a.description).toBe("first\nsecond");
  });

  it("does not merge different originators or exceed the row size bound", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", {
      flushIntervalMs: 250,
      maxChunkChars: 256,
    });

    coalescer.push("a".repeat(200), "agent");
    coalescer.push("b".repeat(100), "agent");
    coalescer.push("provider line", "provider");
    coalescer.stop();

    expect(sink.batches[0].items).toHaveLength(3);
    expect(sink.batches[0].items.map((item) => item.originator)).toEqual(["agent", "agent", "provider"]);
  });

  it("stop() flushes the tail and a subsequent timer does not double-write", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 250 });

    coalescer.push("tail");
    coalescer.stop();
    expect(sink.batches).toHaveLength(1);

    vi.advanceTimersByTime(500);
    expect(sink.batches).toHaveLength(1); // no extra empty flush
  });

  it("never throws when the sink fails", () => {
    const logger = { warn: vi.fn() };
    const coalescer = new ActivityWriteCoalescer(
      { appendActivities: () => { throw new Error("db locked"); } },
      "s1",
      { flushIntervalMs: 10, logger },
    );
    coalescer.push("x");
    expect(() => coalescer.stop()).not.toThrow();
    expect(logger.warn).toHaveBeenCalledWith(
      "activity_write_coalescer_flush_failed",
      expect.objectContaining({
        sessionId: "s1",
        batchSize: 1,
        error: expect.any(Error),
      }),
    );
  });

  it("drain() flushes buffered activity explicitly", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 250 });

    coalescer.push("tail");
    coalescer.drain();

    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0].items.map((item) => item.description)).toEqual(["tail"]);
  });
});
