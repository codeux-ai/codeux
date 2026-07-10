const MAX_SCROLLBACK_LINES = 1000;
const MAX_SCREEN_ROWS = 40;
const MAX_COLUMNS = 240;
const MAX_CONSECUTIVE_BLANK_LINES = 2;

type ParserState =
  | "normal"
  | "escape"
  | "csi"
  | "osc"
  | "osc-escape"
  | "control-string"
  | "control-string-escape"
  | "charset";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function parseCsiParameters(value: string): number[] {
  const numeric = value.replace(/^[?<=>!]*/u, "").replace(/[\x20-\x2f]+$/u, "");
  if (!numeric) {
    return [0];
  }
  return numeric.split(";").map((part) => {
    const parsed = Number.parseInt(part.split(":", 1)[0] || "0", 10);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function normalizeRenderedLines(lines: string[]): string[] {
  const normalized = lines.map((line) => line.replace(/[ \t]+$/u, ""));
  while (normalized.length > 1 && normalized[0] === "") {
    normalized.shift();
  }
  while (normalized.length > 1 && normalized.at(-1) === "") {
    normalized.pop();
  }

  const compacted: string[] = [];
  let blankCount = 0;
  for (const line of normalized) {
    if (line === "") {
      blankCount += 1;
      if (blankCount > MAX_CONSECUTIVE_BLANK_LINES) {
        continue;
      }
    } else {
      blankCount = 0;
    }
    compacted.push(line);
  }
  return compacted;
}

/**
 * Small streaming terminal screen model for provider-login output.
 *
 * Provider CLIs emit cursor movement, screen clearing, OSC window-title/color
 * queries, and occasionally split those sequences across WebSocket chunks.
 * This buffer applies the layout controls needed by login prompts while
 * discarding non-display control strings. It intentionally does not render
 * ANSI color: login text uses the dashboard's single high-contrast terminal
 * color so provider output remains readable and trustworthy.
 */
export class TerminalOutputBuffer {
  private lines: string[] = [""];
  private row = 0;
  private column = 0;
  private screenTop = 0;
  private savedRow = 0;
  private savedColumn = 0;
  private parserState: ParserState = "normal";
  private controlBuffer = "";
  private lastPrintedCharacter = "";

  write(chunk: string): string {
    for (let index = 0; index < chunk.length;) {
      const codePoint = chunk.codePointAt(index);
      if (codePoint === undefined) {
        break;
      }
      const character = String.fromCodePoint(codePoint);
      index += character.length;
      this.consume(character, codePoint);
    }

    this.trimScrollback();
    return this.toString();
  }

  toString(): string {
    return normalizeRenderedLines(this.lines).join("\n");
  }

  private consume(character: string, codePoint: number): void {
    if (this.parserState === "osc") {
      if (character === "\x07" || codePoint === 0x9c) {
        this.parserState = "normal";
      } else if (character === "\x1b") {
        this.parserState = "osc-escape";
      }
      return;
    }
    if (this.parserState === "osc-escape") {
      this.parserState = character === "\\" ? "normal" : "osc";
      return;
    }
    if (this.parserState === "control-string") {
      if (codePoint === 0x9c) {
        this.parserState = "normal";
      } else if (character === "\x1b") {
        this.parserState = "control-string-escape";
      }
      return;
    }
    if (this.parserState === "control-string-escape") {
      this.parserState = character === "\\" ? "normal" : "control-string";
      return;
    }
    if (this.parserState === "charset") {
      this.parserState = "normal";
      return;
    }
    if (this.parserState === "csi") {
      if (codePoint >= 0x40 && codePoint <= 0x7e) {
        this.executeCsi(character, this.controlBuffer);
        this.controlBuffer = "";
        this.parserState = "normal";
      } else if (this.controlBuffer.length < 128) {
        this.controlBuffer += character;
      } else {
        this.controlBuffer = "";
        this.parserState = "normal";
      }
      return;
    }
    if (this.parserState === "escape") {
      this.consumeEscape(character);
      return;
    }

    if (character === "\x1b") {
      this.parserState = "escape";
      return;
    }
    if (codePoint === 0x9b) {
      this.controlBuffer = "";
      this.parserState = "csi";
      return;
    }
    if (codePoint === 0x9d) {
      this.parserState = "osc";
      return;
    }
    if (codePoint === 0x90 || codePoint === 0x98 || codePoint === 0x9e || codePoint === 0x9f) {
      this.parserState = "control-string";
      return;
    }

    if (character === "\n") {
      this.nextLine();
    } else if (character === "\r") {
      this.column = 0;
    } else if (character === "\x08" || character === "\x7f") {
      this.column = Math.max(0, this.column - 1);
    } else if (character === "\t") {
      const nextTabStop = Math.min(MAX_COLUMNS, Math.ceil((this.column + 1) / 8) * 8);
      this.writeSpaces(nextTabStop - this.column);
    } else if (codePoint >= 0x20 && !(codePoint >= 0x7f && codePoint <= 0x9f)) {
      this.writeCharacter(character);
    }
  }

  private consumeEscape(character: string): void {
    if (character === "[") {
      this.controlBuffer = "";
      this.parserState = "csi";
      return;
    }
    if (character === "]") {
      this.parserState = "osc";
      return;
    }
    if (character === "P" || character === "^" || character === "_") {
      this.parserState = "control-string";
      return;
    }
    if (character === "(" || character === ")" || character === "*" || character === "+") {
      this.parserState = "charset";
      return;
    }
    if (character === "7") {
      this.saveCursor();
    } else if (character === "8") {
      this.restoreCursor();
    } else if (character === "D") {
      this.nextLine(false);
    } else if (character === "E") {
      this.nextLine();
    } else if (character === "M") {
      this.row = Math.max(this.screenTop, this.row - 1);
    } else if (character === "c") {
      this.resetScreen();
    }
    this.parserState = "normal";
  }

  private executeCsi(action: string, rawParameters: string): void {
    const parameters = parseCsiParameters(rawParameters);
    const count = clamp(parameters[0] || 1, 1, MAX_SCREEN_ROWS);

    if (action === "A") {
      this.row = Math.max(this.screenTop, this.row - count);
    } else if (action === "B") {
      this.setRow(this.row + count);
    } else if (action === "C" || action === "a") {
      this.column = clamp(this.column + count, 0, MAX_COLUMNS);
    } else if (action === "D") {
      this.column = Math.max(0, this.column - count);
    } else if (action === "E") {
      this.setRow(this.row + count);
      this.column = 0;
    } else if (action === "F") {
      this.row = Math.max(this.screenTop, this.row - count);
      this.column = 0;
    } else if (action === "G" || action === "`") {
      this.column = clamp((parameters[0] || 1) - 1, 0, MAX_COLUMNS);
    } else if (action === "H" || action === "f") {
      this.setAbsoluteCursor(parameters[0], parameters[1]);
    } else if (action === "d") {
      this.setAbsoluteCursor(parameters[0], this.column + 1);
    } else if (action === "J") {
      this.eraseDisplay(parameters[0] || 0);
    } else if (action === "K") {
      this.eraseLine(parameters[0] || 0);
    } else if (action === "P") {
      const line = this.currentLine();
      this.lines[this.row] = line.slice(0, this.column) + line.slice(this.column + count);
    } else if (action === "@") {
      const line = this.currentLine();
      this.lines[this.row] = line.slice(0, this.column) + " ".repeat(count) + line.slice(this.column);
    } else if (action === "X") {
      const line = this.currentLine();
      this.lines[this.row] = line.slice(0, this.column) + " ".repeat(count) + line.slice(this.column + count);
    } else if (action === "L") {
      this.lines.splice(this.row, 0, ...Array.from({ length: count }, () => ""));
    } else if (action === "M") {
      this.lines.splice(this.row, count);
      this.ensureLine(this.row);
    } else if (action === "S") {
      for (let index = 0; index < count; index += 1) this.nextLine();
    } else if (action === "s") {
      this.saveCursor();
    } else if (action === "u") {
      this.restoreCursor();
    } else if (action === "b" && this.lastPrintedCharacter) {
      for (let index = 0; index < count; index += 1) this.writeCharacter(this.lastPrintedCharacter);
    }
    // SGR, cursor visibility, terminal queries, mode switches, and window-title
    // operations deliberately have no textual representation.
  }

  private setAbsoluteCursor(rawRow = 1, rawColumn = 1): void {
    const screenRow = clamp((rawRow || 1) - 1, 0, MAX_SCREEN_ROWS - 1);
    this.setRow(this.screenTop + screenRow);
    // Leave a small writable tail when a malformed CLI sequence requests a
    // column far beyond the declared terminal width. This keeps the following
    // prompt intact instead of repeatedly overwriting the rightmost cell.
    this.column = clamp((rawColumn || 1) - 1, 0, MAX_COLUMNS - 32);
  }

  private setRow(nextRow: number): void {
    this.row = clamp(nextRow, this.screenTop, this.screenTop + MAX_SCREEN_ROWS - 1);
    this.ensureLine(this.row);
  }

  private nextLine(resetColumn = true): void {
    if (this.row >= this.screenTop + MAX_SCREEN_ROWS - 1) {
      this.lines.push("");
      this.screenTop += 1;
      this.row = this.screenTop + MAX_SCREEN_ROWS - 1;
    } else {
      this.row += 1;
      this.ensureLine(this.row);
    }
    if (resetColumn) {
      this.column = 0;
    }
  }

  private writeCharacter(character: string): void {
    const line = this.currentLine();
    const padded = this.column > line.length ? line + " ".repeat(this.column - line.length) : line;
    this.lines[this.row] = padded.slice(0, this.column) + character + padded.slice(this.column + 1);
    this.column = Math.min(MAX_COLUMNS, this.column + 1);
    this.lastPrintedCharacter = character;
  }

  private writeSpaces(count: number): void {
    for (let index = 0; index < count; index += 1) {
      this.writeCharacter(" ");
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      this.resetScreen();
      return;
    }
    if (mode === 0) {
      this.lines[this.row] = this.currentLine().slice(0, this.column);
      for (let row = this.row + 1; row < Math.min(this.lines.length, this.screenTop + MAX_SCREEN_ROWS); row += 1) {
        this.lines[row] = "";
      }
    } else if (mode === 1) {
      this.lines[this.row] = " ".repeat(this.column) + this.currentLine().slice(this.column);
      for (let row = this.screenTop; row < this.row; row += 1) {
        this.lines[row] = "";
      }
    }
  }

  private eraseLine(mode: number): void {
    const line = this.currentLine();
    if (mode === 0) {
      this.lines[this.row] = line.slice(0, this.column);
    } else if (mode === 1) {
      this.lines[this.row] = " ".repeat(this.column) + line.slice(this.column);
    } else if (mode === 2) {
      this.lines[this.row] = "";
    }
  }

  private saveCursor(): void {
    this.savedRow = this.row;
    this.savedColumn = this.column;
  }

  private restoreCursor(): void {
    this.setRow(this.savedRow);
    this.column = clamp(this.savedColumn, 0, MAX_COLUMNS);
  }

  private resetScreen(): void {
    this.lines = [""];
    this.row = 0;
    this.column = 0;
    this.screenTop = 0;
  }

  private currentLine(): string {
    this.ensureLine(this.row);
    return this.lines[this.row] || "";
  }

  private ensureLine(row: number): void {
    while (row >= this.lines.length) {
      this.lines.push("");
    }
  }

  private trimScrollback(): void {
    if (this.lines.length <= MAX_SCROLLBACK_LINES) {
      return;
    }
    const removed = this.lines.length - MAX_SCROLLBACK_LINES;
    this.lines = this.lines.slice(removed);
    this.row = Math.max(0, this.row - removed);
    this.savedRow = Math.max(0, this.savedRow - removed);
    this.screenTop = Math.max(0, this.screenTop - removed);
  }
}
