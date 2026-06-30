import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readdir = vi.fn();
const stat = vi.fn();
const readFile = vi.fn();

vi.mock("fs/promises", () => ({
  readdir: (...a: unknown[]) => readdir(...a),
  stat: (...a: unknown[]) => stat(...a),
  readFile: (...a: unknown[]) => readFile(...a),
}));

const readQwenOpenAiLogRecords = vi.fn();
const sumQwenOpenAiUsage = vi.fn();
const buildQwenConversation = vi.fn();

vi.mock("../../../../../src/infrastructure/providers/cli/provider-usage.js", () => ({
  readQwenOpenAiLogRecords: (...a: unknown[]) => readQwenOpenAiLogRecords(...a),
  sumQwenOpenAiUsage: (...a: unknown[]) => sumQwenOpenAiUsage(...a),
  buildQwenConversation: (...a: unknown[]) => buildQwenConversation(...a),
}));

import {
  readQwenLogData,
  readCodexLatestSessionJson,
  readClaudeSessionJsonl,
  parseAntigravityConversationId,
  readAntigravityTranscript,
} from "../../../../../src/infrastructure/providers/cli/provider-transcripts.js";

type Mode = "DOCKER" | "HOST";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readQwenLogData", () => {
  it("parses the docker workspace JSON array and returns usage + conversation", async () => {
    const runner = { readWorkspaceJsonArray: vi.fn(async () => JSON.stringify([{ a: 1 }])) };
    sumQwenOpenAiUsage.mockReturnValue({ totalTokens: 5 });
    buildQwenConversation.mockReturnValue([{ role: "user" }]);

    const result = await readQwenLogData("/cwd", "DOCKER" as Mode, "sess", 0, runner as never);

    expect(result).toEqual({ usage: { totalTokens: 5 }, conversation: [{ role: "user" }] });
    expect(sumQwenOpenAiUsage).toHaveBeenCalledWith([{ a: 1 }]);
  });

  it("returns null when the docker read yields nothing", async () => {
    const runner = { readWorkspaceJsonArray: vi.fn(async () => null) };
    expect(await readQwenLogData("/cwd", "DOCKER" as Mode, "sess", 0, runner as never)).toBeNull();
  });

  it("returns null on invalid docker JSON", async () => {
    const runner = { readWorkspaceJsonArray: vi.fn(async () => "{not json") };
    expect(await readQwenLogData("/cwd", "DOCKER" as Mode, "sess", 0, runner as never)).toBeNull();
  });

  it("treats a non-array docker payload as no records", async () => {
    const runner = { readWorkspaceJsonArray: vi.fn(async () => JSON.stringify({ foo: 1 })) };
    expect(await readQwenLogData("/cwd", "DOCKER" as Mode, "sess", 0, runner as never)).toBeNull();
  });

  it("reads host log records when not running in docker", async () => {
    readQwenOpenAiLogRecords.mockResolvedValue([{ b: 2 }]);
    sumQwenOpenAiUsage.mockReturnValue({ totalTokens: 9 });
    buildQwenConversation.mockReturnValue([]);

    const result = await readQwenLogData("/cwd", "HOST" as Mode, "sess", 123, {} as never);
    expect(result?.usage).toEqual({ totalTokens: 9 });
  });

  it("returns null when there are no host records", async () => {
    readQwenOpenAiLogRecords.mockResolvedValue([]);
    expect(await readQwenLogData("/cwd", "HOST" as Mode, "sess", 0, {} as never)).toBeNull();
  });
});

