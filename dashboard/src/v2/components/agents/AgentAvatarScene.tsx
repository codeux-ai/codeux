/**
 * AgentAvatarScene — High-fidelity 3D translation of the Code UX brand mark.
 *
 * Built as a stack of extruded layers that mirror the logo SVG one-to-one:
 *
 *    ┌─────────────────────────────────┐
 *    │  Black rounded TILE             │  ← chassis card
 *    │   ┌─────────────────────┐       │
 *    │ • │   White FACE SHELL  │ •     │  ← face + side ear bumps
 *    │   │  ┌────────────────┐ │       │
 *    │   │  │   DARK INSET   │ │       │  ← the "screen"
 *    │   │  │   ◉ jewel      │ │       │  ← forehead jewel
 *    │   │  │   ⌣  ⌣  eyes   │ │       │  ← jade smile arcs
 *    │   │  └────────────────┘ │       │
 *    │   └─────────────────────┘       │
 *    └─────────────────────────────────┘
 *           │   ANTENNA PILL + tilt lines (above the tile, jade emissive)
 *
 * The scene is rendered with brand-tinted env reflections, a 5-point light
 * rig, and a jade rim from below so the silhouette pops against any
 * background. Choreography: idle breath, periodic blink (smile arcs
 * compress + reopen), jewel pulse, antenna sway, expression head poses.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";
import type { AgentAvatarConfig } from "../../types.js";
import {
  DEFAULT_AGENT_AVATAR_CONFIG,
  getAccentHex,
  getInsetHex,
  getShellHex,
  isLightBase,
  BRAND_COLORS,
  type AgentAvatarExpression,
} from "../../lib/agent-avatar.js";
import { AgentAvatarSvg } from "./AgentAvatarSvg.js";

interface AgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  fallbackMode?: boolean;
}

/* ── Hex string → THREE.Color int ── */
function hexInt(hex: string, fallback = 0x000000): number {
  const m = hex.match(/^#?([\da-f]{6})$/i);
  return m ? parseInt(m[1], 16) : fallback;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Shape builders — extruded 2D shapes that recreate each logo layer.
 *
 *  Working units: the avatar canvas is roughly 2.6 × 2.6 around the origin.
 * ════════════════════════════════════════════════════════════════════════ */

/** Rounded-rectangle Shape centered at the origin. */
function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const r = Math.min(radius, w, h);
  const s = new THREE.Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  return s;
}

/** Smile-arc Shape — a thick crescent/comma like the logo's eyes.
 *  Drawn as a horizontal "U" with bezier curves, centered at origin. */
function smileArcShape(width: number, height: number, thickness: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const t = thickness;
  const s = new THREE.Shape();
  // Outer arc (top-left → bottom → top-right)
  s.moveTo(-w, -h * 0.2);
  s.bezierCurveTo(-w, h, -w * 0.4, h, 0, h);
  s.bezierCurveTo(w * 0.4, h, w, h, w, -h * 0.2);
  // Inner edge — return back along the inside of the crescent
  s.lineTo(w - t, -h * 0.2);
  s.bezierCurveTo(w - t, h - t, w * 0.4, h - t, 0, h - t);
  s.bezierCurveTo(-w * 0.4, h - t, -w + t, h - t, -w + t, -h * 0.2);
  s.lineTo(-w, -h * 0.2);
  return s;
}

/** Vertical capsule/pill Shape — used for the antenna stem. */
function capsuleShape(width: number, height: number): THREE.Shape {
  const w = width / 2;
  const h = height / 2;
  const s = new THREE.Shape();
  s.moveTo(-w, -h + w);
  s.bezierCurveTo(-w, -h, w, -h, w, -h + w);
  s.lineTo(w, h - w);
  s.bezierCurveTo(w, h, -w, h, -w, h - w);
  s.lineTo(-w, -h + w);
  return s;
}

/** Extrude a Shape into a 3D mesh. */
function extrude(
  shape: THREE.Shape,
  depth: number,
  bevel: number,
  bevelSegments = 4,
): THREE.BufferGeometry {
  return new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments,
    curveSegments: 24,
  });
}

/* ════════════════════════════════════════════════════════════════════════
 *  Procedural environment map — gives the materials life
 * ════════════════════════════════════════════════════════════════════════ */
function createEnvMap(accent: number): THREE.CubeTexture | null {
  try {
    const size = 64;
    const faces: HTMLCanvasElement[] = [];
    const ar = ((accent >> 16) & 0xff) / 255;
    const ag = ((accent >> 8) & 0xff) / 255;
    const ab = (accent & 0xff) / 255;
    const accentRgba = `rgba(${Math.round(ar * 255)},${Math.round(ag * 255)},${Math.round(ab * 255)},0.55)`;

    const baseShades: [number, number][] = [
      [0x18, 0x22], [0x12, 0x1e], [0x32, 0x16], [0x06, 0x10], [0x18, 0x22], [0x10, 0x1c],
    ];
    for (let f = 0; f < 6; f++) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.createLinearGradient !== "function") return null;
      const [a, b] = baseShades[f];
      const g = ctx.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, `rgb(${a},${a},${a + 8})`);
      g.addColorStop(1, `rgb(${b},${b},${b + 12})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      if (f === 2) {
        const rg = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
        rg.addColorStop(0, accentRgba);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, size, size);
      }
      for (let i = 0; i < 120; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.08})`;
        ctx.fillRect(x, y, 1, 1);
      }
      faces.push(canvas);
    }
    const tex = new THREE.CubeTexture(faces);
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 *  Materials factory
 * ════════════════════════════════════════════════════════════════════════ */
