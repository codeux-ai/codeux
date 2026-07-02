import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  parseAntigravityTranscript,
  parseAntigravityDatabase,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/antigravity-log-parser.js";

// Protobuf encoders for testing
function encodeVarint(value: number): Buffer {
  const bytes = [];
  let temp = value;
  while (temp >= 0x80) {
    bytes.push((temp & 0x7f) | 0x80);
    temp = temp >> 7;
  }
  bytes.push(temp & 0x7f);
  return Buffer.from(bytes);
}

function encodeLengthDelimited(fieldNumber: number, data: Buffer): Buffer {
  const key = (fieldNumber << 3) | 2;
  return Buffer.concat([encodeVarint(key), encodeVarint(data.length), data]);
}

function encodeVarintField(fieldNumber: number, value: number): Buffer {
  const key = (fieldNumber << 3) | 0;
  return Buffer.concat([encodeVarint(key), encodeVarint(value)]);
}

function buildTestProto(input: number, output: number, reasoning: number, candidates: number, cached = 0): Buffer {
  const fields = [
    encodeVarintField(2, input),
    encodeVarintField(3, output),
  ];
  if (cached > 0) {
    fields.push(encodeVarintField(5, cached));
  }
  fields.push(encodeVarintField(9, reasoning), encodeVarintField(10, candidates));
  const f2Buffer = Buffer.concat(fields);
  const f2Message = encodeLengthDelimited(2, f2Buffer);
  const f17Buffer = encodeLengthDelimited(17, f2Message);
  return encodeLengthDelimited(1, f17Buffer);
}

