import * as fs from "fs";

/**
 * Minimal HuggingFace tokenizer.json parser for ONNX model input.
 * Supports WordPiece (BERT/BGE), BPE, and SentencePiece Unigram tokenization.
 */

type MergeEntry = string | [string, string];
type VocabRecord = Record<string, number>;
type UnigramVocabEntry = [string, number];
type VocabConfig = VocabRecord | UnigramVocabEntry[];

interface TokenizerConfig {
  model: {
    type: string;
    vocab: VocabConfig;
    merges?: MergeEntry[];
    unk_token?: string;
    unk_id?: number;
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
    single?: Array<{ SpecialToken?: { id: string; type_id: number }; Sequence?: { id: string; type_id: number } }>;
    pair?: unknown;
    special_tokens?: Record<string, { ids?: number[]; tokens?: string[] }>;
  };
}

export interface TokenizerOutput {
  inputIds: BigInt64Array;
  attentionMask: BigInt64Array;
  tokenTypeIds: BigInt64Array;
}

export class EmbeddingTokenizer {
  private readonly vocab: Map<string, number>;
  private readonly unigramScores: Map<string, number>;
  private readonly mergeRanks: Map<string, number>;
  private readonly unkToken: string;
  private readonly unkId: number;
  private readonly clsId: number;
  private readonly sepId: number;
  private readonly padId: number;
  private readonly isWordPiece: boolean;
  private readonly isUnigram: boolean;
  private readonly prefix: string;
  private readonly maxLength: number;
  private readonly maxTokenLength: number;

  constructor(tokenizerJsonPath: string, maxLength = 512) {
    const raw = JSON.parse(fs.readFileSync(tokenizerJsonPath, "utf-8")) as TokenizerConfig;
    const { vocab, unigramScores } = this.parseVocab(raw.model.vocab);
    this.vocab = vocab;
    this.unigramScores = unigramScores;
    this.maxTokenLength = this.getMaxTokenLength();

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
    this.isUnigram = raw.model.type === "Unigram";
    this.prefix = raw.model.continuing_subword_prefix ?? "##";
    this.unkToken = raw.model.unk_token ?? "[UNK]";
    this.maxLength = maxLength;

    // Resolve special token IDs
    const addedMap = new Map<string, number>();
    for (const token of raw.added_tokens ?? []) {
      addedMap.set(token.content, token.id);
      this.vocab.set(token.content, token.id);
    }

    const templateSpecialIds = this.readTemplateSpecialIds(raw);

    this.unkId = raw.model.unk_id
      ?? this.resolveTokenId(this.unkToken, raw, addedMap)
      ?? this.resolveTokenId("<unk>", raw, addedMap)
      ?? 0;
    this.clsId = templateSpecialIds.clsId
      ?? this.resolveTokenId("[CLS]", raw, addedMap)
      ?? this.resolveTokenId("<s>", raw, addedMap)
      ?? 101;
    this.sepId = templateSpecialIds.sepId
      ?? this.resolveTokenId("[SEP]", raw, addedMap)
      ?? this.resolveTokenId("</s>", raw, addedMap)
      ?? 102;
    this.padId = this.resolveTokenId("[PAD]", raw, addedMap)
      ?? this.resolveTokenId("<pad>", raw, addedMap)
      ?? 0;
  }

  encode(text: string): TokenizerOutput {
    const tokens = this.isWordPiece
      ? this.wordPieceTokenize(text)
      : this.isUnigram
        ? this.unigramTokenize(text)
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

  private parseVocab(vocabConfig: VocabConfig): { vocab: Map<string, number>; unigramScores: Map<string, number> } {
    const vocab = new Map<string, number>();
    const unigramScores = new Map<string, number>();

    if (Array.isArray(vocabConfig)) {
      for (let i = 0; i < vocabConfig.length; i++) {
        const [token, score] = vocabConfig[i]!;
        vocab.set(token, i);
        unigramScores.set(token, score);
      }
      return { vocab, unigramScores };
    }

    for (const [token, id] of Object.entries(vocabConfig)) {
      vocab.set(token, id);
    }
    return { vocab, unigramScores };
  }

  private getMaxTokenLength(): number {
    let maxTokenLength = 1;
    for (const token of this.vocab.keys()) {
      if (token.length > maxTokenLength) {
        maxTokenLength = token.length;
      }
    }
    return maxTokenLength;
  }

  private readTemplateSpecialIds(raw: TokenizerConfig): { clsId: number | null; sepId: number | null } {
    const template = raw.post_processor?.single;
    if (!template) {
      return { clsId: null, sepId: null };
    }

    const sequenceIndex = template.findIndex((entry) => entry.Sequence);
    const beforeSequence = sequenceIndex >= 0 ? template.slice(0, sequenceIndex) : [];
    const afterSequence = sequenceIndex >= 0 ? template.slice(sequenceIndex + 1) : [];

    return {
      clsId: this.resolveTemplateSpecial(beforeSequence[0]?.SpecialToken?.id, raw),
      sepId: this.resolveTemplateSpecial(afterSequence[0]?.SpecialToken?.id, raw),
    };
  }

  private resolveTemplateSpecial(token: string | undefined, raw: TokenizerConfig): number | null {
    if (!token) {
      return null;
    }
    return raw.post_processor?.special_tokens?.[token]?.ids?.[0] ?? this.vocab.get(token) ?? null;
  }

  private resolveTokenId(token: string, raw: TokenizerConfig, addedMap: Map<string, number>): number | null {
    return addedMap.get(token)
      ?? raw.post_processor?.special_tokens?.[token]?.ids?.[0]
      ?? this.vocab.get(token)
      ?? null;
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

  private unigramTokenize(text: string): number[] {
    const ids: number[] = [];
    const words = text.split(/\s+/).filter(Boolean);

    for (const word of words) {
      ids.push(...this.tokenizeUnigramSegment(`▁${word}`));
    }

    return ids;
  }

  private tokenizeUnigramSegment(segment: string): number[] {
    const unknownPenalty = -100;
    const bestScores = new Array<number>(segment.length + 1).fill(-Infinity);
    const bestPieces = new Array<{ id: number; start: number } | null>(segment.length + 1).fill(null);
    bestScores[0] = 0;

    for (let start = 0; start < segment.length; start++) {
      if (!Number.isFinite(bestScores[start])) {
        continue;
      }

      const maxEnd = Math.min(segment.length, start + this.maxTokenLength);
      for (let end = start + 1; end <= maxEnd; end++) {
        const piece = segment.slice(start, end);
        const id = this.vocab.get(piece);
        if (id === undefined) {
          continue;
        }
        const score = bestScores[start] + (this.unigramScores.get(piece) ?? 0);
        if (score > bestScores[end]) {
          bestScores[end] = score;
          bestPieces[end] = { id, start };
        }
      }

      const score = bestScores[start] + unknownPenalty;
      if (score > bestScores[start + 1]) {
        bestScores[start + 1] = score;
        bestPieces[start + 1] = { id: this.unkId, start };
      }
    }

    const ids: number[] = [];
    let end = segment.length;
    while (end > 0) {
      const piece = bestPieces[end];
      if (!piece) {
        ids.push(this.unkId);
        end--;
        continue;
      }
      ids.push(piece.id);
      end = piece.start;
    }

    return ids.reverse();
  }
}