describe("readCodexLatestSessionJson", () => {
  it("reads the latest jsonl through the docker runner", async () => {
    const runner = { readLatestWorkspaceFile: vi.fn(async () => "line\n") };
    const result = await readCodexLatestSessionJson("/cwd", "DOCKER" as Mode, runner as never);
    expect(result).toBe("line\n");
    expect(runner.readLatestWorkspaceFile).toHaveBeenCalledWith("/cwd", expect.stringContaining(".codex/sessions"), "*.jsonl");
  });

  it("returns null when the docker runner finds nothing", async () => {
    const runner = { readLatestWorkspaceFile: vi.fn(async () => null) };
    expect(await readCodexLatestSessionJson("/cwd", "DOCKER" as Mode, runner as never)).toBeNull();
  });

  it("picks the newest host rollout file by mtime", async () => {
    readdir.mockResolvedValue(["rollout-1.jsonl", "rollout-2.jsonl", "ignore.txt"]);
    stat.mockImplementation(async (p: string) => ({ mtimeMs: p.includes("rollout-2") ? 200 : 100 }));
    readFile.mockResolvedValue("newest contents");

    const result = await readCodexLatestSessionJson("/cwd", "HOST" as Mode, {} as never);
    expect(result).toBe("newest contents");
    expect(readFile).toHaveBeenCalledWith(expect.stringContaining("rollout-2.jsonl"), "utf8");
  });

  it("returns null when there are no host jsonl files", async () => {
    readdir.mockResolvedValue(["a.txt"]);
    expect(await readCodexLatestSessionJson("/cwd", "HOST" as Mode, {} as never)).toBeNull();
  });

  it("returns null when the host sessions dir cannot be read", async () => {
    readdir.mockRejectedValue(new Error("ENOENT"));
    expect(await readCodexLatestSessionJson("/cwd", "HOST" as Mode, {} as never)).toBeNull();
  });
});

describe("readClaudeSessionJsonl", () => {
  it("returns null for non-docker execution", async () => {
    expect(await readClaudeSessionJsonl("/cwd", "sid", "HOST" as Mode, {} as never)).toBeNull();
  });

  it("reads the session jsonl path through the docker runner", async () => {
    const runner = { readWorkspaceFile: vi.fn(async () => "transcript") };
    const result = await readClaudeSessionJsonl("/cwd", "native-id", "DOCKER" as Mode, runner as never);
    expect(result).toBe("transcript");
    expect(runner.readWorkspaceFile).toHaveBeenCalledWith("/cwd", expect.stringContaining("native-id.jsonl"));
  });
});

describe("parseAntigravityConversationId", () => {
  it("extracts the conversation id from docker log output", async () => {
    const runner = { readWorkspaceFile: vi.fn(async () => "Created conversation ABC-123-def") };
    const result = await parseAntigravityConversationId("/cwd", "log", "DOCKER" as Mode, runner as never);
    expect(result).toBe("ABC-123-def");
  });

  it("matches the alternate 'switching to conversation' phrasing from host logs", async () => {
    readFile.mockResolvedValue("switching to conversation 99-aa");
    const result = await parseAntigravityConversationId("/cwd", "/log", "HOST" as Mode, {} as never);
    expect(result).toBe("99-aa");
  });

  it("returns null when the log is empty", async () => {
    readFile.mockResolvedValue("   ");
    expect(await parseAntigravityConversationId("/cwd", "/log", "HOST" as Mode, {} as never)).toBeNull();
  });

  it("returns null when no conversation id is present", async () => {
    readFile.mockResolvedValue("nothing relevant here");
    expect(await parseAntigravityConversationId("/cwd", "/log", "HOST" as Mode, {} as never)).toBeNull();
  });
});

describe("readAntigravityTranscript", () => {
  it("returns the first candidate file that exists in docker mode", async () => {
    const runner = { readWorkspaceFile: vi.fn(async () => null).mockResolvedValueOnce(null).mockResolvedValueOnce("overview!") };
    const result = await readAntigravityTranscript("/cwd", "conv-1", "DOCKER" as Mode, runner as never);
    expect(result).toBe("overview!");
  });

  it("returns null when no candidate exists on host", async () => {
    readFile.mockResolvedValue(null);
    expect(await readAntigravityTranscript("/cwd", "conv-1", "HOST" as Mode, {} as never)).toBeNull();
  });

  it("returns the first existing host candidate", async () => {
    readFile.mockResolvedValueOnce("transcript jsonl");
    const result = await readAntigravityTranscript("/cwd", "conv-1", "HOST" as Mode, {} as never);
    expect(result).toBe("transcript jsonl");
  });
});
