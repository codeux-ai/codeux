import { describe, it, expect } from "vitest";
import {
  generateRandomAgentAvatar,
  normalizeAgentAvatarConfig,
  DEFAULT_AGENT_AVATAR_CONFIG,
  AGENT_AVATAR_BODIES,
  AGENT_AVATAR_HAIRS,
  AGENT_AVATAR_FACES,
  AGENT_AVATAR_SHIRTS,
  AGENT_AVATAR_BOTTOMS,
} from "../../../dashboard/src/v2/lib/agent-avatar.js";
import type { AgentAvatarConfig } from "../../../dashboard/src/v2/types.js";

describe("Agent Avatar Helpers", () => {
  describe("generateRandomAgentAvatar", () => {
    it("should generate a deterministic configuration based on a seed", () => {
      const seed1 = "agent-123";
      const config1 = generateRandomAgentAvatar(seed1);
      const config2 = generateRandomAgentAvatar(seed1);

      expect(config1).toEqual(config2); // Should be identical for same seed

      const seed2 = "agent-456";
      const config3 = generateRandomAgentAvatar(seed2);

      // It's technically possible but very unlikely for two different seeds to generate
      // the exact same 5 properties.
      expect(config1).not.toEqual(config3);
    });

    it("should return valid configuration options", () => {
      const seed = "test-seed-123";
      const config = generateRandomAgentAvatar(seed);

      expect(AGENT_AVATAR_BODIES).toContain(config.body);
      expect(AGENT_AVATAR_HAIRS).toContain(config.hair);
      expect(AGENT_AVATAR_FACES).toContain(config.face);
      expect(AGENT_AVATAR_SHIRTS).toContain(config.shirt);
      expect(AGENT_AVATAR_BOTTOMS).toContain(config.bottom);
    });

    it("should return default config if seed is empty", () => {
      const config = generateRandomAgentAvatar("");
      expect(config).toEqual(DEFAULT_AGENT_AVATAR_CONFIG);
    });
  });

  describe("normalizeAgentAvatarConfig", () => {
    it("should fill missing properties with default values", () => {
      const partialConfig: Partial<AgentAvatarConfig> = {
        hair: "style3",
      };

      const normalized = normalizeAgentAvatarConfig(partialConfig);

      expect(normalized.hair).toBe("style3");
      expect(normalized.body).toBe(DEFAULT_AGENT_AVATAR_CONFIG.body);
      expect(normalized.face).toBe(DEFAULT_AGENT_AVATAR_CONFIG.face);
      expect(normalized.shirt).toBe(DEFAULT_AGENT_AVATAR_CONFIG.shirt);
      expect(normalized.bottom).toBe(DEFAULT_AGENT_AVATAR_CONFIG.bottom);
    });

    it("should filter out invalid properties, falling back to defaults", () => {
      const invalidConfig: any = {
        body: "alien",
        hair: "style2",
        shirt: "invisible",
      };

      const normalized = normalizeAgentAvatarConfig(invalidConfig);

      expect(normalized.body).toBe(DEFAULT_AGENT_AVATAR_CONFIG.body); // Fell back to default
      expect(normalized.hair).toBe("style2"); // Valid, kept
      expect(normalized.shirt).toBe(DEFAULT_AGENT_AVATAR_CONFIG.shirt); // Fell back to default
    });

    it("should return full default config if input is null or undefined", () => {
      expect(normalizeAgentAvatarConfig(null)).toEqual(
        DEFAULT_AGENT_AVATAR_CONFIG
      );
      expect(normalizeAgentAvatarConfig(undefined)).toEqual(
        DEFAULT_AGENT_AVATAR_CONFIG
      );
    });

    it("should accept valid full configs", () => {
      const validConfig: AgentAvatarConfig = {
        body: "female",
        hair: "style4",
        face: "style2",
        shirt: "style3",
        bottom: "style2",
      };

      const normalized = normalizeAgentAvatarConfig(validConfig);
      expect(normalized.body).toBe("female");
      expect(normalized.hair).toBe("style4");
      expect(normalized.face).toBe("style2");
      expect(normalized.shirt).toBe("style3");
      expect(normalized.bottom).toBe("style2");
    });
  });
});