function makeMaterials(opts: {
  shell: number;
  inset: number;
  accent: number;
  envMap: THREE.CubeTexture | null;
  light: boolean;
}) {
  const { shell, inset, accent, envMap, light } = opts;
  return {
    shell: new THREE.MeshStandardMaterial({
      color: shell,
      metalness: 0.2,
      roughness: 0.35,
      envMap,
      envMapIntensity: light ? 0.55 : 0.7,
    }),
    inset: new THREE.MeshStandardMaterial({
      color: inset,
      metalness: 0.55,
      roughness: 0.2,
      envMap,
      envMapIntensity: 0.6,
    }),
    bezel: new THREE.MeshStandardMaterial({
      color: 0x101010,
      metalness: 0.7,
      roughness: 0.35,
      envMap,
      envMapIntensity: 0.4,
    }),
    jade: new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.95,
      metalness: 0.4,
      roughness: 0.18,
      envMap,
      envMapIntensity: 0.55,
    }),
    jadeStem: new THREE.MeshStandardMaterial({
      color: accent,
      emissive: accent,
      emissiveIntensity: 0.7,
      metalness: 0.35,
      roughness: 0.25,
      envMap,
      envMapIntensity: 0.45,
    }),
    jadeGlow: new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.45 }),
    glint: new THREE.MeshBasicMaterial({ color: 0xeefff8, transparent: true, opacity: 0.85 }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

/* ════════════════════════════════════════════════════════════════════════
 *  Chassis variant proportions — applied to tile + face shell + inset
 * ════════════════════════════════════════════════════════════════════════ */
interface ChassisSpec {
  tileR: number;       // tile corner radius
  scaleX: number;      // inner content scale
  scaleY: number;
}
const CHASSIS_SPECS: Record<string, ChassisSpec> = {
  classic: { tileR: 0.42, scaleX: 1.0, scaleY: 1.0 },
  square:  { tileR: 0.18, scaleX: 1.0, scaleY: 1.0 },
  tall:    { tileR: 0.42, scaleX: 0.88, scaleY: 1.0 },
  pebble:  { tileR: 0.62, scaleX: 1.0, scaleY: 0.92 },
};
function getChassisSpec(id?: string): ChassisSpec {
  return CHASSIS_SPECS[id ?? "classic"] ?? CHASSIS_SPECS.classic;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Build the avatar — returns named refs for the animation loop
 * ════════════════════════════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════════════════════════════
 *  Headphones — five 3D variants. Drawn flanking the ear-cap area; the
 *  underlying white ear-cap spheres stay so the brand silhouette persists.
 *
 *  Coordinate system (relative to innerGroup):
 *    Left ear  ≈ (-0.78, -0.18, 0.18)
 *    Right ear ≈ ( 0.78, -0.18, 0.18)
 * ════════════════════════════════════════════════════════════════════════ */
function buildHeadphones(
  headphonesId: string,
  parent: THREE.Group,
  mats: Mats,
  shellW: number,
) {
  if (headphonesId === "bumper") return;

  const earL = { x: -shellW / 2 - 0.05, y: -0.18, z: 0.18 };
  const earR = { x:  shellW / 2 + 0.05, y: -0.18, z: 0.18 };

  if (headphonesId === "studio") {
    // Connecting band arcing over the head — a thin torus arc
    const bandGeo = new THREE.TorusGeometry(shellW / 2 + 0.05, 0.04, 10, 40, Math.PI);
    const band = new THREE.Mesh(bandGeo, mats.shell);
    band.rotation.x = Math.PI / 2;
    band.rotation.z = Math.PI; // arch opens downward → over the head
    band.position.set(0, 0.45, 0.18);
    parent.add(band);
    // Cups + pads
    [earL, earR].forEach((e) => {
      const cupGeo = new THREE.SphereGeometry(0.22, 24, 24);
      cupGeo.scale(1.0, 1.0, 0.6);
      const cup = new THREE.Mesh(cupGeo, mats.inset);
      cup.position.set(e.x, e.y, e.z + 0.03);
      parent.add(cup);
      const padGeo = new THREE.SphereGeometry(0.13, 20, 20);
      padGeo.scale(1.0, 1.0, 0.5);
      const pad = new THREE.Mesh(padGeo, mats.jade);
      pad.position.set(e.x, e.y, e.z + 0.12);
      parent.add(pad);
      const ringGeo = new THREE.TorusGeometry(0.22, 0.014, 8, 32);
      const ring = new THREE.Mesh(ringGeo, mats.shell);
      ring.position.set(e.x, e.y, e.z + 0.05);
      parent.add(ring);
    });
    return;
  }

  if (headphonesId === "earbuds") {
    [earL, earR].forEach((e, idx) => {
      const sign = idx === 0 ? -1 : 1;
      const budGeo = new THREE.SphereGeometry(0.085, 18, 18);
      const bud = new THREE.Mesh(budGeo, mats.jade);
      bud.position.set(e.x + sign * 0.06, e.y, e.z + 0.06);
      parent.add(bud);
      // Tiny cable hint — a small torus segment
      const cableGeo = new THREE.TorusGeometry(0.16, 0.012, 6, 24, Math.PI / 2);
      const cable = new THREE.Mesh(cableGeo, mats.jadeStem);
      cable.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI;
      cable.position.set(e.x + sign * 0.06, e.y - 0.12, e.z + 0.06);
      parent.add(cable);
    });
    return;
  }

  if (headphonesId === "loop") {
    [earL, earR].forEach((e) => {
      const ringGeo = new THREE.TorusGeometry(0.2, 0.035, 12, 40);
      const ring = new THREE.Mesh(ringGeo, mats.jade);
      ring.position.set(e.x, e.y, e.z + 0.04);
      ring.rotation.y = Math.PI / 2;
      parent.add(ring);
      const padGeo = new THREE.SphereGeometry(0.1, 18, 18);
      padGeo.scale(0.4, 1.0, 1.0);
      const pad = new THREE.Mesh(padGeo, mats.jade);
      pad.position.set(e.x, e.y, e.z + 0.06);
      parent.add(pad);
    });
    return;
  }

  if (headphonesId === "fins") {
    // Sleek angled fins sweeping backward — extruded triangles
    const buildFin = (sign: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.18);
      shape.lineTo(sign * 0.36, -0.05);
      shape.lineTo(sign * 0.42, -0.16);
      shape.lineTo(sign * 0.12, -0.12);
      shape.lineTo(0, -0.04);
      shape.lineTo(0, 0.18);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 16 });
      const fin = new THREE.Mesh(geo, mats.jade);
      const target = sign < 0 ? earL : earR;
      fin.position.set(target.x, target.y, target.z + 0.02);
      parent.add(fin);
    };
    buildFin(-1);
    buildFin(1);
    return;
  }
}

