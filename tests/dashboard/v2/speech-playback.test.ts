import { describe, expect, it } from "vitest";

import {
  speechTextFromMarkdown,
  splitSpeechPlaybackText,
} from "../../../dashboard/src/v2/lib/speech-playback.js";

describe("speechTextFromMarkdown", () => {
  it("removes rich-widget fences while preserving the surrounding visible prose", () => {
    const markdown = [
      "The sprint is ready.",
      "```codeux:sprint",
      '{ "key": "SPR-7", "name": "Checkout", "status": "executing", "done": 2, "total": 5 }',
      "```",
      "I can start it now.",
    ].join("\n");

    expect(speechTextFromMarkdown(markdown)).toBe("The sprint is ready. I can start it now.");
  });

  it("removes widget-only replies without adding an omitted-output placeholder", () => {
    const markdown = [
      "```codeux:actions",
      '{ "items": [{ "label": "Start sprint", "prompt": "Start it now" }] }',
      "```",
    ].join("\n");

    expect(speechTextFromMarkdown(markdown)).toBe("");
  });

  it("removes malformed, unknown, and unclosed codeux instructions from speech", () => {
    expect(speechTextFromMarkdown([
      "Visible answer.",
      "```codeux:custom-widget",
      "This dashboard instruction must never be spoken.",
    ].join("\n"))).toBe("Visible answer.");

    expect(speechTextFromMarkdown("Before.\n```codeux:tasks\nnot json\n```\nAfter.")).toBe("Before. After.");
  });

  it("silently drops ordinary fenced code and keeps readable Markdown text", () => {
    const markdown = [
      "## Result",
      "Use `pnpm test` and read [the guide](https://example.com).",
      "```ts",
      'console.log("do not speak source code");',
      "```",
      "![decorative screenshot](screenshot.png)",
      "> **All checks passed.**",
    ].join("\n");

    const spoken = speechTextFromMarkdown(markdown);
    expect(spoken).toBe("Result Use pnpm test and read the guide. All checks passed.");
    expect(spoken.toLowerCase()).not.toContain("omitted");
  });

  it("supports tilde fences and Windows line endings", () => {
    expect(speechTextFromMarkdown("Before.\r\n~~~json\r\n{\"internal\":true}\r\n~~~\r\nAfter.")).toBe("Before. After.");
  });

  it("splits long speech at readable boundaries within the synthesis limit", () => {
    const chunks = splitSpeechPlaybackText("alpha beta gamma delta", 11);

    expect(chunks).toEqual(["alpha beta", "gamma delta"]);
    expect(chunks.every((chunk) => chunk.length <= 11)).toBe(true);
    expect(chunks.join(" ")).toBe("alpha beta gamma delta");
  });
});
