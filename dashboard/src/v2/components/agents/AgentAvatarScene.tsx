/**
 * AgentAvatarScene — High-fidelity 3D translation of the Code UX brand mark.
 *
 * The bot is NOT approximated with primitive boxes/spheres: every structural
 * layer is the *actual* logo bezier path (shared via lib/agent-avatar-logo.ts)
 * parsed into THREE.Shapes and extruded with soft bevels. That makes the 3D
 * silhouette — face shell with its speech-bubble tail and antenna mount bump,
 * crescent ear caps, inset screen, smile-arc eyes, antenna pill + tilt
 * lines — proportion-identical to the SVG/logo renditions:
 *
 *         ⌇  ANTENNA PILL + tilt lines        (extruded logo paths, jade)
 *      ┌──╨──────────────────┐
 *    ( │   WHITE FACE SHELL  │ )              (extruded logo path, ceramic)
 *      │  ┌────────────────┐ │   ← ear caps   (extruded logo crescents)
 *      │  │  DARK SCREEN   │ │                (extruded logo path, glass)
 *      │  │   ⌣      ⌣     │ │   ← smile arcs (extruded logo paths, emissive)
 *      │  └────────────────┘ │
 *      └──◣──────────────────┘   ← speech-bubble tail baked into the shell
 *
 * Rendering: clearcoat ceramic shell + glass screen lit by a procedural
 * studio environment (softbox streaks + accent splash), a 6-light rig, and a
 * soft contact shadow that counter-animates the idle float. Choreography:
 * idle breath, periodic blink, antenna sway/pulse, expression head poses,
 * and a pointer-follow head parallax when the cursor is over the stage.
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
import {
  PATH_FACE_SHELL,
  PATH_EAR_LEFT,
  PATH_EAR_RIGHT,
  PATH_ANTENNA_PILL,
  PATH_ANTENNA_TILT_LEFT,
  PATH_ANTENNA_TILT_RIGHT,
  PATH_INSET_FACE,
  PATH_EYE_LEFT_SMILE,
  PATH_EYE_RIGHT_SMILE,
  LOGO_ANCHORS,
  LOGO_FRAME,
  logoX,
  logoY,
  getChassisScale,
} from "../../lib/agent-avatar-logo.js";
import { extrudeLogoPath, type LogoShapeFrame } from "../../lib/logo-shapes.js";
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
 *  Scene-space layout — derived from the logo frame so every measurement
 *  traces back to the brand mark.
 * ════════════════════════════════════════════════════════════════════════ */
const BODY_FRAME: LogoShapeFrame = {
  cx: LOGO_FRAME.CX,
  cy: LOGO_FRAME.CY,
  pxPerUnit: LOGO_FRAME.PX_PER_UNIT,
};

const SHELL_DEPTH = 0.3;
const SHELL_BEVEL = 0.085;
/** Front surface of the shell extrusion (depth/2 + bevel). */
const SHELL_FRONT_Z = SHELL_DEPTH / 2 + SHELL_BEVEL;
const INSET_Z = SHELL_FRONT_Z + 0.005;
/** Front surface of the screen plate. */
const SCREEN_FRONT_Z = INSET_Z + 0.025 + 0.03;
const EYES_Z = SCREEN_FRONT_Z + 0.02;

/** Half the distance between the two eye centers, in scene units. */
const EYE_SEP = (LOGO_ANCHORS.eyeR.x - LOGO_ANCHORS.eyeL.x) / 2 / LOGO_FRAME.PX_PER_UNIT;
/** Inset screen extents in scene units. */
const INSET_W = (LOGO_ANCHORS.insetHalfW * 2) / LOGO_FRAME.PX_PER_UNIT;
const SHADOW_Y = -1.04;

