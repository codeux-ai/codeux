import { describe, expect, it } from "vitest";
import { ProviderTranscriptChunkDecoder } from "../../../../../src/infrastructure/providers/cli/provider-transcript-chunks.js";

function encoded(value: Buffer): string {
  return value.toString("base64");
}

describe("ProviderTranscriptChunkDecoder", () => {
  it("preserves UTF-8 code points split across byte ranges", () => {
    const decoder = new ProviderTranscriptChunkDecoder();
    const bytes = Buffer.from("before € after", "utf8");
    const splitAt = Buffer.from("before ", "utf8").length + 1;
    const first = decoder.consume({
      sourceId: "1:10",
      startOffset: 0,
      nextOffset: splitAt,
      totalBytes: bytes.length,
      contentBase64: encoded(bytes.subarray(0, splitAt)),
      reset: true,
    });
    const second = decoder.consume({
      sourceId: "1:10",
      startOffset: splitAt,
      nextOffset: bytes.length,
      totalBytes: bytes.length,
      contentBase64: encoded(bytes.subarray(splitAt)),
      reset: false,
    });

    expect(first.text + second.text).toBe("before € after");
    expect(second.complete).toBe(true);
    expect(decoder.cursor).toEqual({ sourceId: "1:10", offset: bytes.length });
  });

  it("resets offsets and decoder state on rotation or truncation", () => {
    const decoder = new ProviderTranscriptChunkDecoder();
    decoder.consume({
      sourceId: "old",
      startOffset: 0,
      nextOffset: 4,
      totalBytes: 8,
      contentBase64: encoded(Buffer.from("old ")),
      reset: true,
    });

    const rotated = decoder.consume({
      sourceId: "new",
      startOffset: 0,
      nextOffset: 3,
      totalBytes: 3,
      contentBase64: encoded(Buffer.from("new")),
      reset: true,
    });

    expect(rotated).toMatchObject({ text: "new", reset: true, complete: true });
    expect(rotated.cursor).toEqual({ sourceId: "new", offset: 3 });
  });
});
