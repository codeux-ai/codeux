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
    expect(sink.batches[0].items.map((i) => i.description)).toEqual(["line 1", "line 2"]);
  });

  it("flushes immediately once the buffer hits maxBuffer", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 1000, maxBuffer: 3 });

    coalescer.push("a");
    coalescer.push("b");
    expect(sink.batches).toHaveLength(0);
    coalescer.push("c");
    expect(sink.batches).toHaveLength(1);
    expect(sink.batches[0].items).toHaveLength(3);
  });

  it("stamps each activity at push time to preserve ordering", () => {
    const sink = makeSink();
    const coalescer = new ActivityWriteCoalescer(sink, "s1", { flushIntervalMs: 250 });

    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    coalescer.push("first");
    vi.setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
    coalescer.push("second");
    coalescer.stop();

    const [a, b] = sink.batches[0].items;
    expect(a.createTime).toBe("2026-01-01T00:00:00.000Z");
    expect(b.createTime).toBe("2026-01-01T00:00:00.500Z");
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
    const coalescer = new ActivityWriteCoalescer(
      { appendActivities: () => { throw new Error("db locked"); } },
      "s1",
      { flushIntervalMs: 10 },
    );
    coalescer.push("x");
    expect(() => coalescer.stop()).not.toThrow();
  });
});
