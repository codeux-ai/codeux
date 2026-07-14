export const AGENT_SCENE_TOOL_IDS = [
  "screwdriver",
  "jackhammer",
  "wrench",
  "hammer",
  "torch",
] as const;

export type AgentSceneTool = (typeof AGENT_SCENE_TOOL_IDS)[number];
export type ToolMaterialRole = "metal" | "darkMetal" | "grip" | "accent" | "hot" | "glow";
export type ToolAnimationRef = "spin" | "piston" | "tip" | "glow";
export type ToolMotionKind = "spin" | "piston" | "ratchet" | "tap" | "flicker";
export type ToolVector = readonly [number, number, number];

export type ToolGeometryBlueprint =
  | { readonly type: "box"; readonly size: ToolVector }
  | { readonly type: "cylinder"; readonly radiusTop: number; readonly radiusBottom: number; readonly height: number; readonly segments?: number }
  | { readonly type: "sphere"; readonly radius: number; readonly segments?: number }
  | { readonly type: "torus"; readonly radius: number; readonly tube: number; readonly arc?: number; readonly radialSegments?: number; readonly tubularSegments?: number };

export interface ToolPartBlueprint {
  readonly id: string;
  readonly geometry: ToolGeometryBlueprint;
  readonly material: ToolMaterialRole;
  readonly position?: ToolVector;
  readonly rotation?: ToolVector;
  readonly scale?: ToolVector;
  readonly animationRef?: ToolAnimationRef;
}

export interface ToolBlueprint {
  readonly id: AgentSceneTool;
  readonly label: string;
  readonly anchor: {
    readonly position: ToolVector;
    readonly rotation: ToolVector;
    readonly scale: number;
  };
  readonly palette: {
    readonly metal: number;
    readonly darkMetal: number;
    readonly grip: number;
    readonly accentLightIntensity: number;
  };
  readonly parts: readonly ToolPartBlueprint[];
  readonly animation: {
    readonly kind: ToolMotionKind;
    readonly refs: readonly ToolAnimationRef[];
    readonly entranceDuration: number;
    readonly exitDuration: number;
  };
}

const DEFAULT_PALETTE = {
  metal: 0xd8dee7,
  darkMetal: 0x59636f,
  grip: 0x151a20,
  accentLightIntensity: 0.72,
} as const;

const cylinder = (radiusTop: number, radiusBottom: number, height: number, segments = 20): ToolGeometryBlueprint => ({
  type: "cylinder", radiusTop, radiusBottom, height, segments,
});
const box = (x: number, y: number, z: number): ToolGeometryBlueprint => ({ type: "box", size: [x, y, z] });
const sphere = (radius: number, segments = 16): ToolGeometryBlueprint => ({ type: "sphere", radius, segments });
const torus = (radius: number, tube: number, arc = Math.PI * 2): ToolGeometryBlueprint => ({
  type: "torus", radius, tube, arc, radialSegments: 12, tubularSegments: 32,
});

