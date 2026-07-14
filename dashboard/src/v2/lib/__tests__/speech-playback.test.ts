import { describe, expect, it } from "vitest";

import {
  MAX_SPEECH_PLAYBACK_CHARS,
  speechTextFromMarkdown,
  splitSpeechPlaybackText,
} from "../speech-playback.js";

describe("speechTextFromMarkdown", () => {
  it("normalizes readable Markdown without speaking decoration, code, or widgets", () => {
    const markdown = [
      "## **Release ready.**",
      "",
      "Use `pnpm test` before reading [the guide](https://example.com).",
      "```ts",
      'console.log("never speak source code");',
      "```",
      "```codeux:actions",
      '{ "items": [{ "label": "Never speak widget data" }] }',
      "```",
      "> Ship it now!",
    ].join("\n");

    expect(speechTextFromMarkdown(markdown)).toBe(
      "Release ready. Use pnpm test before reading the guide. Ship it now!",
    );
  });

  it("returns no spoken text for empty, code-only, and widget-only Markdown", () => {
    expect(speechTextFromMarkdown("  \n\t  ")).toBe("");
    expect(speechTextFromMarkdown("```ts\nconst hidden = true;\n```")).toBe("");
    expect(speechTextFromMarkdown("```codeux:sprint\n{\"hidden\":true}\n```")).toBe("");
  });
});

describe("splitSpeechPlaybackText", () => {
  it("makes the first complete sentence available before grouping the remainder", () => {
    const text = "The plan is ready. The implementation can now proceed. All checks will follow.";

    const chunks = splitSpeechPlaybackText(text);

    expect(chunks[0]).toBe("The plan is ready.");
    expect(chunks).toEqual([
      "The plan is ready.",
      "The implementation can now proceed. All checks will follow.",
    ]);
    expect(chunks.join(" ")).toBe(text);
  });

  it("keeps terminal punctuation and closing quotes or brackets with each sentence", () => {
    const first = "The result is \u201cdone.\u201d";
    const second = "Everything is complete (really!).";
    const third = "Next?";
    const text = `${first} ${second} ${third}`;

    const chunks = splitSpeechPlaybackText(text, second.length);

    expect(chunks).toEqual([first, second, third]);
    expect(chunks.join(" ")).toBe(text);
  });

  it("normalizes repeated whitespace and preserves every word in order", () => {
    const chunks = splitSpeechPlaybackText("  alpha   beta\n\tgamma   delta  ", 11);

    expect(chunks).toEqual(["alpha beta", "gamma delta"]);
    expect(chunks.join(" ")).toBe("alpha beta gamma delta");
  });

  it("fallback-splits long unpunctuated text without exceeding the limit", () => {
    const text = Array.from({ length: 80 }, (_, index) => `word${index}`).join(" ");
    const chunks = splitSpeechPlaybackText(text, 47);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 47)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("fallback-splits one oversized sentence without dropping or duplicating content", () => {
    const text = `${Array.from({ length: 70 }, (_, index) => `detail${index}`).join(" ")}.`;
    const chunks = splitSpeechPlaybackText(text, 53);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 53)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
  });

  it("hard-splits a word longer than the request limit while retaining every character", () => {
    const text = "x".repeat(37);
    const chunks = splitSpeechPlaybackText(text, 10);

    expect(chunks).toEqual(["x".repeat(10), "x".repeat(10), "x".repeat(10), "x".repeat(7)]);
    expect(chunks.join("")).toBe(text);
  });

  it("enforces the backend ceiling and omits empty input", () => {
    const text = Array.from({ length: 2_000 }, () => "word").join(" ");
    const chunks = splitSpeechPlaybackText(text);

    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= MAX_SPEECH_PLAYBACK_CHARS)).toBe(true);
    expect(chunks.join(" ")).toBe(text);
    expect(splitSpeechPlaybackText(" \n\t ")).toEqual([]);
    expect(splitSpeechPlaybackText("text", 0)).toEqual([]);
  });
});
