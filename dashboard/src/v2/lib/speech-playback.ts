const CODEUX_WIDGET_FENCE = /```[ \t]*codeux:[a-z][a-z0-9_-]*[^\r\n]*(?:\r?\n)?[\s\S]*?(?:```|$)/gi;
const MARKDOWN_FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
const SENTENCE_TERMINATORS = new Set([".", "!", "?", "\u2026", "\u3002", "\uff01", "\uff1f"]);
const SENTENCE_CLOSERS = new Set(["\"", "'", "\u2019", "\u201d", "\u00bb", ")", "]", "}"]);
export const MAX_SPEECH_PLAYBACK_CHARS = 8_000;

function removeMarkdownFencedBlocks(markdown: string): string {
  const spokenLines: string[] = [];
  let openFence: { marker: "`" | "~"; length: number } | null = null;

  for (const line of markdown.split(/\r?\n/)) {
    if (openFence) {
      const closingFence = line.trim();
      const { length, marker } = openFence;
      if (
        closingFence.length >= length
        && closingFence.split("").every((character) => character === marker)
      ) {
        openFence = null;
      }
      continue;
    }

    const match = line.match(MARKDOWN_FENCE_OPEN);
    if (match) {
      openFence = {
        marker: match[1][0] as "`" | "~",
        length: match[1].length,
      };
      continue;
    }

    spokenLines.push(line);
  }

  return spokenLines.join("\n");
}

/**
 * Convert visible reply Markdown into speech input.
 *
 * Dashboard-only rich widgets and ordinary fenced code are presentation
 * details, so neither their payloads nor a synthetic "omitted" notice should
 * reach a speech provider. Human-facing prose around those blocks is kept.
 */
export function speechTextFromMarkdown(markdown: string): string {
  const withoutWidgets = markdown.replace(CODEUX_WIDGET_FENCE, "\n");

  return removeMarkdownFencedBlocks(withoutWidgets)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpeechPlaybackText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitAtSentenceBoundaries(text: string): string[] {
  const sentences: string[] = [];
  let sentenceStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_TERMINATORS.has(text[index])) continue;

    let sentenceEnd = index + 1;
    while (sentenceEnd < text.length && SENTENCE_TERMINATORS.has(text[sentenceEnd])) {
      sentenceEnd += 1;
    }
    while (sentenceEnd < text.length && SENTENCE_CLOSERS.has(text[sentenceEnd])) {
      sentenceEnd += 1;
    }

    if (sentenceEnd < text.length && text[sentenceEnd] !== " ") {
      index = sentenceEnd - 1;
      continue;
    }

    sentences.push(text.slice(sentenceStart, sentenceEnd));
    sentenceStart = sentenceEnd < text.length ? sentenceEnd + 1 : sentenceEnd;
    index = sentenceStart - 1;
  }

  if (sentenceStart < text.length) sentences.push(text.slice(sentenceStart));
  return sentences;
}

function splitOversizedSpeechSegment(segment: string, maxChars: number): string[] {
  const chunks: string[] = [];
  let remaining = segment;

  while (remaining.length > maxChars) {
    const whitespaceBoundary = remaining.lastIndexOf(" ", maxChars);
    if (whitespaceBoundary > 0) {
      chunks.push(remaining.slice(0, whitespaceBoundary));
      remaining = remaining.slice(whitespaceBoundary + 1);
      continue;
    }

    chunks.push(remaining.slice(0, maxChars));
    remaining = remaining.slice(maxChars);
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

export function splitSpeechPlaybackText(
  text: string,
  maxChars = MAX_SPEECH_PLAYBACK_CHARS,
): string[] {
  const chunkLimit = Math.floor(maxChars);
  if (!Number.isSafeInteger(chunkLimit) || chunkLimit < 1) return [];

  const normalizedText = normalizeSpeechPlaybackText(text);
  if (!normalizedText) return [];

  const sentences = splitAtSentenceBoundaries(normalizedText);
  const chunks: string[] = [];
  const [firstSentence, ...remainingSentences] = sentences;
  if (!firstSentence) return [];

  // Keep a bounded first sentence independent so synthesis and playback can
  // begin without waiting for the rest of a long project-manager reply.
  chunks.push(...splitOversizedSpeechSegment(firstSentence, chunkLimit));

  let groupedSentences = "";
  for (const sentence of remainingSentences) {
    if (sentence.length > chunkLimit) {
      if (groupedSentences) {
        chunks.push(groupedSentences);
        groupedSentences = "";
      }
      chunks.push(...splitOversizedSpeechSegment(sentence, chunkLimit));
      continue;
    }

    const candidate = groupedSentences ? `${groupedSentences} ${sentence}` : sentence;
    if (candidate.length <= chunkLimit) {
      groupedSentences = candidate;
      continue;
    }

    chunks.push(groupedSentences);
    groupedSentences = sentence;
  }

  if (groupedSentences) chunks.push(groupedSentences);
  return chunks;
}
