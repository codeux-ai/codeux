import { describe, expect, it } from "vitest";
import {
  AGENT_HUMOR_CATEGORIES,
  AGENT_HUMOR_MESSAGES,
  STATUS_MESSAGE_MIN_INTERVAL_MS,
  classifyToolHumorCategory,
  getAgentHumorCycle,
  selectAgentHumorMessage,
} from "../../../dashboard/src/v2/lib/agent-humor-messages.js";
import type { AgentHumorCategory } from "../../../dashboard/src/v2/lib/agent-humor-messages.js";

const allMessages = (): string[] => (
  AGENT_HUMOR_CATEGORIES.flatMap((category) => [...AGENT_HUMOR_MESSAGES[category]])
);

describe("agent humor messages", () => {
  it("defines every reusable category with a distributed catalog", () => {
    expect(AGENT_HUMOR_CATEGORIES).toEqual([
      "starting",
      "working",
      "thinking",
      "tool_exec",
      "tool_edit",
      "tool_read",
      "tool_search",
      "tool_web",
      "tool_generic",
      "battery",
      "mood",
    ]);

    for (const category of AGENT_HUMOR_CATEGORIES) {
      expect(AGENT_HUMOR_MESSAGES[category].length, category).toBeGreaterThanOrEqual(20);
    }
  });

  it("contains at least 400 unique workplace-safe strings", () => {
    const messages = allMessages();
    const uniqueMessages = new Set(messages);
    const unsafePattern = /\b(?:asshole|bastard|crap|damn|dumb|hell|idiot|moron|stupid|sucks)\b/i;

    expect(messages.length).toBeGreaterThanOrEqual(400);
    expect(uniqueMessages.size).toBe(messages.length);
    expect(messages.every((message) => message.trim() === message && message.length > 20)).toBe(true);
    expect(messages.filter((message) => unsafePattern.test(message))).toEqual([]);
  });

  it("keeps selections stable for every timestamp inside one five-second cycle", () => {
    const category: AgentHumorCategory = "thinking";
    const seed = "thread-1:message-1";
    const cycleStartMs = 35_000;
    const expected = selectAgentHumorMessage({ category, seed, nowMs: cycleStartMs });

    for (let offsetMs = 0; offsetMs < STATUS_MESSAGE_MIN_INTERVAL_MS; offsetMs += 1) {
      expect(selectAgentHumorMessage({ category, seed, nowMs: cycleStartMs + offsetMs })).toBe(expected);
    }
  });

  it("changes the cycle bucket at five-second boundaries", () => {
    expect(getAgentHumorCycle(9_999)).toEqual({
      index: 1,
      startsAtMs: 5_000,
      endsAtMs: 10_000,
      durationMs: STATUS_MESSAGE_MIN_INTERVAL_MS,
    });
    expect(getAgentHumorCycle(10_000)).toEqual({
      index: 2,
      startsAtMs: 10_000,
      endsAtMs: 15_000,
      durationMs: STATUS_MESSAGE_MIN_INTERVAL_MS,
    });

    const seedWithCycleChange = Array.from({ length: 100 }, (_, index) => `seed-${index}`)
      .find((seed) => (
        selectAgentHumorMessage({ category: "working", seed, nowMs: 0 })
          !== selectAgentHumorMessage({ category: "working", seed, nowMs: STATUS_MESSAGE_MIN_INTERVAL_MS })
      ));

    expect(seedWithCycleChange).toBeDefined();
  });

  it("falls back to generic tool humor for unknown runtime categories", () => {
    const options = { seed: "same-event", nowMs: 12_345 };

    expect(selectAgentHumorMessage({ category: "not-a-category", ...options })).toBe(
      selectAgentHumorMessage({ category: "tool_generic", ...options }),
    );
  });

  it("classifies tool names into humor categories", () => {
    expect(classifyToolHumorCategory("exec_command")).toBe("tool_exec");
    expect(classifyToolHumorCategory("bash")).toBe("tool_exec");
    expect(classifyToolHumorCategory("apply_patch")).toBe("tool_edit");
    expect(classifyToolHumorCategory("read_file")).toBe("tool_read");
    expect(classifyToolHumorCategory("rg_search")).toBe("tool_search");
    expect(classifyToolHumorCategory("web.run")).toBe("tool_web");
    expect(classifyToolHumorCategory("web_search")).toBe("tool_web");
    expect(classifyToolHumorCategory("")).toBe("tool_generic");
    expect(classifyToolHumorCategory(null)).toBe("tool_generic");
    expect(classifyToolHumorCategory("surprise_helper")).toBe("tool_generic");
  });
});
