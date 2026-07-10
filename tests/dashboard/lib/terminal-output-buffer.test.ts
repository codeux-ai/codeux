import { describe, expect, it } from "vitest";
import { TerminalOutputBuffer } from "../../../dashboard/src/v2/lib/terminal-output-buffer.js";

describe("TerminalOutputBuffer", () => {
  it("removes Qwen OSC title and color queries even when sequences span chunks", () => {
    const buffer = new TerminalOutputBuffer();

    buffer.write("\x1b]11;");
    buffer.write("?\x07\x1b]0;Qw");
    buffer.write("en\x1b\\\x1b]2;Qwen\x07");
    const output = buffer.write(
      "\x1b[?25l\x1b[2J\x1b[H\x1b[38;5;51m╭──────────────╮\r\n"
      + "│ Qwen sign in │\r\n"
      + "╰──────────────╯\x1b[0m",
    );

    expect(output).toBe("╭──────────────╮\n│ Qwen sign in │\n╰──────────────╯");
    expect(output).not.toMatch(/\]11;\?|\]0;Qwen|\]2;Qwen|\x1b/u);
  });

  it("applies cursor redraws without duplicating or breaking box output", () => {
    const buffer = new TerminalOutputBuffer();

    buffer.write("\x1b[2J\x1b[H╭──────────╮\r\n│ Loading  │\r\n╰──────────╯");
    const output = buffer.write("\x1b[2;3HReady\x1b[K");

    expect(output).toBe("╭──────────╮\n│ Ready\n╰──────────╯");
    expect(output.match(/╭/gu)).toHaveLength(1);
    expect(output).not.toContain("Loading");
  });

  it("bounds hostile cursor positions and compacts excessive blank terminal rows", () => {
    const buffer = new TerminalOutputBuffer();

    const output = buffer.write("Prompt\x1b[999;999HContinue");

    expect(output).toContain("Prompt");
    expect(output).toContain("Continue");
    expect(output.split("\n").length).toBeLessThanOrEqual(4);
    expect(output.length).toBeLessThan(400);
  });

  it("keeps meaningful provider prompts and URLs while dropping non-display strings", () => {
    const buffer = new TerminalOutputBuffer();

    const output = buffer.write(
      "\x1b[1mCodex login\x1b[0m\r\n"
      + "Open https://example.test/device and enter ABCD."
      + "\x1bPprivate-device-control\x1b\\",
    );

    expect(output).toBe("Codex login\nOpen https://example.test/device and enter ABCD.");
    expect(output).not.toContain("private-device-control");
  });

  it("overwrites carriage-return progress instead of appending stale frames", () => {
    const buffer = new TerminalOutputBuffer();

    buffer.write("Preparing provider 1%");
    const output = buffer.write("\rPreparing provider 100%\x1b[K");

    expect(output).toBe("Preparing provider 100%");
    expect(output).not.toContain("1%Preparing");
  });
});
