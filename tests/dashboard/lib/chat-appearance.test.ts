import { describe, it, expect } from "vitest";
import { resolveIdentityAppearance, getWidgetAppearance } from "../../../dashboard/src/v2/lib/chat-appearance.js";

describe("chat-appearance", () => {
  it("resolves user appearance", () => {
    const result = resolveIdentityAppearance({ role: "user" });
    expect(result.label).toBe("User");
    expect(result.bgClass).toContain("bg-white");
  });

  it("resolves jules appearance", () => {
    const result = resolveIdentityAppearance({ role: "assistant", isJules: true });
    expect(result.icon).toBe("jules");
    expect(result.label).toBe("Jules");
  });

  it("resolves virtual appearance", () => {
    const result = resolveIdentityAppearance({ role: "assistant", isVirtual: true, providerId: "gemini" });
    expect(result.bgClass).toContain("bg-purple-500/10");
    expect(result.label).toBe("gemini");
  });

  it("resolves cli appearance", () => {
    const result = resolveIdentityAppearance({ role: "assistant", isCli: true, providerId: "docker-worker" });
    expect(result.icon).toBe("boat");
    expect(result.label).toBe("docker-worker");
  });

  it("returns correct widget parameters", () => {
    const result = getWidgetAppearance("planning");
    expect(result.text).toBe("Thinking...");
    expect(result.colorClass).toBe("text-purple-500");
  });
});