function buildAvatar(config: AgentAvatarConfig, mats: Mats) {
  const root = new THREE.Group();
  const headGroup = new THREE.Group();
  root.add(headGroup);

  const chassis = getChassisSpec(config.chassis);

  /* Inner content group — chassis variants scale the bot so tall/wide
     variations work without deforming the face geometry. The 3D scene
     intentionally has no surrounding "tile" mesh: we render the bot only
     so it floats freely against whatever background hosts the canvas. */
  const innerGroup = new THREE.Group();
  innerGroup.scale.set(chassis.scaleX, chassis.scaleY, 1);
  headGroup.add(innerGroup);

  /* ── 2. White face shell + ear caps ──
     Shell is a flat extruded rounded rect, slightly inset from the tile.
     Ear caps are two squat spheres flanking it at mid-height. */
  const shellW = 1.55;
  const shellH = 1.42;
  const shellShape = roundedRectShape(shellW, shellH, 0.42);
  const shellGeo = extrude(shellShape, 0.1, 0.03, 5);
  const shell = new THREE.Mesh(shellGeo, mats.shell);
  shell.position.set(0, -0.04, 0.13);
  innerGroup.add(shell);

  const earGeo = new THREE.SphereGeometry(0.26, 32, 32);
  earGeo.scale(1.0, 0.85, 0.85);
  const earL = new THREE.Mesh(earGeo, mats.shell);
  earL.position.set(-shellW / 2 - 0.05, -0.18, 0.18);
  innerGroup.add(earL);
  const earR = new THREE.Mesh(earGeo, mats.shell);
  earR.position.set(shellW / 2 + 0.05, -0.18, 0.18);
  innerGroup.add(earR);

  /* ── 3. Dark inset face ──
     Sits inside the shell, recessed deeper. */
  const insetW = 1.18;
  const insetH = 0.78;
  const insetShape = roundedRectShape(insetW, insetH, 0.32);
  const insetGeo = extrude(insetShape, 0.08, 0.025, 4);
  const inset = new THREE.Mesh(insetGeo, mats.inset);
  inset.position.set(0, -0.22, 0.23);
  innerGroup.add(inset);

  /* ── 4. Bezel sliver — thin dark line above the inset, hugging the top edge ── */
  const bezelGeo = new THREE.BoxGeometry(insetW * 0.95, 0.012, 0.012);
  const bezel = new THREE.Mesh(bezelGeo, mats.bezel);
  bezel.position.set(0, -0.22 + insetH / 2 + 0.012, 0.32);
  innerGroup.add(bezel);

  /* ── 5. Eyes ── */
  const eyesGroup = new THREE.Group();
  innerGroup.add(eyesGroup);
  eyesGroup.position.set(0, -0.22, 0.32);

  const eyeSep = insetW * 0.27;
  const eyesId = config.eyes ?? "smile";
  let leftEye: THREE.Mesh;
  let rightEye: THREE.Mesh | null = null;
  let eyesKind: "smile" | "visor" | "single" | "pixel" | "heart" = "smile";

  if (eyesId === "visor") {
    eyesKind = "visor";
    /* Award-winning visor: layered, beveled HUD band.
       Composition mirrors the SVG version so the look matches across
       surfaces.  All sub-meshes live in a single Group that we treat as
       the "eye" so the blink scale animates everything together. */
    const visorGroup = new THREE.Group();
    const visorW = insetW * 0.95;
    const visorH = 0.22;
    const visorD = 0.07;

    // 1. Outer recess shadow — slightly larger dark plate behind the body
    const recessGeo = extrude(
      roundedRectShape(visorW + 0.04, visorH + 0.04, visorH * 0.48),
      0.02,
      0.005,
      3,
    );
    const recess = new THREE.Mesh(recessGeo, mats.inset);
    recess.position.set(0, 0, -0.02);
    visorGroup.add(recess);

    // 2. Main visor body — beveled extrusion in the jade accent
    const bodyShape = roundedRectShape(visorW, visorH, visorH * 0.45);
    const bodyGeo = extrude(bodyShape, visorD, 0.014, 5);
    const body = new THREE.Mesh(bodyGeo, mats.jade);
    body.position.set(0, 0, 0);
    visorGroup.add(body);

    // 3. Inner darker recessed channel — picks up the jade material's
    //    env reflections via the parent mats.jade glow without needing a
    //    direct envMap reference here.
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x081d16,
      emissive: 0x041a12,
      emissiveIntensity: 0.45,
      metalness: 0.55,
      roughness: 0.2,
    });
    const innerGeo = extrude(
      roundedRectShape(visorW * 0.92, visorH * 0.55, visorH * 0.22),
      0.015,
      0.004,
      3,
    );
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.set(0, 0, visorD * 0.75);
    visorGroup.add(inner);

    // 4. Glass top highlight — translucent white strip suggesting reflection
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.36,
    });
    const glassGeo = new THREE.BoxGeometry(visorW * 0.85, visorH * 0.2, 0.006);
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, visorH * 0.32, visorD * 0.95);
    visorGroup.add(glass);

    // 5. Two pulsing pupil cores at the eye anchors
    const pupilGeo = new THREE.SphereGeometry(0.032, 18, 18);
    const pupilL = new THREE.Mesh(pupilGeo, mats.jade);
    pupilL.position.set(-eyeSep, 0, visorD * 0.95);
    visorGroup.add(pupilL);
    const pupilR = new THREE.Mesh(pupilGeo, mats.jade);
    pupilR.position.set(eyeSep, 0, visorD * 0.95);
    visorGroup.add(pupilR);

    // Bright white cores inside each pupil
    const coreGeo = new THREE.SphereGeometry(0.012, 12, 12);
    const coreL = new THREE.Mesh(coreGeo, mats.glint);
    coreL.position.set(-eyeSep, 0.005, visorD + 0.018);
    visorGroup.add(coreL);
    const coreR = new THREE.Mesh(coreGeo, mats.glint);
    coreR.position.set(eyeSep, 0.005, visorD + 0.018);
    visorGroup.add(coreR);

    // 6. HUD tick marks on the left + right edges
    const tickShape = roundedRectShape(0.015, 0.08, 0.006);
    const tickGeo = extrude(tickShape, 0.018, 0.003, 2);
    const tickL1 = new THREE.Mesh(tickGeo, mats.jade);
    tickL1.position.set(-visorW * 0.46, 0, visorD * 0.85);
    visorGroup.add(tickL1);
    const tickL2 = new THREE.Mesh(tickGeo, mats.jade);
    tickL2.position.set(-visorW * 0.42, 0, visorD * 0.85);
    tickL2.scale.set(1, 0.55, 1);
    visorGroup.add(tickL2);
    const tickR1 = new THREE.Mesh(tickGeo, mats.jade);
    tickR1.position.set(visorW * 0.46, 0, visorD * 0.85);
    visorGroup.add(tickR1);
    const tickR2 = new THREE.Mesh(tickGeo, mats.jade);
    tickR2.position.set(visorW * 0.42, 0, visorD * 0.85);
    tickR2.scale.set(1, 0.55, 1);
    visorGroup.add(tickR2);

    eyesGroup.add(visorGroup);
    // Treat the group as the "eye" for blink/scale animation
    leftEye = visorGroup as unknown as THREE.Mesh;
  } else if (eyesId === "heart") {
    eyesKind = "heart";
    // Heart-shaped eyes — two stacked spheres + a downward triangle, fused.
    const buildHeart = (sign: number) => {
      const grp = new THREE.Group();
      const lobeGeo = new THREE.SphereGeometry(0.06, 18, 18);
      const lobeL = new THREE.Mesh(lobeGeo, mats.jade);
      lobeL.position.set(-0.04, 0.025, 0.0);
      const lobeR = new THREE.Mesh(lobeGeo, mats.jade);
      lobeR.position.set(0.04, 0.025, 0.0);
      grp.add(lobeL);
      grp.add(lobeR);
      // Pointed bottom — small extruded triangle
      const tri = new THREE.Shape();
      tri.moveTo(-0.07, 0.02);
      tri.lineTo(0.07, 0.02);
      tri.lineTo(0, -0.09);
      tri.lineTo(-0.07, 0.02);
      const triGeo = new THREE.ExtrudeGeometry(tri, { depth: 0.04, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, curveSegments: 12 });
      const triMesh = new THREE.Mesh(triGeo, mats.jade);
      triMesh.position.set(0, 0, 0);
      grp.add(triMesh);
      grp.position.set(sign * eyeSep, 0, 0.03);
      eyesGroup.add(grp);
      return grp;
    };
    const lh = buildHeart(-1);
    const rh = buildHeart(1);
    // Treat the GROUPs as eyes for the animation loop's scale.y squash
    leftEye = lh as unknown as THREE.Mesh;
    rightEye = rh as unknown as THREE.Mesh;
  } else if (eyesId === "single") {
    eyesKind = "single";
    const lensGeo = new THREE.SphereGeometry(0.18, 32, 32);
    leftEye = new THREE.Mesh(lensGeo, mats.jade);
    eyesGroup.add(leftEye);
    const ringGeo = new THREE.TorusGeometry(0.22, 0.018, 12, 48);
    const ring = new THREE.Mesh(ringGeo, mats.jade);
    eyesGroup.add(ring);
    rightEye = ring;
    const glintGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const glint = new THREE.Mesh(glintGeo, mats.glint);
    glint.position.set(-0.05, 0.05, 0.16);
    eyesGroup.add(glint);
  } else if (eyesId === "pixel") {
    eyesKind = "pixel";
    const pxGeo = new THREE.BoxGeometry(0.14, 0.14, 0.05);
    leftEye = new THREE.Mesh(pxGeo, mats.jade);
    leftEye.position.set(-eyeSep, 0, 0.02);
    eyesGroup.add(leftEye);
    rightEye = new THREE.Mesh(pxGeo, mats.jade);
    rightEye.position.set(eyeSep, 0, 0.02);
    eyesGroup.add(rightEye);
  } else {
    eyesKind = "smile";
    // Canonical smile-arcs — extruded thick crescents
    const smileGeo = extrude(smileArcShape(0.34, 0.22, 0.06), 0.05, 0.012, 3);
    leftEye = new THREE.Mesh(smileGeo, mats.jade);
    leftEye.position.set(-eyeSep, 0.06, 0.02);
    eyesGroup.add(leftEye);
    const smileGeo2 = extrude(smileArcShape(0.34, 0.22, 0.06), 0.05, 0.012, 3);
    rightEye = new THREE.Mesh(smileGeo2, mats.jade);
    rightEye.position.set(eyeSep, 0.06, 0.02);
    eyesGroup.add(rightEye);
  }

  /* The forehead jewel was removed per user request — the smile bot now
     has a clean forehead. The antenna jewel keeps the brand pulse. */

  /* ── Headphones — five styles, drawn over the white ear caps ── */
  const headphonesId = config.headphones ?? "bumper";
  buildHeadphones(headphonesId, innerGroup, mats, shellW);

  /* ── 7. Antenna ── */
  const antennaGroup = new THREE.Group();
  innerGroup.add(antennaGroup);
  antennaGroup.position.set(0, shellH / 2 + 0.06, 0.0);
  const antennaId = config.antenna ?? "jewel";
  let antennaTip: THREE.Mesh | null = null;

  if (antennaId === "bunny") {
    [-1, 1].forEach((side) => {
      const stickGeo = extrude(capsuleShape(0.07, 0.42), 0.04, 0.012, 3);
      const stick = new THREE.Mesh(stickGeo, mats.jade);
      stick.position.set(side * 0.18, 0.18, 0.05);
      stick.rotation.z = side * 0.38;
      antennaGroup.add(stick);
      const tipGeo = new THREE.SphereGeometry(0.07, 18, 18);
      const tip = new THREE.Mesh(tipGeo, mats.jade);
      tip.position.set(side * 0.34, 0.36, 0.07);
      antennaGroup.add(tip);
      if (!antennaTip) antennaTip = tip;
    });
  } else if (antennaId === "beam") {
    const stickGeo = extrude(capsuleShape(0.05, 0.48), 0.04, 0.01, 3);
    const stick = new THREE.Mesh(stickGeo, mats.jade);
    stick.position.set(0, 0.18, 0.05);
    antennaGroup.add(stick);
    const tipGeo = new THREE.SphereGeometry(0.1, 20, 20);
    const tip = new THREE.Mesh(tipGeo, mats.jade);
    tip.position.set(0, 0.42, 0.07);
    antennaGroup.add(tip);
    antennaTip = tip;
    const haloGeo = new THREE.TorusGeometry(0.16, 0.012, 8, 32);
    const halo = new THREE.Mesh(haloGeo, mats.jadeGlow);
    halo.rotation.x = Math.PI / 2;
    halo.position.copy(tip.position);
    antennaGroup.add(halo);
  } else if (antennaId === "wifi") {
    // Small antenna dot + three signal arcs radiating up
    const baseGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const base = new THREE.Mesh(baseGeo, mats.jade);
    base.position.set(0, 0.12, 0.05);
    antennaGroup.add(base);
    antennaTip = base;
    // Three concentric arcs — TorusGeometry with arc < 2π
    [0.16, 0.24, 0.32].forEach((r, i) => {
      const arcGeo = new THREE.TorusGeometry(r, 0.018, 10, 24, Math.PI);
      const arc = new THREE.Mesh(arcGeo, mats.jade);
      arc.position.set(0, 0.12, 0.05);
      antennaGroup.add(arc);
    });
  } else if (antennaId !== "none") {
    // Default jewel: vertical pill + two diagonal tilt lines
    const pillGeo = extrude(capsuleShape(0.09, 0.32), 0.05, 0.012, 3);
    const pill = new THREE.Mesh(pillGeo, mats.jade);
    pill.position.set(0, 0.18, 0.05);
    antennaGroup.add(pill);
    antennaTip = pill;
    // Diagonal tilt lines flanking the pill (left = \, right = /)
    const lineGeo = extrude(capsuleShape(0.04, 0.22), 0.04, 0.01, 3);
    const lineL = new THREE.Mesh(lineGeo, mats.jadeStem);
    lineL.position.set(-0.16, 0.07, 0.05);
    lineL.rotation.z = -Math.PI * 0.18;
    antennaGroup.add(lineL);
    const lineR = new THREE.Mesh(lineGeo, mats.jadeStem);
    lineR.position.set(0.16, 0.07, 0.05);
    lineR.rotation.z = Math.PI * 0.18;
    antennaGroup.add(lineR);
  }

  /* ── 8. Aura (behind / around the head) ── */
  const auraGroup = new THREE.Group();
  root.add(auraGroup);
  const wingsId = config.wings ?? "none";
  const auraRefs: { r1?: THREE.Mesh; r2?: THREE.Mesh; halo?: THREE.Mesh; orbits?: THREE.Mesh[]; kind: string } = { kind: wingsId };

  if (wingsId === "halo") {
    // Tilted celestial crown — two stacked ellipses + 3 floating dots that rotate
    const haloGeo = new THREE.TorusGeometry(1.05, 0.035, 12, 80);
    const halo = new THREE.Mesh(haloGeo, mats.jade);
    halo.rotation.x = Math.PI / 2.4;
    halo.position.set(0, 0.85, -0.2);
    auraGroup.add(halo);
    auraRefs.halo = halo;
    // Inner crisp ring
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.02, 10, 64), mats.jade);
    inner.rotation.x = Math.PI / 2.4;
    inner.position.set(0, 0.85, -0.2);
    auraGroup.add(inner);
    // 3 floating accent satellites
    [-1, 0, 1].forEach((i) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 14), mats.jade);
      const a = i * (Math.PI / 3) + Math.PI / 2;
      orb.position.set(Math.cos(a) * 1.05, 0.85 + Math.sin(a) * 0.4 - 0.05, -0.2);
      auraGroup.add(orb);
    });
  } else if (wingsId === "pulse") {
    // Avantgarde shockwave — three rotated rounded-rect rings (extruded
    // wireframes) instead of plain circles. Angled offsets create the
    // designer-style asymmetric pulse the user wants.
    const buildRect = (size: number, rot: number, mat: THREE.MeshStandardMaterial) => {
      const outer = roundedRectShape(size, size, size * 0.32);
      const innerR = roundedRectShape(size - 0.05, size - 0.05, (size - 0.05) * 0.32);
      const path = new THREE.Path();
      // Subtract inner from outer for a wireframe-like ring
      outer.holes.push(path);
      void innerR;
      const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.01, bevelEnabled: false, curveSegments: 24 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.z = rot;
      mesh.position.z = -0.05;
      return mesh;
    };
    // Use tori instead — cleaner ring silhouette
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.025, 12, 80), mats.jade);
    r1.rotation.x = Math.PI / 2;
    r1.position.z = -0.1;
    auraGroup.add(r1);
    auraRefs.r1 = r1;
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.018, 12, 80), mats.jadeStem);
    r2.rotation.x = Math.PI / 2;
    r2.position.z = -0.1;
    auraGroup.add(r2);
    auraRefs.r2 = r2;
    // Plus an off-axis accent ring for the avantgarde tilt
    const r3 = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.014, 10, 64), mats.jade);
    r3.rotation.x = Math.PI / 2;
    r3.rotation.z = Math.PI / 8;
    r3.position.z = -0.1;
    auraGroup.add(r3);
    (auraRefs as { r3?: THREE.Mesh }).r3 = r3;
  } else if (wingsId === "orbit") {
    // Three jade satellites orbiting on a tilted ellipse
    const orbits: THREE.Mesh[] = [];
    [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach((phase) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 18), mats.jade);
      // initial position; the animation loop updates them per-frame
      orb.position.set(Math.cos(phase) * 1.45, 0, Math.sin(phase) * 0.35);
      orb.userData.phase = phase;
      auraGroup.add(orb);
      orbits.push(orb);
    });
    auraRefs.orbits = orbits;
  }

  return { root, headGroup, innerGroup, shell, inset, ears: [earL, earR], eyesGroup, leftEye, rightEye, eyesKind, antennaGroup, antennaTip, auraGroup, auraRefs };
}

