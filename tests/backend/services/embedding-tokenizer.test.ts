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

function makeUnigramConfig() {
  return JSON.stringify({
    model: {
      type: "Unigram",
      unk_id: 3,
      vocab: [
        ["<s>", 0],
        ["<pad>", 0],
        ["</s>", 0],
        ["<unk>", 0],
        ["▁hello", -1],
        ["▁world", -1],
        ["▁passage", -1],
        [":", -1],
        ["▁", -3],
        ["h", -4],
        ["e", -4],
        ["l", -4],
        ["o", -4],
        ["w", -4],
        ["r", -4],
        ["d", -4],
      ],
    },
    added_tokens: [
      { id: 0, content: "<s>", special: true },
      { id: 1, content: "<pad>", special: true },
      { id: 2, content: "</s>", special: true },
      { id: 3, content: "<unk>", special: true },
    ],
    pre_tokenizer: {
      type: "Sequence",
      pretokenizers: [
        { type: "WhitespaceSplit" },
        { type: "Metaspace", replacement: "▁", add_prefix_space: true },
      ],
    },
    post_processor: {
      type: "TemplateProcessing",
      single: [
        { SpecialToken: { id: "<s>", type_id: 0 } },
        { Sequence: { id: "A", type_id: 0 } },
        { SpecialToken: { id: "</s>", type_id: 0 } },
      ],
      special_tokens: {
        "<s>": { id: "<s>", ids: [0], tokens: ["<s>"] },
        "</s>": { id: "</s>", ids: [2], tokens: ["</s>"] },
      },
    },
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

  describe("Unigram tokenization", () => {
    let tokenizer: EmbeddingTokenizer;

    beforeEach(() => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeUnigramConfig());
      tokenizer = new EmbeddingTokenizer("/fake/tokenizer.json");
    });

    it("encodes E5/XLM-R tokenizer arrays as numeric IDs", () => {
      const result = tokenizer.encode("hello world");
      expect([...result.inputIds]).toEqual([0n, 4n, 5n, 2n]);
      expect(result.attentionMask.every((v) => v === 1n)).toBe(true);
      expect(result.tokenTypeIds.every((v) => v === 0n)).toBe(true);
    });

    it("splits metaspace words with punctuation without tuple BigInt conversion", () => {
      const result = tokenizer.encode("passage: hello");
      expect([...result.inputIds]).toEqual([0n, 6n, 7n, 4n, 2n]);
    });
  });
});
