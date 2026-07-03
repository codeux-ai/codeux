import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  extractQwenUsageRecord,
  readQwenOpenAiLogRecords,
  sumQwenOpenAiUsage,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/qwen-log-parser.js";

describe("qwen-code OpenAI log parser", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns null when a record has no usage fields", () => {
    expect(extractQwenUsageRecord({ response: { choices: [] } })).toBeNull();
    expect(sumQwenOpenAiUsage([{ response: { choices: [] } }])).toBeNull();
  });

  it("reads valid provider payloads from noisy log files and skips malformed files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-log-parser-"));
    tempDirs.push(dir);
    const now = Date.now();

    await fs.writeFile(
      path.join(dir, "valid.json"),
      `provider bootstrap output\n${JSON.stringify({
        timestamp: "2026-07-03T00:00:00.000Z",
        response: {
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 3 },
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        },
      })}\n`,
    );
    await fs.writeFile(path.join(dir, "malformed.json"), "provider bootstrap output\n{\"response\":{\"usage\":");
    await fs.utimes(path.join(dir, "valid.json"), now / 1000, now / 1000);
    await fs.utimes(path.join(dir, "malformed.json"), now / 1000, now / 1000);

    const records = await readQwenOpenAiLogRecords(dir, now - 1000);
    const usage = sumQwenOpenAiUsage(records);

    expect(records).toHaveLength(1);
    expect(usage).toEqual({
      inputTokens: 8,
      cachedInputTokens: 3,
      outputTokens: 7,
      reasoningOutputTokens: 2,
    });
  });
});
