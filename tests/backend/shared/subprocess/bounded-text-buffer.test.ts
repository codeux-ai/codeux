import { describe, expect, it } from "vitest";
import { BoundedTextBuffer } from "../../../../src/shared/subprocess/bounded-text-buffer.js";

describe("BoundedTextBuffer", () => {
  it("retains only the configured tail across many small appends", () => {
    const buffer = new BoundedTextBuffer(10);
    for (const chunk of ["12", "345", "67", "890", "abc"]) {
      buffer.append(chunk);
    }
    expect(buffer.toString()).toBe("4567890abc");
    expect(buffer.length).toBe(10);
    expect(buffer.clipped).toBe(true);
  });

  it("discards output without retaining chunks when configured with zero capacity", () => {
    const buffer = new BoundedTextBuffer(0);
    buffer.append("large output");
    expect(buffer.toString()).toBe("");
    expect(buffer.length).toBe(0);
    expect(buffer.clipped).toBe(true);
  });

  it("materializes fragmented snapshots once and releases chunks when taken", () => {
    const buffer = new BoundedTextBuffer(20);
    buffer.append("first");
    buffer.append(" second");

    const firstSnapshot = buffer.toString();
    expect(firstSnapshot).toBe("first second");
    expect(buffer.toString()).toBe(firstSnapshot);
    expect((buffer as unknown as { chunks: string[] }).chunks).toHaveLength(1);

    expect(buffer.takeString()).toBe("first second");
    expect(buffer.length).toBe(0);
    expect((buffer as unknown as { chunks: string[] }).chunks).toHaveLength(0);
  });
});