/* ════════════════════════════════════════════════════════════════════════
 *  Resource bookkeeping — dispose every geometry / material / texture
 *  reachable from a subtree exactly once. Necessary because the same
 *  Material is shared across many meshes (mats.jade is on dozens of them),
 *  and Three.js's dispose() should only be called once per resource.
 * ════════════════════════════════════════════════════════════════════════ */
function disposeSubtree(
  root: THREE.Object3D,
  extraTextures: (THREE.Texture | null | undefined)[] = [],
) {
  const seenMats = new Set<THREE.Material>();
  const seenGeos = new Set<THREE.BufferGeometry>();
  const seenTextures = new Set<THREE.Texture>();
  root.traverse((obj: THREE.Object3D) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && !seenGeos.has(mesh.geometry)) {
      seenGeos.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    const mats = Array.isArray(mat) ? mat : [mat];
    for (const m of mats) {
      if (seenMats.has(m)) continue;
      seenMats.add(m);
      // Some materials hold textures we should free as well
      const std = m as THREE.MeshStandardMaterial;
      if (std.envMap && !seenTextures.has(std.envMap)) {
        seenTextures.add(std.envMap);
      }
      if (std.normalMap && !seenTextures.has(std.normalMap)) {
        seenTextures.add(std.normalMap);
      }
      m.dispose();
    }
  });
  for (const tex of extraTextures) {
    if (tex && !seenTextures.has(tex)) {
      seenTextures.add(tex);
    }
  }
  for (const tex of seenTextures) {
    tex.dispose();
  }
}