/* ════════════════════════════════════════════════════════════════════════
 *  Generic shape builders for variant parts (visor band, antenna sticks…)
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

/** Vertical capsule/pill Shape — used for variant antenna sticks. */
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
 *  Procedural studio environment — softbox streaks on the side faces, a
 *  bright dome above, and an accent splash behind the bot. This is what
 *  gives the ceramic shell and glass screen their long, clean highlights.
 *  Cube face order: [+x, -x, +y, -y, +z, -z].
 * ════════════════════════════════════════════════════════════════════════ */
function createEnvMap(accent: number): THREE.CubeTexture | null {
  try {
    const size = 128;
    const faces: HTMLCanvasElement[] = [];
    const ar = (accent >> 16) & 0xff;
    const ag = (accent >> 8) & 0xff;
    const ab = accent & 0xff;

    const softbox = (
      ctx: CanvasRenderingContext2D,
      yFrac: number,
      hFrac: number,
      alpha: number,
    ) => {
      const y0 = size * yFrac;
      const h = size * hFrac;
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, `rgba(255,250,244,${alpha})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, size, h);
    };

    for (let f = 0; f < 6; f++) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.createLinearGradient !== "function") return null;

      // Base — graphite gradient, brighter toward the top
      const base = ctx.createLinearGradient(0, 0, 0, size);
      base.addColorStop(0, "rgb(46,48,58)");
      base.addColorStop(0.55, "rgb(20,21,27)");
      base.addColorStop(1, "rgb(7,7,10)");
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      if (f === 2) {
        // +y dome — broad soft overhead light
        const rg = ctx.createRadialGradient(size / 2, size / 2, 6, size / 2, size / 2, size * 0.72);
        rg.addColorStop(0, "rgba(255,252,246,0.95)");
        rg.addColorStop(1, "rgba(255,255,255,0.05)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, size, size);
      } else if (f === 0) {
        softbox(ctx, 0.16, 0.3, 0.85); // +x — key softbox
      } else if (f === 1) {
        softbox(ctx, 0.22, 0.26, 0.4); // -x — fill softbox
      } else if (f === 4) {
        softbox(ctx, 0.2, 0.2, 0.28); // +z — camera-side strip
      } else if (f === 5) {
        // -z — accent splash behind the bot for a colored rim in reflections
        const rg = ctx.createRadialGradient(size / 2, size * 0.62, 4, size / 2, size * 0.62, size * 0.6);
        rg.addColorStop(0, `rgba(${ar},${ag},${ab},0.7)`);
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, size, size);
      } else if (f === 3) {
        // -y floor — faint warm bounce
        ctx.fillStyle = "rgba(64,52,40,0.35)";
        ctx.fillRect(0, 0, size, size);
      }

      for (let i = 0; i < 90; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * size, Math.random() * size, 1, 1);
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

/** Soft radial gradient used by the contact shadow under the floating bot. */
function createShadowTexture(): THREE.CanvasTexture | null {
  try {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.createRadialGradient !== "function") return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.6, "rgba(0,0,0,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
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
    /** Glossy ceramic — the white body of the brand mark. */
    shell: new THREE.MeshPhysicalMaterial({
      color: shell,
      metalness: 0.05,
      roughness: 0.34,
      clearcoat: 0.9,
      clearcoatRoughness: 0.32,
      envMap,
      envMapIntensity: light ? 0.85 : 1.0,
    }),
    /** Glass screen — the dark inset face. */
    inset: new THREE.MeshPhysicalMaterial({
      color: inset,
      metalness: 0.1,
      roughness: 0.16,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      envMap,
      envMapIntensity: 1.15,
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
    sheen: new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    }),
  };
}
type Mats = ReturnType<typeof makeMaterials>;

/* ════════════════════════════════════════════════════════════════════════
 *  Headphones — five 3D variants flanking the logo's crescent ear caps.
 *  Anchors come straight from the logo so the placement matches the SVG.
 * ════════════════════════════════════════════════════════════════════════ */
function buildHeadphones(headphonesId: string, parent: THREE.Group, mats: Mats) {
  if (headphonesId === "bumper") return;

  const earY = logoY(LOGO_ANCHORS.earL.y);
  const earLX = logoX(LOGO_ANCHORS.earL.x);
  const earRX = logoX(LOGO_ANCHORS.earR.x);
  const ears = [
    { x: earLX, sign: -1 },
    { x: earRX, sign: 1 },
  ];

  if (headphonesId === "studio") {
    // Band arcing over the head — upper half-torus in the camera plane,
    // grazing the antenna mount bump exactly like the SVG arc.
    const bandR = Math.abs(earLX);
    const band = new THREE.Mesh(new THREE.TorusGeometry(bandR, 0.045, 12, 56, Math.PI), mats.shell);
    band.position.set(0, earY, 0.04);
    parent.add(band);
    ears.forEach(({ x, sign }) => {
      const cupGeo = new THREE.SphereGeometry(0.23, 26, 26);
      cupGeo.scale(0.72, 1.0, 0.85);
      const cup = new THREE.Mesh(cupGeo, mats.inset);
      cup.position.set(x + sign * 0.04, earY, 0.05);
      parent.add(cup);
      const padGeo = new THREE.SphereGeometry(0.12, 20, 20);
      padGeo.scale(0.5, 1.0, 1.0);
      const pad = new THREE.Mesh(padGeo, mats.jade);
      pad.position.set(x + sign * 0.16, earY, 0.05);
      parent.add(pad);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.016, 10, 36), mats.shell);
      ring.scale.set(0.75, 1.0, 1.0);
      ring.position.set(x + sign * 0.02, earY, 0.08);
      parent.add(ring);
    });
    return;
  }

  if (headphonesId === "earbuds") {
    ears.forEach(({ x, sign }) => {
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 20), mats.jade);
      bud.position.set(x + sign * 0.08, earY, 0.12);
      parent.add(bud);
      // Tiny cable hint — a quarter-torus dropping from the bud
      const cable = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.013, 8, 24, Math.PI / 2), mats.jadeStem);
      cable.rotation.z = sign > 0 ? -Math.PI / 2 : Math.PI;
      cable.position.set(x + sign * 0.08, earY - 0.12, 0.12);
      parent.add(cable);
    });
    return;
  }

  if (headphonesId === "loop") {
    // Bold jade rings framing the ear caps, facing the camera like the SVG.
    ears.forEach(({ x }) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.034, 12, 44), mats.jade);
      ring.scale.set(0.72, 1.0, 1.0);
      ring.position.set(x, earY, 0.16);
      parent.add(ring);
      const fillGeo = new THREE.CircleGeometry(0.16, 32);
      const fill = new THREE.Mesh(fillGeo, mats.jadeGlow);
      fill.scale.set(0.72, 1.0, 1.0);
      fill.position.set(x, earY, 0.14);
      parent.add(fill);
    });
    return;
  }

  if (headphonesId === "fins") {
    // Sleek angled fins sweeping outward — extruded blades
    ears.forEach(({ x, sign }) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.2);
      shape.lineTo(sign * 0.4, -0.05);
      shape.lineTo(sign * 0.46, -0.18);
      shape.lineTo(sign * 0.13, -0.13);
      shape.lineTo(0, -0.05);
      shape.lineTo(0, 0.2);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.045,
        bevelEnabled: true,
        bevelSize: 0.012,
        bevelThickness: 0.012,
        bevelSegments: 3,
        curveSegments: 16,
      });
      const fin = new THREE.Mesh(geo, mats.jade);
      fin.position.set(x, earY, 0.04);
      parent.add(fin);
    });
    return;
  }
}

/* ════════════════════════════════════════════════════════════════════════
 *  Build the avatar — returns named refs for the animation loop
 * ════════════════════════════════════════════════════════════════════════ */
function buildAvatar(config: AgentAvatarConfig, mats: Mats) {
  const root = new THREE.Group();
  const headGroup = new THREE.Group();
  root.add(headGroup);

  /* Inner content group — chassis variants scale the bot (same factors as
     the SVG renderer) so proportions track across surfaces. */
  const chassis = getChassisScale(config.chassis);
  const innerGroup = new THREE.Group();
  innerGroup.scale.set(chassis.scaleX, chassis.scaleY, 1);
  headGroup.add(innerGroup);

  /* ── 1. White face shell — the exact logo silhouette, extruded.
     Includes the speech-bubble tail and the antenna mount bump. ── */
  const shellGeo = extrudeLogoPath(PATH_FACE_SHELL, BODY_FRAME, {
    depth: SHELL_DEPTH,
    bevel: SHELL_BEVEL,
    bevelSegments: 6,
    curveSegments: 20,
  });
  const shell = new THREE.Mesh(shellGeo, mats.shell);
  innerGroup.add(shell);

  /* ── 2. Ear caps — the logo's crescent slivers, extruded thinner. ── */
  const earGeoL = extrudeLogoPath(PATH_EAR_LEFT, BODY_FRAME, {
    depth: 0.14,
    bevel: 0.05,
    bevelSegments: 5,
    curveSegments: 16,
  });
  const earL = new THREE.Mesh(earGeoL, mats.shell);
  innerGroup.add(earL);
  const earGeoR = extrudeLogoPath(PATH_EAR_RIGHT, BODY_FRAME, {
    depth: 0.14,
    bevel: 0.05,
    bevelSegments: 5,
    curveSegments: 16,
  });
  const earR = new THREE.Mesh(earGeoR, mats.shell);
  innerGroup.add(earR);

  /* ── 3. Dark inset screen — exact logo path, glass plate on the shell. ── */
  const insetGeo = extrudeLogoPath(PATH_INSET_FACE, BODY_FRAME, {
    depth: 0.05,
    bevel: 0.03,
    bevelSegments: 5,
    curveSegments: 20,
  });
  const inset = new THREE.Mesh(insetGeo, mats.inset);
  inset.position.set(0, 0, INSET_Z);
  innerGroup.add(inset);

  /* Diagonal glass sheen across the upper screen — pure presentation. */
  const sheen = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), mats.sheen);
  sheen.rotation.z = -0.3;
  sheen.position.set(-0.24, -0.18, SCREEN_FRONT_Z + 0.004);
  innerGroup.add(sheen);
  const sheen2 = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.06), mats.sheen);
  sheen2.rotation.z = -0.3;
  sheen2.position.set(-0.28, -0.32, SCREEN_FRONT_Z + 0.004);
  innerGroup.add(sheen2);

  /* ── 4. Eyes — anchored on the logo's eye centers. ── */
  const eyesGroup = new THREE.Group();
  innerGroup.add(eyesGroup);
  eyesGroup.position.set(logoX(LOGO_ANCHORS.eyeMid.x), logoY(LOGO_ANCHORS.eyeMid.y), EYES_Z);

  const eyesId = config.eyes ?? "smile";
  let leftEye: THREE.Mesh;
  let rightEye: THREE.Mesh | null = null;
  let eyesKind: "smile" | "visor" | "single" | "pixel" | "heart" = "smile";

  if (eyesId === "visor") {
    eyesKind = "visor";
    /* HUD band sized to the logo's screen — layered like the SVG visor. */
    const visorGroup = new THREE.Group();
    const visorW = INSET_W * 0.95;
    const visorH = 0.24;
    const visorD = 0.07;

    const recessGeo = extrude(roundedRectShape(visorW + 0.04, visorH + 0.04, visorH * 0.48), 0.02, 0.005, 3);
    const recess = new THREE.Mesh(recessGeo, mats.inset);
    recess.position.set(0, 0, -0.02);
    visorGroup.add(recess);

    const bodyGeo = extrude(roundedRectShape(visorW, visorH, visorH * 0.45), visorD, 0.014, 5);
    const body = new THREE.Mesh(bodyGeo, mats.jade);
    visorGroup.add(body);

    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x081d16,
      emissive: 0x041a12,
      emissiveIntensity: 0.45,
      metalness: 0.55,
      roughness: 0.2,
    });
    const innerGeo = extrude(roundedRectShape(visorW * 0.92, visorH * 0.55, visorH * 0.22), 0.015, 0.004, 3);
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.position.set(0, 0, visorD * 0.75);
    visorGroup.add(inner);

    const glassGeo = new THREE.BoxGeometry(visorW * 0.85, visorH * 0.2, 0.006);
    const glass = new THREE.Mesh(glassGeo, mats.sheen);
    glass.position.set(0, visorH * 0.32, visorD * 0.95);
    visorGroup.add(glass);

    const pupilGeo = new THREE.SphereGeometry(0.034, 18, 18);
    const pupilL = new THREE.Mesh(pupilGeo, mats.jade);
    pupilL.position.set(-EYE_SEP, 0, visorD * 0.95);
    visorGroup.add(pupilL);
    const pupilR = new THREE.Mesh(pupilGeo, mats.jade);
    pupilR.position.set(EYE_SEP, 0, visorD * 0.95);
    visorGroup.add(pupilR);

    const coreGeo = new THREE.SphereGeometry(0.013, 12, 12);
    const coreL = new THREE.Mesh(coreGeo, mats.glint);
    coreL.position.set(-EYE_SEP, 0.005, visorD + 0.018);
    visorGroup.add(coreL);
    const coreR = new THREE.Mesh(coreGeo, mats.glint);
    coreR.position.set(EYE_SEP, 0.005, visorD + 0.018);
    visorGroup.add(coreR);

    const tickGeo = extrude(roundedRectShape(0.016, 0.085, 0.006), 0.018, 0.003, 2);
    [-1, 1].forEach((side) => {
      const tick1 = new THREE.Mesh(tickGeo, mats.jade);
      tick1.position.set(side * visorW * 0.46, 0, visorD * 0.85);
      visorGroup.add(tick1);
      const tick2 = new THREE.Mesh(tickGeo, mats.jade);
      tick2.position.set(side * visorW * 0.42, 0, visorD * 0.85);
      tick2.scale.set(1, 0.55, 1);
      visorGroup.add(tick2);
    });

    eyesGroup.add(visorGroup);
    leftEye = visorGroup as unknown as THREE.Mesh;
  } else if (eyesId === "heart") {
    eyesKind = "heart";
    const buildHeart = (sign: number) => {
      const grp = new THREE.Group();
      const lobeGeo = new THREE.SphereGeometry(0.06, 18, 18);
      const lobeL = new THREE.Mesh(lobeGeo, mats.jade);
      lobeL.position.set(-0.04, 0.025, 0.0);
      const lobeR = new THREE.Mesh(lobeGeo, mats.jade);
      lobeR.position.set(0.04, 0.025, 0.0);
      grp.add(lobeL);
      grp.add(lobeR);
      const tri = new THREE.Shape();
      tri.moveTo(-0.07, 0.02);
      tri.lineTo(0.07, 0.02);
      tri.lineTo(0, -0.09);
      tri.lineTo(-0.07, 0.02);
      const triGeo = new THREE.ExtrudeGeometry(tri, {
        depth: 0.04,
        bevelEnabled: true,
        bevelSize: 0.008,
        bevelThickness: 0.008,
        bevelSegments: 3,
        curveSegments: 12,
      });
      grp.add(new THREE.Mesh(triGeo, mats.jade));
      grp.scale.set(1.75, 1.75, 1.75);
      grp.position.set(sign * EYE_SEP, 0, 0.05);
      eyesGroup.add(grp);
      return grp;
    };
    leftEye = buildHeart(-1) as unknown as THREE.Mesh;
    rightEye = buildHeart(1) as unknown as THREE.Mesh;
  } else if (eyesId === "single") {
    eyesKind = "single";
    const lensGeo = new THREE.SphereGeometry(0.19, 32, 32);
    leftEye = new THREE.Mesh(lensGeo, mats.jade);
    eyesGroup.add(leftEye);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 12, 48), mats.jade);
    eyesGroup.add(ring);
    rightEye = ring;
    const glint = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), mats.glint);
    glint.position.set(-0.055, 0.055, 0.17);
    eyesGroup.add(glint);
  } else if (eyesId === "pixel") {
    eyesKind = "pixel";
    const pxGeo = new THREE.BoxGeometry(0.16, 0.16, 0.05);
    leftEye = new THREE.Mesh(pxGeo, mats.jade);
    leftEye.position.set(-EYE_SEP, 0, 0.02);
    eyesGroup.add(leftEye);
    rightEye = new THREE.Mesh(pxGeo, mats.jade);
    rightEye.position.set(EYE_SEP, 0, 0.02);
    eyesGroup.add(rightEye);
  } else {
    eyesKind = "smile";
    /* Canonical smile arcs — the EXACT logo eye paths, extruded.
       Each geometry is built in a frame centered on its own eye anchor so
       blink (scale.y) and frown (negative scale.y) pivot correctly. */
    const eyeOpts = { depth: 0.045, bevel: 0.014, bevelSegments: 4, curveSegments: 16 };
    const leftGeo = extrudeLogoPath(
      PATH_EYE_LEFT_SMILE,
      { cx: LOGO_ANCHORS.eyeL.x, cy: LOGO_ANCHORS.eyeL.y, pxPerUnit: LOGO_FRAME.PX_PER_UNIT },
      eyeOpts,
    );
    leftEye = new THREE.Mesh(leftGeo, mats.jade);
    leftEye.position.set(-EYE_SEP, 0, 0.02);
    eyesGroup.add(leftEye);
    const rightGeo = extrudeLogoPath(
      PATH_EYE_RIGHT_SMILE,
      { cx: LOGO_ANCHORS.eyeR.x, cy: LOGO_ANCHORS.eyeR.y, pxPerUnit: LOGO_FRAME.PX_PER_UNIT },
      eyeOpts,
    );
    rightEye = new THREE.Mesh(rightGeo, mats.jade);
    rightEye.position.set(EYE_SEP, 0, 0.02);
    eyesGroup.add(rightEye);
  }

  /* ── 5. Headphones — anchored on the logo's ear-cap centers. ── */
  buildHeadphones(config.headphones ?? "bumper", innerGroup, mats);

  /* ── 6. Antenna — pivots where the stem meets the head bump. ── */
  const antennaGroup = new THREE.Group();
  innerGroup.add(antennaGroup);
  antennaGroup.position.set(logoX(LOGO_ANCHORS.antennaPivot.x), logoY(LOGO_ANCHORS.antennaPivot.y), 0);
  const antennaId = config.antenna ?? "jewel";
  let antennaTip: THREE.Mesh | null = null;
  const antennaFrame: LogoShapeFrame = {
    cx: LOGO_ANCHORS.antennaPivot.x,
    cy: LOGO_ANCHORS.antennaPivot.y,
    pxPerUnit: LOGO_FRAME.PX_PER_UNIT,
  };

  if (antennaId === "bunny") {
    [-1, 1].forEach((side) => {
      const stickGeo = extrude(capsuleShape(0.07, 0.42), 0.04, 0.012, 3);
      const stick = new THREE.Mesh(stickGeo, mats.jade);
      stick.position.set(side * 0.18, 0.16, 0.02);
      stick.rotation.z = side * 0.38;
      antennaGroup.add(stick);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 18), mats.jade);
      tip.position.set(side * 0.34, 0.36, 0.03);
      antennaGroup.add(tip);
      if (!antennaTip) antennaTip = tip;
    });
  } else if (antennaId === "beam") {
    const stickGeo = extrude(capsuleShape(0.05, 0.46), 0.04, 0.01, 3);
    const stick = new THREE.Mesh(stickGeo, mats.jade);
    stick.position.set(0, 0.2, 0.02);
    antennaGroup.add(stick);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 20), mats.jade);
    tip.position.set(0, 0.46, 0.03);
    antennaGroup.add(tip);
    antennaTip = tip;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.012, 8, 32), mats.jadeGlow);
    halo.rotation.x = Math.PI / 2;
    halo.position.copy(tip.position);
    antennaGroup.add(halo);
  } else if (antennaId === "wifi") {
    const base = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), mats.jade);
    base.position.set(0, 0.03, 0.02);
    antennaGroup.add(base);
    antennaTip = base;
    [0.15, 0.23, 0.31].forEach((r) => {
      const arc = new THREE.Mesh(new THREE.TorusGeometry(r, 0.018, 10, 24, Math.PI), mats.jade);
      arc.position.set(0, 0.03, 0.02);
      antennaGroup.add(arc);
    });
  } else if (antennaId !== "none") {
    /* Default jewel — the EXACT logo antenna: pill stem + two tilt lines. */
    const antOpts = { depth: 0.07, bevel: 0.02, bevelSegments: 4, curveSegments: 14 };
    const pill = new THREE.Mesh(extrudeLogoPath(PATH_ANTENNA_PILL, antennaFrame, antOpts), mats.jade);
    antennaGroup.add(pill);
    antennaTip = pill;
    const tiltL = new THREE.Mesh(extrudeLogoPath(PATH_ANTENNA_TILT_LEFT, antennaFrame, antOpts), mats.jadeStem);
    antennaGroup.add(tiltL);
    const tiltR = new THREE.Mesh(extrudeLogoPath(PATH_ANTENNA_TILT_RIGHT, antennaFrame, antOpts), mats.jadeStem);
    antennaGroup.add(tiltR);
  }

  /* ── 7. Aura (behind / around the head) ── */
  const auraGroup = new THREE.Group();
  root.add(auraGroup);
  const wingsId = config.wings ?? "none";
  const auraRefs: { r1?: THREE.Mesh; r2?: THREE.Mesh; r3?: THREE.Mesh; halo?: THREE.Mesh; orbits?: THREE.Mesh[]; kind: string } = { kind: wingsId };

  if (wingsId === "halo") {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.035, 12, 80), mats.jade);
    halo.rotation.x = Math.PI / 2.4;
    halo.position.set(0, 0.95, -0.2);
    auraGroup.add(halo);
    auraRefs.halo = halo;
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.02, 10, 64), mats.jade);
    inner.rotation.x = Math.PI / 2.4;
    inner.position.set(0, 0.95, -0.2);
    auraGroup.add(inner);
    [-1, 0, 1].forEach((i) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 14), mats.jade);
      const a = i * (Math.PI / 3) + Math.PI / 2;
      orb.position.set(Math.cos(a) * 1.0, 0.95 + Math.sin(a) * 0.38 - 0.05, -0.2);
      auraGroup.add(orb);
    });
  } else if (wingsId === "pulse") {
    // Shockwave ripples UNDER the floating bot — kept low so they never
    // cross the face the way a waist-height ring would.
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.025, 12, 80), mats.jade);
    r1.rotation.x = Math.PI / 2;
    r1.position.y = -0.95;
    auraGroup.add(r1);
    auraRefs.r1 = r1;
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.018, 12, 80), mats.jadeStem);
    r2.rotation.x = Math.PI / 2;
    r2.position.y = -0.98;
    auraGroup.add(r2);
    auraRefs.r2 = r2;
    const r3 = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.014, 10, 64), mats.jade);
    r3.rotation.x = Math.PI / 2;
    r3.rotation.z = Math.PI / 8;
    r3.position.y = -0.92;
    auraGroup.add(r3);
    auraRefs.r3 = r3;
  } else if (wingsId === "orbit") {
    const orbits: THREE.Mesh[] = [];
    [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3].forEach((phase) => {
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 18, 18), mats.jade);
      orb.position.set(Math.cos(phase) * 1.45, 0, Math.sin(phase) * 0.35);
      orb.userData.phase = phase;
      auraGroup.add(orb);
      orbits.push(orb);
    });
    auraRefs.orbits = orbits;
  }

  /* ── 8. Contact shadow — grounds the idle float. Counter-animated in the
     render loop so the shadow stays put while the bot bobs. ── */
  let shadow: THREE.Mesh | null = null;
  const shadowTex = createShadowTexture();
  if (shadowTex) {
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, SHADOW_Y, 0);
    root.add(shadow);
  }

  return {
    root,
    headGroup,
    innerGroup,
    shell,
    inset,
    ears: [earL, earR],
    eyesGroup,
    leftEye,
    rightEye,
    eyesKind,
    antennaGroup,
    antennaTip,
    auraGroup,
    auraRefs,
    shadow,
  };
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
      if (std.map && !seenTextures.has(std.map)) {
        seenTextures.add(std.map);
      }
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

  /** Normalized pointer position over the stage — drives head parallax. */
  const pointerRef = useRef({ x: 0, y: 0, active: false });

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
    renderer.toneMappingExposure = 1.15;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, clientWidth / clientHeight, 0.1, 100);
    camera.position.set(0, 0.12, 4.8);
    camera.lookAt(0, -0.02, 0);

    /* Lights — accent-tinted ones get recolored in the config effect. */
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x141210, 0.5);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(2.6, 4.2, 4.6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xb6d4ff, 0.4);
    fill.position.set(-3.6, 1.2, 2.6);
    scene.add(fill);
    const back = new THREE.DirectionalLight(0xffd9a3, 0.3);
    back.position.set(0, 2.6, -4);
    scene.add(back);
    const rim = new THREE.PointLight(0x00eaab, 1.0, 8);
    rim.position.set(0, -1.7, 2.1);
    scene.add(rim);
    const kicker = new THREE.PointLight(0x00eaab, 0.35, 6);
    kicker.position.set(0, 2.4, 1.6);
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

    /* Pointer-follow parallax — the bot subtly turns toward the cursor. */
    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerRef.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      pointerRef.current.active = true;
    };
    const onPointerLeave = () => {
      pointerRef.current.active = false;
    };
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
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
    r.ambient.intensity = light ? 0.42 : 0.3;
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
      const floatY = Math.sin(t * bounceSpeed) * bounceAmp + 0.02;
      r2.avatarGroup.position.y = floatY;
      const breath = 1 + Math.sin(t * 1.5) * 0.012;
      p.headGroup.scale.set(breath, breath, breath);

      // Contact shadow — counter-animate the float so the shadow stays
      // grounded, shrinking + fading as the bot rises.
      if (p.shadow) {
        p.shadow.position.y = SHADOW_Y - floatY;
        const s = 1 - floatY * 0.35;
        p.shadow.scale.set(s, s, s);
        (p.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.16, 0.34 - floatY * 0.6);
      }

      // Head pose — pointer parallax wins over idle drift when hovering
      const ptr = pointerRef.current;
      if (expression === "shake_head") {
        p.headGroup.rotation.y = Math.sin(t * 5) * 0.25;
      } else if (expression === "nod") {
        p.headGroup.rotation.x = Math.sin(t * 4) * 0.18;
      } else {
        const targetYaw = ptr.active ? ptr.x * 0.34 : Math.sin(t * 0.4) * 0.06;
        const targetPitch = headTiltX + (ptr.active ? ptr.y * 0.16 : 0);
        p.headGroup.rotation.y = THREE.MathUtils.lerp(p.headGroup.rotation.y, targetYaw, ptr.active ? 0.12 : 0.08);
        p.headGroup.rotation.x = THREE.MathUtils.lerp(p.headGroup.rotation.x, targetPitch, 0.08);
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
        if (p.auraRefs.r3) {
          const k3 = 1 + Math.sin(t * 1.8 + 1.0) * 0.04;
          p.auraRefs.r3.scale.set(k3 * 1.02, k3 * 1.02, k3 * 1.02);
          p.auraRefs.r3.rotation.z += 0.004;
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