export const AGENT_SCENE_TOOL_CATALOG: Readonly<Record<AgentSceneTool, ToolBlueprint>> = {
  screwdriver: {
    id: "screwdriver",
    label: "Power screwdriver",
    anchor: { position: [1.08, -0.4, 0.58], rotation: [0.04, -0.14, -0.1], scale: 0.54 },
    palette: DEFAULT_PALETTE,
    animation: { kind: "spin", refs: ["spin"], entranceDuration: 0.34, exitDuration: 0.22 },
    parts: [
      { id: "motor", geometry: cylinder(0.14, 0.16, 0.48, 28), material: "accent", rotation: [0, 0, Math.PI / 2] },
      { id: "motor-cap", geometry: cylinder(0.145, 0.145, 0.055, 28), material: "darkMetal", position: [0.25, 0, 0], rotation: [0, 0, Math.PI / 2] },
      { id: "chuck-ring", geometry: torus(0.115, 0.026), material: "metal", position: [-0.27, 0, 0], rotation: [0, Math.PI / 2, 0] },
      { id: "chuck", geometry: cylinder(0.055, 0.105, 0.16), material: "darkMetal", position: [-0.35, 0, 0], rotation: [0, 0, Math.PI / 2] },
      { id: "bit", geometry: cylinder(0.012, 0.028, 0.29, 8), material: "metal", position: [-0.56, 0, 0], rotation: [0, 0, Math.PI / 2], animationRef: "spin" },
      { id: "handle", geometry: box(0.14, 0.36, 0.16), material: "grip", position: [0.09, -0.25, 0], rotation: [0, 0, -0.16] },
      { id: "battery", geometry: box(0.25, 0.12, 0.2), material: "darkMetal", position: [0.14, -0.46, 0] },
      { id: "trigger", geometry: box(0.055, 0.09, 0.075), material: "hot", position: [-0.015, -0.14, 0] },
    ],
  },
  jackhammer: {
    id: "jackhammer",
    label: "Jackhammer",
    anchor: { position: [1.08, -0.38, 0.55], rotation: [0.04, -0.12, -0.05], scale: 0.52 },
    palette: DEFAULT_PALETTE,
    animation: { kind: "piston", refs: ["piston"], entranceDuration: 0.38, exitDuration: 0.24 },
    parts: [
      { id: "housing", geometry: cylinder(0.14, 0.17, 0.48, 28), material: "accent", position: [0, 0.16, 0] },
      { id: "housing-band", geometry: torus(0.155, 0.026), material: "darkMetal", position: [0, 0.02, 0], rotation: [Math.PI / 2, 0, 0] },
      { id: "handle-bar", geometry: cylinder(0.038, 0.038, 0.64, 16), material: "metal", position: [0, 0.43, 0], rotation: [0, 0, Math.PI / 2] },
      { id: "left-grip", geometry: cylinder(0.058, 0.058, 0.17, 16), material: "grip", position: [-0.34, 0.43, 0], rotation: [0, 0, Math.PI / 2] },
      { id: "right-grip", geometry: cylinder(0.058, 0.058, 0.17, 16), material: "grip", position: [0.34, 0.43, 0], rotation: [0, 0, Math.PI / 2] },
      { id: "shaft", geometry: cylinder(0.055, 0.065, 0.22, 16), material: "darkMetal", position: [0, -0.16, 0] },
      { id: "chisel", geometry: cylinder(0.012, 0.046, 0.38, 12), material: "metal", position: [0, -0.43, 0], animationRef: "piston" },
    ],
  },
  wrench: {
    id: "wrench",
    label: "Open-end wrench",
    anchor: { position: [1.08, -0.4, 0.6], rotation: [0.08, -0.16, -0.12], scale: 0.58 },
    palette: DEFAULT_PALETTE,
    animation: { kind: "ratchet", refs: [], entranceDuration: 0.32, exitDuration: 0.2 },
    parts: [
      { id: "handle", geometry: box(0.62, 0.105, 0.075), material: "metal", position: [0.08, 0, 0] },
      { id: "grip-inset", geometry: box(0.3, 0.045, 0.082), material: "accent", position: [0.14, 0, 0] },
      { id: "jaw", geometry: torus(0.15, 0.06, Math.PI * 1.42), material: "metal", position: [-0.29, 0, 0], rotation: [0, 0, Math.PI * 0.29] },
      { id: "heel", geometry: box(0.14, 0.18, 0.078), material: "darkMetal", position: [-0.2, -0.005, 0], rotation: [0, 0, 0.08] },
      { id: "lanyard", geometry: torus(0.055, 0.018), material: "darkMetal", position: [0.4, 0, 0] },
    ],
  },
  hammer: {
    id: "hammer",
    label: "Claw hammer",
    anchor: { position: [1.08, -0.42, 0.6], rotation: [0.08, -0.14, -0.2], scale: 0.56 },
    palette: DEFAULT_PALETTE,
    animation: { kind: "tap", refs: [], entranceDuration: 0.34, exitDuration: 0.22 },
    parts: [
      { id: "handle", geometry: cylinder(0.048, 0.065, 0.62, 20), material: "grip", position: [0.09, -0.13, 0], rotation: [0, 0, -0.55] },
      { id: "handle-core", geometry: cylinder(0.024, 0.03, 0.56, 16), material: "accent", position: [0.09, -0.13, 0], rotation: [0, 0, -0.55] },
      { id: "head", geometry: box(0.37, 0.14, 0.13), material: "darkMetal", position: [-0.08, 0.2, 0], rotation: [0, 0, -0.55] },
      { id: "face", geometry: cylinder(0.078, 0.068, 0.09, 22), material: "metal", position: [-0.25, 0.31, 0], rotation: [0, Math.PI / 2, 0] },
      { id: "claw", geometry: torus(0.105, 0.03, Math.PI * 1.08), material: "metal", position: [0.1, 0.08, 0], rotation: [0, 0, Math.PI * 0.82] },
      { id: "neck-band", geometry: box(0.09, 0.1, 0.145), material: "accent", position: [0.01, 0.055, 0], rotation: [0, 0, -0.55] },
    ],
  },
  torch: {
    id: "torch",
    label: "Welding torch",
    anchor: { position: [1.08, -0.4, 0.62], rotation: [0.05, -0.18, -0.12], scale: 0.58 },
    palette: { ...DEFAULT_PALETTE, accentLightIntensity: 1.05 },
    animation: { kind: "flicker", refs: ["tip", "glow"], entranceDuration: 0.36, exitDuration: 0.24 },
    parts: [
      { id: "handle", geometry: cylinder(0.068, 0.082, 0.36, 22), material: "grip", rotation: [0, 0, 0.58] },
      { id: "grip-band", geometry: torus(0.071, 0.014), material: "accent", position: [0.055, -0.08, 0], rotation: [Math.PI / 2, 0.58, 0] },
      { id: "collar", geometry: cylinder(0.052, 0.07, 0.12, 20), material: "accent", position: [-0.12, 0.18, 0], rotation: [0, 0, 0.58] },
      { id: "nozzle", geometry: cylinder(0.025, 0.047, 0.25, 18), material: "darkMetal", position: [-0.25, 0.29, 0], rotation: [0, 0, 0.93] },
      { id: "tip", geometry: sphere(0.052, 18), material: "hot", position: [-0.37, 0.36, 0], animationRef: "tip" },
      { id: "glow", geometry: sphere(0.12, 18), material: "glow", position: [-0.37, 0.36, 0], animationRef: "glow" },
    ],
  },
};

