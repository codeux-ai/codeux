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

function buildTestProto(input: number, output: number, reasoning: number, candidates: number): Buffer {
  const f2Buffer = Buffer.concat([
    encodeVarintField(2, input),
    encodeVarintField(3, output),
    encodeVarintField(9, reasoning),
    encodeVarintField(10, candidates),
  ]);
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

  it("parses planner response tool calls and keeps toolCallId ordering", () => {
    const jsonl = [
      JSON.stringify({
        type: "PLANNER_RESPONSE",
        reasoning: "I should list the directory before editing.",
        content: "Let me check the directory.",
        tool_calls: [
          { id: "call-1", name: "list_dir", args: { path: "/workspace" } }
        ],
        created_at: "2026-06-01T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "RUN_COMMAND",
        content: "ls /workspace",
        tool_call_id: "call-1",
        tool_name: "list_dir",
        created_at: "2026-06-01T10:00:01.000Z",
      }),
    ].join("\n");

    const turns = parseAntigravityTranscript(jsonl);
    expect(turns).toHaveLength(4);
    expect(turns[0]).toEqual({
      kind: "reasoning",
      text: "I should list the directory before editing.",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[1]).toEqual({
      kind: "assistant",
      text: "Let me check the directory.",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[2]).toEqual({
      kind: "tool_call",
      text: "Calling tool list_dir",
      toolName: "list_dir",
      toolCallId: "call-1",
      toolArguments: JSON.stringify({ path: "/workspace" }),
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[3]).toEqual({
      kind: "tool_result",
      text: "ls /workspace",
      toolName: "list_dir",
      toolCallId: "call-1",
      timestampMs: Date.parse("2026-06-01T10:00:01.000Z"),
    });
  });

  it("parses RUN_COMMAND, TOOL_RESPONSE, and SYSTEM source turns", () => {
    const jsonl = [
      JSON.stringify({
        type: "RUN_COMMAND",
        content: "npm test output",
        call_id: "call-2",
        name: "run_command",
        created_at: "2026-06-01T10:00:00.000Z",
      }),
      JSON.stringify({
        type: "TOOL_RESPONSE",
        content: "File written successfully",
        toolCallId: "call-3",
        toolName: "write_file",
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
      toolName: "run_command",
      toolCallId: "call-2",
      timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
    });
    expect(turns[1]).toEqual({
      kind: "tool_result",
      text: "File written successfully",
      toolName: "write_file",
      toolCallId: "call-3",
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

  it("correctly parses protobuf token totals from latest gen_metadata row", () => {
    const db = new DatabaseSync(tempDbPath);
    db.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB);");

    const protoData1 = buildTestProto(100, 200, 50, 150);
    const protoData2 = buildTestProto(500, 800, 200, 600); // Latest row (higher idx)

    const insert = db.prepare("INSERT INTO gen_metadata (idx, data) VALUES (?, ?)");
    insert.run(1, protoData1);
    insert.run(2, protoData2);
    db.close();

    const result = parseAntigravityDatabase(tempDbPath);
    expect(result).not.toBeNull();
    expect(result!.usage).toEqual({
      inputTokens: 500,
      outputTokens: 800,
      reasoningTokens: 200,
    });
    expect(result!.rawUsageJson).toEqual({
      inputTokens: 500,
      outputTokens: 800,
      reasoningTokens: 200,
      candidatesTokens: 600,
    });
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
});
