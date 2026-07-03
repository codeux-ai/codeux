import { describe, expect, it } from "vitest";
import {
  extractJsonContainer,
  parseJsonContainer,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/usage-parse-utils.js";

describe("provider JSON extraction utilities", () => {
  it("extracts a JSON array from noisy bootstrap output", () => {
    const result = extractJsonContainer<unknown[]>(
      "provider-runner: booting runtime\n[{\"response\":{\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}}]\n",
      "array",
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([{ response: { usage: { prompt_tokens: 3, completion_tokens: 2 } } }]);
      expect(result.startIndex).toBeGreaterThan(0);
    }
  });

  it("returns a typed malformed failure for incomplete JSON", () => {
    const result = extractJsonContainer("{\"response\":{\"usage\":", "object");

    expect(result).toMatchObject({
      ok: false,
      error: "malformed",
      startIndex: 0,
    });
  });

  it("returns a typed unexpected_type failure when the container kind is wrong", () => {
    const result = parseJsonContainer("[{\"a\":1}]", "object");

    expect(result).toMatchObject({
      ok: false,
      error: "unexpected_type",
    });
  });
});
