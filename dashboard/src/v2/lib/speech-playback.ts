const CODEUX_WIDGET_FENCE = /```[ \t]*codeux:[a-z][a-z0-9_-]*[^\r\n]*(?:\r?\n)?[\s\S]*?(?:```|$)/gi;
const MARKDOWN_FENCE_OPEN = /^[ \t]{0,3}(`{3,}|~{3,})/;
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

export function splitSpeechPlaybackText(
  text: string,
  maxChars = MAX_SPEECH_PLAYBACK_CHARS,
): string[] {
  if (maxChars < 1) return [];
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxChars) {
    const candidate = remaining.slice(0, maxChars + 1);
    const whitespaceBoundary = Math.max(
      candidate.lastIndexOf(" "),
      candidate.lastIndexOf("\n"),
      candidate.lastIndexOf("\t"),
    );
    const boundary = whitespaceBoundary >= Math.floor(maxChars / 2)
      ? whitespaceBoundary
      : maxChars;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}
