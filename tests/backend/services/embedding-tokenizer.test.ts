import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";

// Mock fs.readFileSync before importing the module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, readFileSync: vi.fn() };
});

import { EmbeddingTokenizer } from "../../../src/services/embedding-tokenizer.js";

function makeWordPieceConfig(extraVocab: Record<string, number> = {}) {
  return JSON.stringify({
    model: {
      type: "WordPiece",
      vocab: {
        "[PAD]": 0,
        "[UNK]": 1,
        "[CLS]": 101,
        "[SEP]": 102,
        hello: 2000,
        world: 2001,
        "##ing": 2002,
        test: 2003,
        ...extraVocab,
      },
      unk_token: "[UNK]",
      continuing_subword_prefix: "##",
    },
    added_tokens: [
      { id: 0, content: "[PAD]", special: true },
      { id: 1, content: "[UNK]", special: true },
      { id: 101, content: "[CLS]", special: true },
      { id: 102, content: "[SEP]", special: true },
    ],
  });
}

function makeBpeConfig() {
  return JSON.stringify({
    model: {
      type: "BPE",
      vocab: {
        "[PAD]": 0,
        "[UNK]": 1,
        "[CLS]": 101,
        "[SEP]": 102,
        h: 10,
        e: 11,
        l: 12,
        o: 13,
        he: 20,
        hel: 30,
        hello: 40,
        w: 14,
        r: 15,
        d: 16,
        world: 41,
      },
      merges: ["h e", "he l", "hel l", "hell o"],
      unk_token: "[UNK]",
    },
    added_tokens: [
      { id: 0, content: "[PAD]", special: true },
      { id: 1, content: "[UNK]", special: true },
      { id: 101, content: "[CLS]", special: true },
      { id: 102, content: "[SEP]", special: true },
    ],
  });
}

describe("EmbeddingTokenizer", () => {
  describe("WordPiece tokenization", () => {
    let tokenizer: EmbeddingTokenizer;

    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeWordPieceConfig());
      tokenizer = new EmbeddingTokenizer("/fake/tokenizer.json");
    });

    it("encodes known words with CLS and SEP", () => {
      const result = tokenizer.encode("hello world");
      expect(result.inputIds[0]).toBe(101n); // [CLS]
      expect(result.inputIds[1]).toBe(2000n); // hello
      expect(result.inputIds[2]).toBe(2001n); // world
      expect(result.inputIds[3]).toBe(102n); // [SEP]
      expect(result.attentionMask.every((v) => v === 1n)).toBe(true);
    });

    it("uses UNK for unknown words", () => {
      const result = tokenizer.encode("xyzzy");
      // [CLS] [UNK] [SEP]
      expect(result.inputIds[0]).toBe(101n);
      expect(result.inputIds[1]).toBe(1n); // [UNK]
      expect(result.inputIds[2]).toBe(102n);
    });

    it("truncates to maxLength", () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeWordPieceConfig());
      const short = new EmbeddingTokenizer("/fake/tokenizer.json", 4); // max 4 = CLS + 2 tokens + SEP
      const result = short.encode("hello world test");
      expect(result.inputIds.length).toBeLessThanOrEqual(4);
    });
  });

  describe("BPE tokenization", () => {
    let tokenizer: EmbeddingTokenizer;

    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeBpeConfig());
      tokenizer = new EmbeddingTokenizer("/fake/tokenizer.json");
    });

    it("encodes a full-vocab word directly", () => {
      const result = tokenizer.encode("hello world");
      expect(result.inputIds[0]).toBe(101n); // [CLS]
      expect(result.inputIds[1]).toBe(40n); // hello (direct vocab match)
      expect(result.inputIds[2]).toBe(41n); // world (direct vocab match)
      expect(result.inputIds[3]).toBe(102n); // [SEP]
    });
  });
});