describe("Antigravity Log Parser - parseAntigravityTranscript", () => {
  it("handles empty or whitespace-only input", () => {
    expect(parseAntigravityTranscript("")).toEqual([]);
    expect(parseAntigravityTranscript("   \n   ")).toEqual([]);
  });

  it("parses user input and strips USER_REQUEST XML tags", () => {
    const jsonl = [
      JSON.stringify({
        type: "USER_INPUT",
        content: "<USER_REQUEST>Write a hello world program</USER_REQUEST>",
        created_at: "2026-06-01T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "USER_INPUT",
        content: "Plain user prompt",
        created_at: "2026-06-01T10:01:00.000Z",
      })
    ].join("\n");

    const turns = parseAntigravityTranscript(jsonl);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      kind: "user",
      text: "Write a hello world program",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[1]).toEqual({
      kind: "user",
      text: "Plain user prompt",
      timestampMs: Date.parse("2026-06-01T10:01:00.000Z"),
    });
  });

  it("parses planner response and tool calls", () => {
    const jsonl = JSON.stringify({
      type: "PLANNER_RESPONSE",
      content: "Let me check the directory.",
      tool_calls: [
        { name: "list_dir", args: { path: "/workspace" } }
      ],
      created_at: "2026-06-01T10:00:00.000Z",
    });

    const turns = parseAntigravityTranscript(jsonl);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      kind: "assistant",
      text: "Let me check the directory.",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[1]).toEqual({
      kind: "tool_call",
      text: "Calling tool list_dir",
      toolName: "list_dir",
      toolArguments: JSON.stringify({ path: "/workspace" }),
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
  });

  it("parses RUN_COMMAND, TOOL_RESPONSE, and SYSTEM source turns", () => {
    const jsonl = [
      JSON.stringify({
        type: "RUN_COMMAND",
        content: "npm test output",
        created_at: "2026-06-01T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "TOOL_RESPONSE",
        content: "File written successfully",
        created_at: "2026-06-01T10:00:01.000Z",
      }),
      JSON.stringify({
        source: "SYSTEM",
        content: "Starting next iteration",
        created_at: "2026-06-01T10:00:02.000Z",
      }),
    ].join("\n");

    const turns = parseAntigravityTranscript(jsonl);
    expect(turns).toHaveLength(3);
    expect(turns[0]).toEqual({
      kind: "tool_result",
      text: "npm test output",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[1]).toEqual({
      kind: "tool_result",
      text: "File written successfully",
      timestampMs: Date.parse("2026-06-01T10:00:01.000Z"),
    });
    expect(turns[2]).toEqual({
      kind: "reasoning",
      text: "Starting next iteration",
      timestampMs: Date.parse("2026-06-01T10:00:02.000Z"),
    });
  });

  it("filters turns based on sinceMs lower bound (with 2000ms grace)", () => {
    const jsonl = [
      JSON.stringify({
        type: "USER_INPUT",
        content: "Old message",
        created_at: "2026-06-01T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "USER_INPUT",
        content: "Grace window message",
        created_at: "2026-06-01T10:00:09.000Z",
      }),
      JSON.stringify({
        type: "USER_INPUT",
        content: "New message",
        created_at: "2026-06-01T10:00:10.000Z",
      }),
    ].join("\n");

    const sinceMs = Date.parse("2026-06-01T10:00:10.000Z");
    const turns = parseAntigravityTranscript(jsonl, sinceMs);

    expect(turns).toHaveLength(2);
    expect(turns[0].text).toBe("Grace window message");
    expect(turns[1].text).toBe("New message");
  });
});

describe("Antigravity Log Parser - parseAntigravityDatabase", () => {
  let tempDbPath: string;

  beforeEach(async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "agy-db-test-"));
    tempDbPath = path.join(tempDir, "test.db");
  });

  afterEach(async () => {
    await fs.rm(path.dirname(tempDbPath), { recursive: true, force: true }).catch(() => {});
  });

  it("returns null for non-existent database file", () => {
    const result = parseAntigravityDatabase("/non-existent-path/file.db");
    expect(result).toBeNull();
  });

  it("returns null for database missing gen_metadata table", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE other_table (id INTEGER);");
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result).toBeNull();
  });

  it("returns null for database with empty gen_metadata table", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result).toBeNull();
  });

  it("sums token totals across every gen_metadata row, not just the latest", () => {
    // Each row is a separate model call within the same conversation (an
    // agentic multi-turn run), not a running cumulative total — confirmed
    // against live antigravity conversation databases, where consecutive
    // rows' input tokens fluctuate rather than grow. Taking only the latest
    // row (the old behavior) undercounted a run's real usage by up to the
    // number of generations in the run.
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");

    const protoData1 = buildTestProto(100, 200, 50, 150);
    const protoData2 = buildTestProto(500, 800, 200, 600);

    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(1, protoData1);
    insert.run(2, protoData2);
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result).not.toBeNull();
    expect(result!.usage).toEqual({
      inputTokens: 600,
      outputTokens: 1000,
      reasoningTokens: 250,
      cachedInputTokens: 0,
    });
    expect(result!.lastIdx).toBe(2);
  });

  it("falls back to reasoning + candidates for outputTokens if output field is 0/missing", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");

    const protoData = buildTestProto(300, 0, 100, 250);

    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(1, protoData);
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result).not.toBeNull();
    expect(result!.usage!.outputTokens).toBe(350); // 100 reasoning + 250 candidates
  });

  it("sums cached tokens (field 5) across rows, treating its absence as zero", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");

    // First turn: no cache hit yet (field 5 omitted). Second turn: the first
    // turn's context is now served from cache.
    const protoData1 = buildTestProto(21647, 171, 60, 111, 0);
    const protoData2 = buildTestProto(1516, 115, 53, 62, 20368);

    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(1, protoData1);
    insert.run(2, protoData2);
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result!.usage!.cachedInputTokens).toBe(20368);
    expect(result!.usage!.inputTokens).toBe(21647 + 1516);
  });

  it("only sums rows past sinceIdx, isolating a follow-up run's own generations", () => {
    // The conversation db accumulates rows across `agy --conversation=<id>`
    // resumes, just like Codex's rollout file. A follow-up run must not
    // re-sum the generations an earlier invocation already reported.
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");

    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(0, buildTestProto(1000, 100, 0, 20)); // prior invocation
    insert.run(1, buildTestProto(2000, 200, 0, 30)); // prior invocation
    insert.run(2, buildTestProto(300, 40, 0, 5)); // this follow-up's own generation
    db.close();

    const result = parseAntigravityDatabase(tempDbPath, 1);
    expect(result).not.toBeNull();
    expect(result!.usage).toEqual({
      inputTokens: 300,
      outputTokens: 40,
      reasoningTokens: 0,
      cachedInputTokens: 0,
    });
    expect(result!.lastIdx).toBe(2);
  });

  it("returns null when a follow-up run added no new rows past sinceIdx", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");
    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(0, buildTestProto(1000, 100, 0, 20));
    db.close();

    const result = parseAntigravityDatabase(tempDbPath, 0);
    expect(result).toBeNull();
  });
});