export interface ToolMotionPose {
  readonly scale: number;
  readonly yOffset: number;
  readonly rotationZ: number;
  readonly rotationX: number;
  readonly spinRotation: number;
  readonly pistonOffset: number;
  readonly tipIntensity: number;
  readonly glowScale: number;
}

const smoothstep = (value: number): number => {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped * clamped * (3 - 2 * clamped);
};

export function getToolMotionPose(
  tool: AgentSceneTool,
  elapsed: number,
  phase: "entering" | "active" | "exiting" = "active",
  phaseElapsed = elapsed,
): ToolMotionPose {
  const blueprint = AGENT_SCENE_TOOL_CATALOG[tool];
  const entrance = smoothstep(phaseElapsed / blueprint.animation.entranceDuration);
  const exit = smoothstep(phaseElapsed / blueprint.animation.exitDuration);
  const visibility = phase === "entering" ? entrance : phase === "exiting" ? 1 - exit : 1;
  const hover = Math.sin(elapsed * 1.7 + 1.3) * 0.055;
  const base: ToolMotionPose = {
    scale: blueprint.anchor.scale * visibility,
    yOffset: hover + (1 - visibility) * 0.1,
    rotationZ: blueprint.anchor.rotation[2],
    rotationX: blueprint.anchor.rotation[0],
    spinRotation: 0,
    pistonOffset: 0,
    tipIntensity: 2.2,
    glowScale: 1,
  };

  switch (blueprint.animation.kind) {
    case "spin":
      return { ...base, spinRotation: elapsed * 18, rotationZ: base.rotationZ + Math.sin(elapsed * 2.2) * 0.025 };
    case "piston":
      return {
        ...base,
        pistonOffset: -Math.pow(Math.max(0, Math.sin(elapsed * 15)), 3) * 0.065,
        yOffset: base.yOffset + Math.sin(elapsed * 30) * 0.006,
      };
    case "ratchet":
      return { ...base, rotationZ: base.rotationZ + Math.sin(elapsed * 2.5) * 0.23 };
    case "tap":
      return { ...base, rotationZ: base.rotationZ + Math.sin(elapsed * 5.2) * 0.17, rotationX: base.rotationX + Math.sin(elapsed * 2.6) * 0.035 };
    case "flicker": {
      const flicker = Math.sin(elapsed * 17) * 0.34 + Math.sin(elapsed * 31 + 0.7) * 0.18 + Math.sin(elapsed * 7.3) * 0.12;
      return { ...base, tipIntensity: 2.35 + flicker, glowScale: 1 + flicker * 0.12 };
    }
  }
}

export function isAgentSceneTool(value: string | null | undefined): value is AgentSceneTool {
  return AGENT_SCENE_TOOL_IDS.some((tool) => tool === value);
}
