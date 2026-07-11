import { describe, expect, it } from "vitest";
import {
  extractAgentResponseEffect,
  getAgentResponseEffectCaption,
  normalizeAgentResponseEffect,
  resolveAgentResponseEffect,
} from "../../../dashboard/src/v2/lib/agent-response-effects.js";

const validEffect = {
  emotion: "proud",
  animation: "nod",
  caption: "  Shipped safely.  ",
  durationMs: 1800,
};

describe("agent response effects", () => {
  it("normalizes the shared bounded effect shape", () => {
    expect(normalizeAgentResponseEffect(validEffect)).toEqual({
      emotion: "proud",
      animation: "nod",
      caption: "Shipped safely.",
      durationMs: 1800,
    });
    expect(normalizeAgentResponseEffect({ ...validEffect, durationMs: 500 })).toBeDefined();
    expect(normalizeAgentResponseEffect({ ...validEffect, durationMs: 10_000 })).toBeDefined();
  });

  it.each([
    null,
    { ...validEffect, emotion: "provider-string" },
    { ...validEffect, animation: "spin_forever" },
    { ...validEffect, durationMs: 499 },
    { ...validEffect, durationMs: 10_001 },
    { ...validEffect, durationMs: 1000.5 },
    { ...validEffect, caption: "" },
    { ...validEffect, caption: "x".repeat(121) },
  ])("rejects malformed or unbounded values without partial coercion: %j", (value) => {
    expect(normalizeAgentResponseEffect(value)).toBeUndefined();
  });

  it("extracts valid native fences without replacing surrounding markdown", () => {
    const result = extractAgentResponseEffect([
      "Normal reply before.",
      "```codeux:agent",
      JSON.stringify(validEffect),
      "```",
      "Normal reply after.",
    ].join("\n"));

    expect(result.effect).toEqual({
      emotion: "proud",
      animation: "nod",
      caption: "Shipped safely.",
      durationMs: 1800,
    });
    expect(result.markdown).toBe("Normal reply before.\n\nNormal reply after.");
  });

  it("downgrades malformed native fences to readable JSON markdown", () => {
    const result = extractAgentResponseEffect("Reply\n```codeux:agent\n{not json}\n```");
    expect(result.effect).toBeUndefined();
    expect(result.markdown).toBe("Reply\n```json\n{not json}\n```");
  });

  it("prefers valid metadata and provides a semantic caption fallback", () => {
    const fence = "```codeux:agent\n{\"emotion\":\"sad\",\"animation\":\"shake_head\",\"durationMs\":900}\n```";
    const resolved = resolveAgentResponseEffect({ agentEffect: validEffect }, fence);
    expect(resolved?.emotion).toBe("proud");
    expect(getAgentResponseEffectCaption({ emotion: "curious", animation: "wink", durationMs: 900 })).toBe("Feeling curious.");
  });
});

