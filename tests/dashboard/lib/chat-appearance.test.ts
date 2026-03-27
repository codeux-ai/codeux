import { describe, it, expect } from "vitest";
import { resolveChatRole, getAvatarStyles } from "../../../dashboard/src/v2/lib/chat-appearance.js";

describe("chat-appearance", () => {
  describe("resolveChatRole", () => {
    it("returns user role correctly", () => {
      expect(resolveChatRole({ roleStr: "user" })).toBe("user");
    });

    it("returns system role correctly", () => {
      expect(resolveChatRole({ roleStr: "system" })).toBe("system");
      expect(resolveChatRole({ isTool: true })).toBe("system");
    });

    it("returns jules role correctly", () => {
      expect(resolveChatRole({ provider: "jules" })).toBe("jules");
      expect(resolveChatRole({ provider: "external" })).toBe("jules");
    });

    it("returns virtual role correctly", () => {
      expect(resolveChatRole({ provider: "container" })).toBe("virtual");
      expect(resolveChatRole({ transport: "stdio" })).toBe("virtual");
    });

    it("returns worker role correctly", () => {
      expect(resolveChatRole({ transport: "mcp" })).toBe("worker");
    });

    it("returns agent role correctly", () => {
      expect(resolveChatRole({ provider: "agent" })).toBe("agent");
    });

    it("defaults to jules when no matching conditions are met", () => {
      expect(resolveChatRole({})).toBe("jules");
    });
  });

  describe("getAvatarStyles", () => {
    it("returns correct styles for jules", () => {
      const styles = getAvatarStyles("jules");
      expect(styles.role).toBe("jules");
      expect(styles.label).toBe("Jules");
      expect(styles.colorClass).toContain("text-signal-500");
    });

    it("returns correct styles for user", () => {
      const styles = getAvatarStyles("user");
      expect(styles.role).toBe("user");
      expect(styles.label).toBe("User");
    });

    it("returns correct styles for virtual", () => {
      const styles = getAvatarStyles("virtual");
      expect(styles.role).toBe("virtual");
      expect(styles.label).toBe("Virtual Worker");
    });

    it("returns correct styles for unknown fallback", () => {
      const styles = getAvatarStyles("unknown");
      expect(styles.role).toBe("unknown");
    });
  });
});
