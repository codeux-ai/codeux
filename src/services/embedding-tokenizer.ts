import * as fs from "fs";

/**
 * Minimal HuggingFace tokenizer.json parser for ONNX model input.
 * Supports WordPiece (BERT/BGE) and BPE (Qwen3) tokenization.
 */

interface TokenizerConfig {
  model: {
    type: string;
    vocab: Record<string, number>;
    merges?: string[];
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
  private readonly merges: string[];
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
    this.merges = raw.model.merges ?? [];
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
    // Simple BPE: split into characters, then greedily merge using vocabulary
    const ids: number[] = [];
    const words = text.split(/\s+/).filter(Boolean);

    for (const word of words) {
      const wordId = this.vocab.get(word);
      if (wordId !== undefined) {
        ids.push(wordId);
        continue;
      }

      // Fall back to character-level lookup
      let tokens: string[] = [...word];
      // Apply merges greedily
      for (const merge of this.merges) {
        const [a, b] = merge.split(" ");
        if (!a || !b) continue;

        const merged: string[] = [];
        let i = 0;
        while (i < tokens.length) {
          if (i < tokens.length - 1 && tokens[i] === a && tokens[i + 1] === b) {
            merged.push(a + b);
            i += 2;
          } else {
            merged.push(tokens[i]);
            i++;
          }
        }
        tokens = merged;
      }

      for (const token of tokens) {
        ids.push(this.vocab.get(token) ?? this.unkId);
      }
    }

    return ids;
  }
}