/* ════════════════════════════════════════════════════════════════════════
 *  Main component
 *
 *  Lifecycle is split into three effects so we never tear down the
 *  WebGL context on a config change:
 *
 *    1. Mount  — creates the renderer, scene, camera, lights ONCE.
 *                Disposes the GL context on unmount (with forceContextLoss
 *                so the browser frees it immediately instead of waiting
 *                for GC, which can evict other pages' contexts under load).
 *
 *    2. Config — when chassis / eyes / colors change, we only rebuild the
 *                avatar group + particles + env map. The renderer, scene,
 *                camera, and base lights persist.
 *
 *    3. Animate — drives the per-frame choreography. Re-runs only when
 *                 the expression target changes (cheap).
 *
 *  Background animations on the page share the global WebGL context pool.
 *  Recreating a renderer on every part-pick used to evict their contexts
 *  under rapid randomization — that bug is fixed by this split.
 * ════════════════════════════════════════════════════════════════════════ */
export function AgentAvatarScene({
  config = DEFAULT_AGENT_AVATAR_CONFIG,
  expression = "happy",
  className = "",
  fallbackMode = false,
}: AgentAvatarSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  /** Persistent across config changes. Created once on mount. */
  const rendererRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    avatarGroup: THREE.Group;
    ambient: THREE.AmbientLight;
    rim: THREE.PointLight;
    kicker: THREE.PointLight;
    animationId: number;
  } | null>(null);

  /** Rebuilt on every config change. */
  const avatarRef = useRef<{
    parts: ReturnType<typeof buildAvatar>;
    particles: THREE.Points;
    envMap: THREE.CubeTexture | null;
  } | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mq.matches);
    const h = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mq.addEventListener?.("change", h);
    return () => mq.removeEventListener?.("change", h);
  }, []);

  const configKey = `${config.chassis}-${config.eyes}-${config.antenna}-${config.wings}-${config.headphones}-${config.accent}-${config.baseColor}-${config.visorColor}`;

  /* ── Effect 1: mount renderer + scene (runs once per mount) ── */
  useEffect(() => {
    if (fallbackMode || webglError) return;
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch {
      setWebglError(true);
      return;
    }

    const { clientWidth, clientHeight } = mount;
    renderer.setSize(clientWidth, clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, clientWidth / clientHeight, 0.1, 100);
    camera.position.set(0, 0.2, 5.4);
    camera.lookAt(0, 0, 0);

    /* Lights — colors get updated when the accent changes in the config
       effect, so we only ever need one of each. */
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2.5, 4, 4.5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb6d4ff, 0.45);
    fill.position.set(-3.5, 1.5, 2.5);
    scene.add(fill);
    const back = new THREE.DirectionalLight(0xffd9a3, 0.32);
    back.position.set(0, 2.5, -4);
    scene.add(back);
    const rim = new THREE.PointLight(0x00eaab, 1.1, 8);
    rim.position.set(0, -1.6, 2.0);
    scene.add(rim);
    const kicker = new THREE.PointLight(0x00eaab, 0.35, 6);
    kicker.position.set(0, 2.4, 1.5);
    scene.add(kicker);

    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    rendererRef.current = { renderer, scene, camera, avatarGroup, ambient, rim, kicker, animationId: 0 };

    const onResize = () => {
      const r = rendererRef.current;
      if (!mountRef.current || !r) return;
      const { clientWidth: w, clientHeight: h2 } = mountRef.current;
      r.renderer.setSize(w, h2);
      r.camera.aspect = w / h2;
      r.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      const r = rendererRef.current;
      if (!r) return;
      cancelAnimationFrame(r.animationId);
      // Dispose avatar contents first (geometries / materials / textures)
      if (avatarRef.current) {
        disposeSubtree(r.avatarGroup, [avatarRef.current.envMap]);
        avatarRef.current = null;
      }
      // Dispose lights (no resources, but clear from scene for safety)
      if (mount.contains(r.renderer.domElement)) {
        mount.removeChild(r.renderer.domElement);
      }
      // Force the browser to release the GL context immediately instead
      // of waiting for GC — keeps the global context pool clean so other
      // WebGL surfaces (e.g. the page background) survive.
      try { r.renderer.forceContextLoss(); } catch { /* older three.js */ }
      r.renderer.dispose();
      rendererRef.current = null;
    };
  }, [fallbackMode, webglError]);

  /* ── Effect 2: rebuild avatar contents when config changes ── */
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || fallbackMode || webglError) return;

    // 2a. Remove + dispose previous avatar contents
    if (avatarRef.current) {
      r.avatarGroup.remove(avatarRef.current.parts.root);
      r.avatarGroup.remove(avatarRef.current.particles);
      disposeSubtree(avatarRef.current.parts.root, [avatarRef.current.envMap]);
      avatarRef.current.particles.geometry.dispose();
      (avatarRef.current.particles.material as THREE.Material).dispose();
      avatarRef.current = null;
    }

    // 2b. Compute the colors for this config
    const accent = hexInt(getAccentHex(config.accent), 0x00eaab);
    const shell = hexInt(getShellHex(config.baseColor), 0xfcfbfc);
    const inset = hexInt(getInsetHex(config.baseColor, config.visorColor));
    const light = isLightBase(config.baseColor);

    // 2c. Update the persistent lights to the new accent + ambient
    r.ambient.intensity = light ? 0.55 : 0.4;
    r.rim.color.setHex(accent);
    r.kicker.color.setHex(accent);

    // 2d. Build new avatar + particles
    const envMap = createEnvMap(accent);
    const mats = makeMaterials({ shell, inset, accent, envMap, light });
    const parts = buildAvatar(config, mats);
    r.avatarGroup.add(parts.root);

    const pCount = config.wings === "dust" ? 36 : 16;
    const pGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 3.2;
      pos[i * 3 + 1] = -1.6 + Math.random() * 3.6;
      pos[i * 3 + 2] = -0.6 + Math.random() * 0.8;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      color: accent,
      size: config.wings === "dust" ? 0.045 : 0.025,
      transparent: true,
      opacity: config.wings === "dust" ? 0.7 : 0.4,
    });
    const particles = new THREE.Points(pGeo, pMat);
    r.avatarGroup.add(particles);

    avatarRef.current = { parts, particles, envMap };
  }, [configKey, fallbackMode, webglError]);

  /* ════════════════════════════════════════════════════════════════════════
   *  Animation loop — choreography per expression
   *
   *  Reads from rendererRef + avatarRef each frame so it survives config
   *  changes. The function reference itself never changes during a mount
   *  cycle — only the expression-driven target values are recomputed.
   * ════════════════════════════════════════════════════════════════════════ */
  useEffect(() => {
    const r = rendererRef.current;
    if (!r || fallbackMode || webglError) return;
    let t = 0;
    let nextBlink = 3 + Math.random() * 2;

    // Expression targets
    let headTiltX = 0, headTiltZ = 0;
    let bounceAmp = 0.04, bounceSpeed = 1.4;
    let antennaSway = 0.05;
    let eyeArcInvert = false;
    let eyeScaleY = 1.0;
    let jewelIntensity = 0.95;

    switch (expression) {
      case "happy":
        bounceAmp = 0.06; bounceSpeed = 1.8;
        jewelIntensity = 1.0;
        break;
      case "sad":
        headTiltX = 0.14;
        bounceAmp = 0.02; bounceSpeed = 0.6;
        eyeArcInvert = true;
        jewelIntensity = 0.4;
        break;
      case "angry":
        headTiltX = -0.05;
        bounceAmp = 0.03; bounceSpeed = 2.6;
        eyeArcInvert = true;
        eyeScaleY = 0.7;
        antennaSway = 0.1;
        jewelIntensity = 1.25;
        break;
      case "sleepy":
        eyeScaleY = 0.18;
        headTiltZ = 0.18; headTiltX = 0.08;
        bounceAmp = 0.02; bounceSpeed = 0.5;
        antennaSway = 0.015;
        jewelIntensity = 0.35;
        break;
      case "bored":
        eyeScaleY = 0.35;
        headTiltZ = 0.08;
        bounceAmp = 0.02; bounceSpeed = 0.7;
        jewelIntensity = 0.5;
        break;
      case "hyped":
        bounceAmp = 0.14; bounceSpeed = 3.2;
        antennaSway = 0.14;
        eyeScaleY = 1.2;
        jewelIntensity = 1.4;
        break;
      case "shake_head":
      case "nod":
        bounceAmp = 0.04;
        break;
    }

    const animate = () => {
      // Read the current scene + avatar each frame so the loop survives
      // config-driven avatar rebuilds without restarting.
      const r2 = rendererRef.current;
      if (!r2) return; // renderer gone — exit the loop on unmount
      r2.animationId = requestAnimationFrame(animate);

      const a = avatarRef.current;
      if (!a) {
        // Mid-rebuild: render the empty scene this frame and try again next.
        r2.renderer.render(r2.scene, r2.camera);
        return;
      }

      if (isReducedMotion) {
        r2.renderer.render(r2.scene, r2.camera);
        return;
      }

      const p = a.parts;
      const particles = a.particles;
      t += 0.016;

      // Idle float + breath
      r2.avatarGroup.position.y = Math.sin(t * bounceSpeed) * bounceAmp + 0.02;
      const breath = 1 + Math.sin(t * 1.5) * 0.012;
      p.headGroup.scale.set(breath, breath, breath);

      // Head pose
      if (expression === "shake_head") {
        p.headGroup.rotation.y = Math.sin(t * 5) * 0.25;
      } else if (expression === "nod") {
        p.headGroup.rotation.x = Math.sin(t * 4) * 0.18;
      } else {
        p.headGroup.rotation.y = THREE.MathUtils.lerp(p.headGroup.rotation.y, Math.sin(t * 0.4) * 0.06, 0.08);
        p.headGroup.rotation.x = THREE.MathUtils.lerp(p.headGroup.rotation.x, headTiltX, 0.06);
        p.headGroup.rotation.z = THREE.MathUtils.lerp(p.headGroup.rotation.z, headTiltZ, 0.06);
      }

      // Antenna sway
      p.antennaGroup.rotation.z = Math.sin(t * 2.0) * antennaSway;

      // Blink — smile arcs compress
      let blinkFactor = 1;
      if (t > nextBlink) {
        const phase = t - nextBlink;
        if (phase < 0.16) blinkFactor = 1 - phase / 0.16;
        else if (phase < 0.32) blinkFactor = (phase - 0.16) / 0.16;
        else nextBlink = t + 3 + Math.random() * 3;
      }
      const targetEyeY = eyeScaleY * Math.max(0.08, blinkFactor);
      // For smile eyes we use a signed scale.y so frown → negative (visual flip).
      const signedTarget = p.eyesKind === "smile" && eyeArcInvert ? -targetEyeY : targetEyeY;
      p.leftEye.scale.y = THREE.MathUtils.lerp(p.leftEye.scale.y, signedTarget, 0.35);
      if (p.rightEye) p.rightEye.scale.y = THREE.MathUtils.lerp(p.rightEye.scale.y, signedTarget, 0.35);

      // Antenna pulse
      const pulse = jewelIntensity * (0.85 + Math.sin(t * 2.4) * 0.2);
      const antennaTipMat = p.antennaTip?.material as THREE.MeshStandardMaterial | undefined;
      if (antennaTipMat) antennaTipMat.emissiveIntensity = THREE.MathUtils.lerp(antennaTipMat.emissiveIntensity, pulse * 1.05, 0.08);

      // Aura ring pulse — three rings phase-offset
      if (p.auraRefs.kind === "pulse" && p.auraRefs.r1 && p.auraRefs.r2) {
        const k1 = 1 + Math.sin(t * 1.8) * 0.06;
        const k2 = 1 + Math.sin(t * 1.8 + 0.5) * 0.05;
        p.auraRefs.r1.scale.set(k1, k1, k1);
        p.auraRefs.r2.scale.set(k2 * 1.04, k2 * 1.04, k2 * 1.04);
        const r3 = (p.auraRefs as { r3?: THREE.Mesh }).r3;
        if (r3) {
          const k3 = 1 + Math.sin(t * 1.8 + 1.0) * 0.04;
          r3.scale.set(k3 * 1.02, k3 * 1.02, k3 * 1.02);
          r3.rotation.z += 0.004;
        }
      }
      if (p.auraRefs.kind === "halo" && p.auraRefs.halo) {
        p.auraGroup.rotation.y += 0.006;
      }
      if (p.auraRefs.kind === "orbit" && p.auraRefs.orbits) {
        // 3 satellites circling on a tilted ellipse (xz plane, slight y tilt)
        p.auraRefs.orbits.forEach((orb) => {
          const phase = (orb.userData.phase ?? 0) + t * 0.6;
          orb.position.x = Math.cos(phase) * 1.5;
          orb.position.z = Math.sin(phase) * 0.45;
          orb.position.y = Math.sin(phase * 0.5) * 0.18;
        });
      }

      // Particles drift up
      const attr = particles.geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (attr && attr.count) {
        for (let i = 0; i < attr.count; i++) {
          let y = attr.getY(i);
          y += 0.008;
          if (y > 2.4) y = -1.6;
          attr.setY(i, y);
          attr.setX(i, attr.getX(i) + Math.sin(t + i * 0.4) * 0.0008);
        }
        attr.needsUpdate = true;
      }

      r2.renderer.render(r2.scene, r2.camera);
    };

    cancelAnimationFrame(r.animationId);
    animate();

    return () => {
      const r2 = rendererRef.current;
      if (r2) cancelAnimationFrame(r2.animationId);
    };
  }, [expression, isReducedMotion, fallbackMode, webglError]);

  if (fallbackMode || webglError) {
    return (
      <div
        className={`flex items-center justify-center rounded-2xl bg-slate-50 dark:bg-void-800/40 ${className}`}
        style={{ minHeight: "200px", width: "100%", height: "100%" }}
        data-testid="agent-avatar-fallback"
      >
        <AgentAvatarSvg config={config} expression={expression} className="w-full h-full max-w-[220px]" />
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      className={`w-full h-full relative ${className}`}
      style={{ minHeight: "200px" }}
      data-testid="agent-avatar-scene"
    />
  );
}

export { BRAND_COLORS };
