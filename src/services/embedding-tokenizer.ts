import * as fs from "fs";

/**
 * Minimal HuggingFace tokenizer.json parser for ONNX model input.
 * Supports WordPiece (BERT/BGE) and BPE tokenization.
 */

type MergeEntry = string | [string, string];

interface TokenizerConfig {
  model: {
    type: string;
    vocab: Record<string, number>;
    merges?: MergeEntry[];
    unk_token?: string;
    continuing_subword_prefix?: string;
  };
  added_tokens?: Array<{
    id: number;
    content: string;
    special: boolean;
  }>;
  pre_tokenizer?: unknown;
  post_processor?: {
    type: string;
    single?: Array<{ SpecialToken?: { id: string; type_id: number } }>;
    pair?: unknown;
  };
}

export interface TokenizerOutput {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
}

export class EmbeddingTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly mergeRanks: Map<string, number>;
  private readonly unkToken: string;
  private readonly unkId: number;
  private readonly clsId: number;
  private readonly sepId: number;
  private readonly padId: number;
  private readonly isWordPiece: boolean;
  private readonly prefix: string;
  private readonly maxLength: number;

  constructor(tokenizerJsonPath: string, maxLength = 512) {
    const raw = JSON.parse(fs.readFileSync(tokenizerJsonPath, "utf-8")) as TokenizerConfig;
    this.vocab = new Map(Object.entries(raw.model.vocab));

    // Build merge priority map: "a\0b" → rank (lower = higher priority)
    this.mergeRanks = new Map();
    const rawMerges = raw.model.merges ?? [];
    for (let i = 0; i < rawMerges.length; i++) {
      const m = rawMerges[i];
      const [a, b] = Array.isArray(m) ? m : m.split(" ");
      if (a && b) {
        this.mergeRanks.set(`${a}\0${b}`, i);
      }
    }

    this.isWordPiece = raw.model.type === "WordPiece";
    this.prefix = raw.model.continuing_subword_prefix ?? "##";
    this.unkToken = raw.model.unk_token ?? "[UNK]";
    this.unkId = this.vocab.get(this.unkToken) ?? 0;
    this.maxLength = maxLength;

    // Resolve special token IDs
    const addedMap = new Map<string, number>();
    for (const token of raw.added_tokens ?? []) {
      addedMap.set(token.content, token.id);
      this.vocab.set(token.content, token.id);
    }

    this.clsId = addedMap.get("[CLS]") ?? this.vocab.get("[CLS]") ?? 101;
    this.sepId = addedMap.get("[SEP]") ?? this.vocab.get("[SEP]") ?? 102;
    this.padId = addedMap.get("[PAD]") ?? this.vocab.get("[PAD]") ?? 0;
  }

  encode(text: string): TokenizerOutput {
    const tokens = this.isWordPiece
      ? this.wordPieceTokenize(text)
      : this.bpeTokenize(text);

    // Truncate to maxLength - 2 (room for CLS + SEP)
    const maxTokens = this.maxLength - 2;
    const truncated = tokens.length > maxTokens ? tokens.slice(0, maxTokens) : tokens;

    const length = truncated.length + 2;
    const inputIds = new BigInt64Array(length);
    const attentionMask = new BigInt64Array(length);
    const tokenTypeIds = new BigInt64Array(length);

    inputIds[0] = BigInt(this.clsId);
    attentionMask[0] = 1n;
    tokenTypeIds[0] = 0n;

    for (let i = 0; i < truncated.length; i++) {
      inputIds[i + 1] = BigInt(truncated[i]);
      attentionMask[i + 1] = 1n;
      tokenTypeIds[i + 1] = 0n;
    }

    inputIds[length - 1] = BigInt(this.sepId);
    attentionMask[length - 1] = 1n;
    tokenTypeIds[length - 1] = 0n;

    return { inputIds, attentionMask, tokenTypeIds };
  }

  private wordPieceTokenize(text: string): number[] {
    const ids: number[] = [];
    const words = text.toLowerCase().split(/\s+/).filter(Boolean);

    for (const word of words) {
      let start = 0;
      let matched = false;

      while (start < word.length) {
        let end = word.length;
        let found = false;

        while (start < end) {
          const substr = start === 0 ? word.slice(start, end) : this.prefix + word.slice(start, end);
          const id = this.vocab.get(substr);
          if (id !== undefined) {
            ids.push(id);
            start = end;
            found = true;
            matched = true;
            break;
          }
          end--;
        }

        if (!found) {
          if (!matched) {
            ids.push(this.unkId);
          }
          break;
        }
      }
    }

    return ids;
  }

  private bpeTokenize(text: string): number[] {
    const ids: number[] = [];
    const words = text.split(/\s+/).filter(Boolean);

    for (const word of words) {
      const wordId = this.vocab.get(word);
      if (wordId !== undefined) {
        ids.push(wordId);
        continue;
      }

      // Split into characters, then iteratively merge the highest-priority pair
      let tokens: string[] = [...word];

      while (tokens.length > 1) {
        // Find the pair with the lowest merge rank (highest priority)
        let bestRank = Infinity;
        let bestIdx = -1;

        for (let i = 0; i < tokens.length - 1; i++) {
          const rank = this.mergeRanks.get(`${tokens[i]}\0${tokens[i + 1]}`);
          if (rank !== undefined && rank < bestRank) {
            bestRank = rank;
            bestIdx = i;
          }
        }

        if (bestIdx === -1) break; // No more merges apply

        // Apply the merge at bestIdx
        tokens = [
          ...tokens.slice(0, bestIdx),
          tokens[bestIdx] + tokens[bestIdx + 1],
          ...tokens.slice(bestIdx + 2),
        ];
      }

      for (const token of tokens) {
        ids.push(this.vocab.get(token) ?? this.unkId);
      }
    }

    return ids;
  }
}
