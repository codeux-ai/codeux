import { describe, expect, it } from "vitest";
import {
  AGENT_SCENE_TOOL_CATALOG,
  AGENT_SCENE_TOOL_IDS,
  getToolMotionPose,
  isAgentSceneTool,
} from "../../../dashboard/src/v2/lib/agent-scene-tools.js";

describe("agent scene tool catalog", () => {
  it("preserves every public tool identifier with an intentional blueprint", () => {
    expect(AGENT_SCENE_TOOL_IDS).toEqual(["screwdriver", "jackhammer", "wrench", "hammer", "torch"]);

    for (const id of AGENT_SCENE_TOOL_IDS) {
      const blueprint = AGENT_SCENE_TOOL_CATALOG[id];
      expect(blueprint.id).toBe(id);
      expect(blueprint.label.length).toBeGreaterThan(4);
      expect(blueprint.parts.length).toBeGreaterThanOrEqual(5);
      expect(blueprint.anchor.scale).toBeGreaterThan(0);
      expect(blueprint.palette.accentLightIntensity).toBeGreaterThan(0);
      expect(new Set(blueprint.parts.map((part) => part.id)).size).toBe(blueprint.parts.length);
      expect(blueprint.animation.entranceDuration).toBeGreaterThan(0);
      expect(blueprint.animation.exitDuration).toBeGreaterThan(0);
    }
  });

  it("keeps animation references backed by catalog parts", () => {
    for (const id of AGENT_SCENE_TOOL_IDS) {
      const blueprint = AGENT_SCENE_TOOL_CATALOG[id];
      const partRefs = blueprint.parts.flatMap((part) => part.animationRef ? [part.animationRef] : []);
      expect(partRefs).toEqual(expect.arrayContaining([...blueprint.animation.refs]));
    }
  });

  it("validates forced stage-tool values without accepting arbitrary input", () => {
    expect(isAgentSceneTool("wrench")).toBe(true);
    expect(isAgentSceneTool("torch")).toBe(true);
    expect(isAgentSceneTool("laser")).toBe(false);
    expect(isAgentSceneTool(null)).toBe(false);
  });
});

describe("agent scene tool animation contract", () => {
  it("uses deterministic elapsed-time poses", () => {
    for (const id of AGENT_SCENE_TOOL_IDS) {
      expect(getToolMotionPose(id, 1.375)).toEqual(getToolMotionPose(id, 1.375));
    }
    expect(getToolMotionPose("torch", 1.375).tipIntensity).not.toBe(getToolMotionPose("torch", 1.475).tipIntensity);
  });

  it("provides smooth static endpoints for entrance and exit", () => {
    for (const id of AGENT_SCENE_TOOL_IDS) {
      const blueprint = AGENT_SCENE_TOOL_CATALOG[id];
      expect(getToolMotionPose(id, 0, "entering", 0).scale).toBe(0);
      expect(getToolMotionPose(id, 1, "entering", blueprint.animation.entranceDuration).scale)
        .toBeCloseTo(blueprint.anchor.scale);
      expect(getToolMotionPose(id, 2, "exiting", blueprint.animation.exitDuration).scale).toBe(0);
    }
  });

  it("gives each tool a distinct active motion signature", () => {
    const at = 0.73;
    expect(getToolMotionPose("screwdriver", at).spinRotation).not.toBe(0);
    expect(getToolMotionPose("jackhammer", at).pistonOffset).not.toBe(0);
    expect(getToolMotionPose("wrench", at).rotationZ).not.toBe(AGENT_SCENE_TOOL_CATALOG.wrench.anchor.rotation[2]);
    expect(getToolMotionPose("hammer", at).rotationX).not.toBe(AGENT_SCENE_TOOL_CATALOG.hammer.anchor.rotation[0]);
    expect(getToolMotionPose("torch", at).glowScale).not.toBe(1);
  });
});
