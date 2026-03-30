import { describe, it, expect } from "vitest";
import { scopeForTier, tierForScope } from "../../../src/contracts/memory-types.js";

describe("memory-types", () => {
  it("scopeForTier", () => {
    expect(scopeForTier("short_term")).toBe("sprint");
    expect(scopeForTier("long_term")).toBe("project");
  });

  it("tierForScope", () => {
    expect(tierForScope("sprint")).toBe("short_term");
    expect(tierForScope("project")).toBe("long_term");
    expect(tierForScope("agent")).toBe("short_term");
  });
});
