/**
 * AgentAvatarScene — Pixar-grade companion bot.
 *
 * Built around two ideas:
 *   1. A sculpted lathe-revolved body (organic silhouettes, no boxy primitives).
 *   2. A shader-driven face — eyes, brows and mouth all live in one fragment
 *      shader on a curved face plate. That's what gives the bot its life:
 *      the same surface can blink, saccade, track the cursor, and morph
 *      between expressions without ever swapping geometry.
 *
 * Only used for the large detail / editor preview (one instance at a time).
 * Card thumbnails use AgentAvatarSvg instead to avoid WebGL context exhaustion.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import * as THREE from "../../../lib/three-lite.js";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { DEFAULT_AGENT_AVATAR_CONFIG, ROBOT_BASE_COLOR_OPTIONS } from "../../lib/agent-avatar.js";
import { AgentAvatarSvg } from "./AgentAvatarSvg.js";

interface AgentAvatarSceneProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  fallbackMode?: boolean;
}

/* ════════════════════════════════════════════════════════════════════
 *  Color helpers
 * ════════════════════════════════════════════════════════════════════ */

const ACCENT_COLORS: Record<string, number> = {
  jade: 0x00e0a0,
  amber: 0xffb800,
  violet: 0x8b5cf6,
  coral: 0xff6b6b,
  sky: 0x38bdf8,
  pink: 0xf472b6,
};

function accentHex(id?: string): number {
  return ACCENT_COLORS[id ?? "jade"] ?? 0x00e0a0;
}

const BASE_COLORS: Record<string, number> = {};
for (const opt of ROBOT_BASE_COLOR_OPTIONS) {
  BASE_COLORS[opt.id] = parseInt(opt.hex.slice(1), 16);
}
function baseColorHex(id?: string): number {
  return BASE_COLORS[id ?? "ivory"] ?? 0xe8e4dc;
}

function isLightBase(id?: string): boolean {
  // "ivory" and "arctic" are the light tones — drives face-plate contrast
  return id === "ivory" || id === "arctic";
}

function shiftColor(color: number, factor: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 0xff) * (1 + factor))));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 0xff) * (1 + factor))));
  const b = Math.max(0, Math.min(255, Math.round((color & 0xff) * (1 + factor))));
  return (r << 16) | (g << 8) | b;
}

/* ════════════════════════════════════════════════════════════════════
 *  Procedural environment map — gives the clearcoat something to reflect
 * ════════════════════════════════════════════════════════════════════ */
function createEnvMap(): THREE.CubeTexture | null {
  try {
    const size = 64;
    const faces: HTMLCanvasElement[] = [];
    const palette = [
      [0x18, 0x1a, 0x2a, 0x2a, 0x2e, 0x42], // +x
      [0x14, 0x16, 0x24, 0x22, 0x26, 0x38], // -x
      [0x32, 0x36, 0x4c, 0x18, 0x1a, 0x2a], // +y top — brighter
      [0x08, 0x09, 0x12, 0x10, 0x12, 0x1e], // -y bottom — darker
      [0x1c, 0x1e, 0x30, 0x26, 0x2a, 0x40], // +z
      [0x16, 0x18, 0x28, 0x20, 0x24, 0x36], // -z
    ];
    for (let f = 0; f < 6; f++) {
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof ctx.createLinearGradient !== "function") return null;
      const c = palette[f];
      const grad = ctx.createLinearGradient(0, 0, 0, size);
      grad.addColorStop(0, `rgb(${c[0]},${c[1]},${c[2]})`);
      grad.addColorStop(1, `rgb(${c[3]},${c[4]},${c[5]})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
      // Soft "light source" hotspot on the +y face for natural specular
      if (f === 2) {
        const radial = ctx.createRadialGradient(size * 0.5, size * 0.3, 2, size * 0.5, size * 0.3, size * 0.6);
        radial.addColorStop(0, "rgba(255,255,255,0.55)");
        radial.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, size, size);
      }
      // micro-grain
      for (let i = 0; i < 220; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.06})`;
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

/** Soft radial alpha ramp — used for the contact shadow on the ground. */
function createShadowTexture(): THREE.CanvasTexture | null {
  try {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx || typeof ctx.createRadialGradient !== "function") return null;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.55, "rgba(0,0,0,0.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  } catch {
    return null;
  }
}

/* ════════════════════════════════════════════════════════════════════
 *  Materials
 *  - Body uses MeshPhysicalMaterial w/ clearcoat for that "polished plastic
 *    toy" Pixar feel. Trim is brushed metal. Accent is emissive standard.
 * ════════════════════════════════════════════════════════════════════ */
function makeMaterials(
  accent: number,
  baseColor: number,
  envMap: THREE.CubeTexture | null,
  isLight: boolean,
) {
  const trimColor = isLight ? shiftColor(baseColor, -0.35) : shiftColor(baseColor, 0.55);
  const innerColor = isLight ? shiftColor(baseColor, -0.08) : shiftColor(baseColor, 0.18);

  const body = new THREE.MeshPhysicalMaterial({
    color: baseColor,
    metalness: 0.05,
    roughness: 0.32,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    envMap,
    envMapIntensity: 0.85,
  });

  const bodySoft = new THREE.MeshPhysicalMaterial({
    color: innerColor,
    metalness: 0.08,
    roughness: 0.45,
    clearcoat: 0.6,
    clearcoatRoughness: 0.18,
    envMap,
    envMapIntensity: 0.55,
  });

  const trim = new THREE.MeshStandardMaterial({
    color: trimColor,
    metalness: 0.85,
    roughness: 0.18,
    envMap,
    envMapIntensity: 1.1,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.55,
    metalness: 0.3,
    roughness: 0.28,
    envMap,
    envMapIntensity: 0.4,
  });

  const accentGlow = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.95,
  });

  const facePlate = new THREE.MeshPhysicalMaterial({
    color: 0x0c0d18,
    metalness: 0.0,
    roughness: 0.18,
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMap,
    envMapIntensity: 0.7,
  });

  return { body, bodySoft, trim, accentMat, accentGlow, facePlate };
}

/* ════════════════════════════════════════════════════════════════════
 *  Lathe profiles — half-silhouettes, revolved 360°.
 *
 *  Design rules for trustworthy / Pixar-grade silhouettes:
 *    1. Bottom-heavy (lower-third weighted) — reads as stable / grounded.
 *    2. Smooth C2 curves, no kinks — the eye trusts continuity.
 *    3. Distinct silhouettes readable at thumbnail size.
 *    4. A subtle "shoulder" 60–70% up the body where the face socket sits,
 *       so the face has a visual home without needing a hard neck pinch.
 * ════════════════════════════════════════════════════════════════════ */
function chassisProfile(chassis?: string): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const push = (r: number, y: number) => pts.push(new THREE.Vector2(Math.max(0.001, r), y));

  switch (chassis) {
    case "egg": {
      // "Companion" — classic EVE-egg, tall, elegant, bottom-heavy pear.
      const samples = 40;
      const yMin = -1.30, yMax = 1.45;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const y = yMin + t * (yMax - yMin);
        // base superellipse silhouette (sine envelope, slightly squashed top)
        const env = Math.pow(Math.sin(t * Math.PI), 1.15);
        // pear bias: wider at lower third (t≈0.35), narrower at top
        const pear = 1.0 + 0.18 * Math.exp(-Math.pow((t - 0.32) * 4.0, 2));
        const taper = 1.0 - 0.10 * Math.max(0, t - 0.5);
        const r = env * pear * taper * 0.92;
        push(r, y);
      }
      return pts;
    }
    case "capsule": {
      // "Pod" — sleek tall capsule with subtle waist, narrow shoulders.
      const samples = 36;
      const yMin = -1.45, yMax = 1.45;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const y = yMin + t * (yMax - yMin);
        const env = Math.pow(Math.sin(t * Math.PI), 0.62);
        // gentle waist around mid-body
        const waist = 1.0 - 0.06 * Math.exp(-Math.pow((t - 0.55) * 5.0, 2));
        // bottom-heavy bias
        const heavy = 1.0 + 0.08 * Math.exp(-Math.pow((t - 0.28) * 4.0, 2));
        const r = env * waist * heavy * 0.78;
        push(r, y);
      }
      return pts;
    }
    case "square": {
      // "Bumper" — wide drum with rounded shoulders and a small head dome.
      // Two-stage profile: wide low body, gentle neck, small dome head on top.
      const samples = 44;
      const yMin = -1.10, yMax = 1.55;
      const range = yMax - yMin;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const y = yMin + t * range;
        // body region [0, 0.62]: rounded drum, peak radius near t=0.30
        // neck region [0.62, 0.74]: smooth narrow
        // head region [0.74, 1.0]: small dome
        let r: number;
        if (t < 0.62) {
          const tt = t / 0.62;
          // half-cosine drum: wide at base, gently narrowing
          r = 1.22 * (0.92 + 0.12 * Math.sin(tt * Math.PI));
          // soft bottom rounding
          r *= Math.pow(Math.sin(Math.min(1, tt * 1.6) * Math.PI * 0.5), 0.35);
        } else if (t < 0.74) {
          // smooth interpolation from body radius to neck
          const tt = (t - 0.62) / 0.12;
          const bodyR = 1.22 * (0.92 + 0.12 * Math.sin(Math.PI));
          const neckR = 0.62;
          r = bodyR + (neckR - bodyR) * (3 * tt * tt - 2 * tt * tt * tt); // smoothstep
        } else {
          // head dome
          const tt = (t - 0.74) / 0.26;
          const headEnv = Math.pow(Math.sin(tt * Math.PI), 0.85);
          r = 0.68 * headEnv + 0.001;
        }
        push(r, y);
      }
      return pts;
    }
    default: {
      // "Pebble" — friendly grounded river-stone with a small dome head.
      // One-piece silhouette but with a clear "shoulder + head" feel.
      const samples = 44;
      const yMin = -1.10, yMax = 1.40;
      const range = yMax - yMin;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const y = yMin + t * range;
        let r: number;
        if (t < 0.55) {
          // body — pebble bottom, max around t=0.30
          const tt = t / 0.55;
          const env = Math.pow(Math.sin(tt * Math.PI * 0.8 + 0.3), 0.55);
          r = 1.05 * env;
        } else if (t < 0.66) {
          // soft neck — smoothstep from body to head radius
          const tt = (t - 0.55) / 0.11;
          const bodyR = 1.05 * Math.pow(Math.sin(Math.PI * 0.8 + 0.3), 0.55);
          const headR = 0.78;
          r = bodyR + (headR - bodyR) * (3 * tt * tt - 2 * tt * tt * tt);
        } else {
          // head dome
          const tt = (t - 0.66) / 0.34;
          const env = Math.pow(Math.sin(tt * Math.PI), 0.72);
          r = 0.78 * env + 0.001;
        }
        push(r, y);
      }
      return pts;
    }
  }
}

/**
 * Compute (faceY, faceR, visibleR) for the face socket on a given profile.
 *
 * Two key constraints:
 *   1. Anchor latitude is per-chassis tuned — for egg/pod we sit at the
 *      upper-middle where the body is widest (EVE-style "face on the front
 *      of the body"); for chassis with a clear head (pebble/bumper) we sit
 *      on the head dome.
 *   2. visibleR is *capped* so the visible face disc cannot clip into a
 *      wider body region: we walk every other profile point and shrink
 *      visibleR until any wider neighbour is at least `visibleR / 0.95`
 *      away in Y. This is the geometric guarantee that nothing pokes
 *      through, regardless of pose.
 */
function faceAnchor(
  profile: THREE.Vector2[],
  chassis?: string,
): { y: number; r: number; visibleR: number } {
  let targetT: number;
  let visibleMul: number;
  switch (chassis) {
    case "egg":     targetT = 0.55; visibleMul = 0.55; break; // upper-mid (EVE)
    case "capsule": targetT = 0.60; visibleMul = 0.60; break;
    case "square":  targetT = 0.90; visibleMul = 0.70; break; // head dome
    default:        targetT = 0.84; visibleMul = 0.62; break; // pebble head
  }
  const idx = Math.max(0, Math.min(profile.length - 1, Math.round(profile.length * targetT)));
  const p = profile[idx];

  let visibleR = p.x * visibleMul;
  // Safety cap: if any other profile point is wider, ensure the disc edge
  // can't reach that latitude.
  for (let i = 0; i < profile.length; i++) {
    if (i === idx) continue;
    const dy = Math.abs(profile[i].y - p.y);
    if (profile[i].x > p.x && dy > 0.001) {
      visibleR = Math.min(visibleR, dy * 0.92);
    }
  }
  visibleR = Math.max(0.30, visibleR);
  return { y: p.y, r: p.x, visibleR };
}

/**
 * Build a *curved* face plate. PlaneGeometry vertices are pushed back along
 * Z by a smooth radial fall-off, producing a forward-bulging dome:
 *   - centre stays at z=0 (most forward)
 *   - rim curves back to z = -depth
 * UVs stay 0..1 (rectangular), so the SDF face shader still works.
 *
 * The dome shape is what stops the plate from slicing through the body —
 * its lower edge naturally curves backward, following the body's curvature
 * rather than poking through it.
 */
function makeCurvedFacePlate(visibleR: number, depth: number): THREE.PlaneGeometry {
  // halfSize chosen so visibleR maps to 0.92 in normalized coords (matches
  // the shader's plate mask at length(p) - 0.92).
  const halfSize = visibleR / 0.92;
  const segs = 28;
  const geo = new THREE.PlaneGeometry(halfSize * 2, halfSize * 2, segs, segs);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const r = Math.min(1, Math.sqrt(x * x + y * y) / halfSize);
    // Cosine fall-off: smooth and tangent-flat at the rim → the dome
    // hugs the body cleanly without a visible crease where it ends.
    const z = -depth * (1 - Math.cos(r * Math.PI / 2));
    pos.setZ(i, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ════════════════════════════════════════════════════════════════════
 *  Face shader — the soul of the bot
 *  Renders eyes / brows / mouth as a single SDF on a curved face plate.
 *  All expression morphing happens in shader uniforms — no geometry swaps.
 * ════════════════════════════════════════════════════════════════════ */

const FACE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FACE_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uBlink;          // 0 open, 1 closed
  uniform vec2  uPupilOffset;    // -1..1 in each axis
  uniform vec3  uAccent;
  uniform vec3  uEyeWhite;
  uniform float uEyeStyle;       // 0 dual, 1 visor, 2 pixel, 3 cyclops
  uniform float uExpression;     // 0 happy, 1 sad, 2 angry, 3 sleepy, 4 bored, 5 hyped, 6 neutral
  uniform float uMouthOpen;      // 0..1 (talk pulse)

  float sdCircle(vec2 p, float r) { return length(p) - r; }

  float sdRoundBox(vec2 p, vec2 b, float r) {
    vec2 q = abs(p) - b + r;
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  // Smile/frown curve — y as a function of x in [-1,1]; positive curl = smile
  float mouthCurve(float x, float curl) {
    return curl * (1.0 - x * x);
  }

  // Anti-aliased fill: 1 inside, 0 outside, smooth transition over fwidth
  float aa(float d) {
    return 1.0 - smoothstep(-0.004, 0.004, d);
  }

  void main() {
    // Center-origin coordinates; X positive right, Y positive up
    vec2 p = (vUv - 0.5) * 2.0;
    p.x *= 1.0;        // face plate is roughly square in UV
    p.y *= 1.0;

    vec3 col = vec3(0.04, 0.05, 0.10);   // deep face-plate background
    float alpha = 0.0;                    // we composite onto the plate

    // ── Subtle scanline shimmer for the "screen" feel ──────────────
    float scan = 0.5 + 0.5 * sin(p.y * 80.0 + uTime * 1.2);
    col += vec3(0.01, 0.012, 0.02) * scan;

    // ── Expression flags ───────────────────────────────────────────
    bool isHappy   = uExpression < 0.5;
    bool isSad     = uExpression > 0.5 && uExpression < 1.5;
    bool isAngry   = uExpression > 1.5 && uExpression < 2.5;
    bool isSleepy  = uExpression > 2.5 && uExpression < 3.5;
    bool isBored   = uExpression > 3.5 && uExpression < 4.5;
    bool isHyped   = uExpression > 4.5 && uExpression < 5.5;

    // ── Per-expression eye shape modulation ────────────────────────
    float squintTop    = 0.0;             // crops the top of each eye
    float squintBottom = 0.0;             // crops the bottom
    float eyeScaleY    = 1.0;
    float browTilt     = 0.0;             // radians, applied symmetrically
    float pupilSize    = 0.36;
    float mouthCurl    = 0.0;             // -1..1
    float mouthWidth   = 0.55;
    float mouthThick   = 0.06;
    float cheekGlow    = 0.0;
    float browYOffset  = 0.0;

    if (isHappy)  { squintBottom = 0.45; eyeScaleY = 0.85; mouthCurl = 0.42; mouthWidth = 0.55; cheekGlow = 0.55; pupilSize = 0.40; }
    if (isSad)    { squintTop = 0.25; eyeScaleY = 0.92; mouthCurl = -0.35; mouthWidth = 0.42; browTilt = -0.55; browYOffset = 0.04; pupilSize = 0.40; }
    if (isAngry)  { squintTop = 0.55; eyeScaleY = 0.65; mouthCurl = -0.20; mouthWidth = 0.38; browTilt = 0.75; browYOffset = -0.02; pupilSize = 0.34; }
    if (isSleepy) { squintTop = 0.78; squintBottom = 0.05; eyeScaleY = 0.3; mouthCurl = 0.05; mouthWidth = 0.30; pupilSize = 0.30; }
    if (isBored)  { squintTop = 0.55; squintBottom = 0.10; eyeScaleY = 0.55; mouthCurl = 0.0; mouthWidth = 0.46; mouthThick = 0.04; pupilSize = 0.32; }
    if (isHyped)  { eyeScaleY = 1.15; mouthCurl = 0.55; mouthWidth = 0.62; cheekGlow = 0.7; pupilSize = 0.42; }

    // ── Blink overrides ────────────────────────────────────────────
    float lid = clamp(uBlink + squintTop, 0.0, 1.0);

    // ── Eye centers based on style ─────────────────────────────────
    float style = uEyeStyle;
    vec2 leftCenter  = vec2(-0.42,  0.10);
    vec2 rightCenter = vec2( 0.42,  0.10);
    float baseR = 0.30;

    if (style > 0.5 && style < 1.5) {
      // visor — single horizontal screen w/ two pupils riding inside
      leftCenter  = vec2(-0.35, 0.05);
      rightCenter = vec2( 0.35, 0.05);
      baseR = 0.22;
    } else if (style > 1.5 && style < 2.5) {
      // pixel — small square eyes
      leftCenter  = vec2(-0.40, 0.08);
      rightCenter = vec2( 0.40, 0.08);
      baseR = 0.22;
    } else if (style > 2.5) {
      // cyclops — single big eye
      leftCenter  = vec2(0.0, 0.08);
      rightCenter = vec2(0.0, 0.08); // unused
      baseR = 0.46;
    }

    // ── Helper: render one eye at center c with radius r ───────────
    // Returns vec4(rgb, alpha) contribution
    // Apply a tiny vertical squash for natural roundness on the curved plate.
    // Done inline so we can branch on style cleanly without a function call.

    // ─ Visor variant: rounded rectangle with two pupils ─
    if (style > 0.5 && style < 1.5) {
      float dVisor = sdRoundBox(p - vec2(0.0, 0.05), vec2(0.62, 0.16), 0.13);
      float visorMask = aa(dVisor);

      // accent inner glow
      vec3 visorCol = mix(vec3(0.0), uAccent, 0.85);
      // rim brightening
      visorCol += uAccent * smoothstep(0.05, -0.05, dVisor) * 0.4;

      col = mix(col, visorCol, visorMask);
      alpha = max(alpha, visorMask);

      // pupils inside visor
      vec2 pl = p - leftCenter  - uPupilOffset * 0.06;
      vec2 pr = p - rightCenter - uPupilOffset * 0.06;
      pl.y *= 1.6; pr.y *= 1.6;
      float pupL = aa(sdCircle(pl, 0.085));
      float pupR = aa(sdCircle(pr, 0.085));
      col = mix(col, vec3(0.02, 0.03, 0.06), pupL * (1.0 - lid));
      col = mix(col, vec3(0.02, 0.03, 0.06), pupR * (1.0 - lid));

      // visor-wide horizontal scan
      float scanLine = smoothstep(0.0, 0.02, abs(p.y - sin(uTime * 0.8) * 0.08));
      col += uAccent * (1.0 - scanLine) * visorMask * 0.15;
    }
    // ─ Pixel variant: chunky square eyes ─
    else if (style > 1.5 && style < 2.5) {
      vec2 pl = p - leftCenter;
      vec2 pr = p - rightCenter;
      pl.y /= max(eyeScaleY, 0.05);
      pr.y /= max(eyeScaleY, 0.05);
      float dl = sdRoundBox(pl, vec2(0.16, 0.16), 0.05);
      float dr = sdRoundBox(pr, vec2(0.16, 0.16), 0.05);
      // lid descent: cuts the top
      float lidCutL = step(pl.y, 0.16 - lid * 0.32);
      float lidCutR = step(pr.y, 0.16 - lid * 0.32);
      float ml = aa(dl) * lidCutL;
      float mr = aa(dr) * lidCutR;
      // glow body
      vec3 eyeCol = uAccent * 1.1;
      // soft rim
      eyeCol += uAccent * 0.4 * smoothstep(0.06, -0.06, dl);
      col = mix(col, eyeCol, ml);
      eyeCol = uAccent * 1.1 + uAccent * 0.4 * smoothstep(0.06, -0.06, dr);
      col = mix(col, eyeCol, mr);
      alpha = max(alpha, max(ml, mr));
    }
    // ─ Cyclops variant: one large screen-eye ─
    else if (style > 2.5) {
      vec2 pc = p - leftCenter;
      pc.y /= max(eyeScaleY, 0.05);
      float d  = sdCircle(pc, baseR);
      float lidCut = step(pc.y, baseR - lid * baseR * 2.0);
      lidCut *= step(-baseR + squintBottom * baseR, pc.y);
      float m = aa(d) * lidCut;

      // sclera with subtle radial gradient
      vec3 sclera = mix(vec3(0.95, 0.97, 1.0), vec3(0.78, 0.85, 0.95), smoothstep(0.0, baseR, length(pc)));
      col = mix(col, sclera, m);

      // iris ring
      vec2 irisP = pc - uPupilOffset * 0.10;
      float iris = aa(sdCircle(irisP, baseR * 0.55));
      vec3 irisCol = mix(uAccent * 0.8, uAccent * 0.35, smoothstep(0.0, baseR * 0.55, length(irisP)));
      col = mix(col, irisCol, iris * lidCut);

      // pupil
      float pupil = aa(sdCircle(irisP, baseR * pupilSize));
      col = mix(col, vec3(0.02, 0.03, 0.06), pupil * lidCut);

      // glint
      float glint = aa(sdCircle(irisP - vec2(baseR * 0.18, -baseR * 0.18), baseR * 0.10));
      col = mix(col, vec3(1.0), glint * lidCut * 0.95);
      // secondary tiny glint
      float glint2 = aa(sdCircle(irisP - vec2(-baseR * 0.20, -baseR * 0.05), baseR * 0.045));
      col = mix(col, vec3(1.0), glint2 * lidCut * 0.7);

      alpha = max(alpha, m);
    }
    // ─ Default: dual eyes ─
    else {
      // Compute both eyes
      for (int i = 0; i < 2; i++) {
        vec2 c = (i == 0) ? leftCenter : rightCenter;
        vec2 pe = p - c;
        pe.y /= max(eyeScaleY, 0.05);

        float r = baseR;
        float d = sdCircle(pe, r);

        // Eyelid: a top-down cut at y = r - lid*r*2
        float topCut    = step(pe.y, r - lid * r * 2.0);
        float bottomCut = step(-r + squintBottom * r, pe.y);
        float lidCut    = topCut * bottomCut;

        float m = aa(d) * lidCut;

        // soft accent rim glow (subsurface feel)
        float rimGlow = smoothstep(0.06, -0.04, d) * lidCut;
        col += uAccent * rimGlow * 0.18;

        // sclera w/ inner blue-ish gradient
        vec3 sclera = mix(uEyeWhite, uEyeWhite * 0.78, smoothstep(0.0, r, length(pe)));
        col = mix(col, sclera, m);

        // iris
        vec2 ip = pe - uPupilOffset * 0.09;
        float iris = aa(sdCircle(ip, r * 0.62));
        vec3 irisCol = mix(uAccent, uAccent * 0.45, smoothstep(0.0, r * 0.62, length(ip)));
        col = mix(col, irisCol, iris * lidCut);

        // pupil
        float pupil = aa(sdCircle(ip, r * pupilSize));
        col = mix(col, vec3(0.02, 0.03, 0.06), pupil * lidCut);

        // primary glint
        float glint = aa(sdCircle(ip - vec2(r * 0.22, -r * 0.20), r * 0.13));
        col = mix(col, vec3(1.0), glint * lidCut * 0.95);
        // secondary glint
        float glint2 = aa(sdCircle(ip - vec2(-r * 0.18, 0.0), r * 0.05));
        col = mix(col, vec3(1.0), glint2 * lidCut * 0.65);

        // closed-eye line when lid is fully down
        if (lid > 0.85) {
          float lineY = r - lid * r * 2.0;
          float line = smoothstep(0.012, 0.0, abs(pe.y - lineY)) * step(abs(pe.x), r);
          col = mix(col, uAccent * 0.7, line);
        }

        alpha = max(alpha, m);
      }
    }

    // ── Brows (only for emotive expressions; skip on visor/pixel) ──
    if (style < 0.5 || style > 2.5) {
      if (abs(browTilt) > 0.001) {
        for (int i = 0; i < 2; i++) {
          float side = (i == 0) ? -1.0 : 1.0;
          vec2 bc = vec2(side * 0.42, 0.46 + browYOffset);
          // rotate the brow line around its center by browTilt * side
          float ang = browTilt * side;
          float ca = cos(ang), sa = sin(ang);
          vec2 pb = p - bc;
          pb = mat2(ca, -sa, sa, ca) * pb;
          float browD = sdRoundBox(pb, vec2(0.16, 0.025), 0.022);
          float browM = aa(browD);
          col = mix(col, vec3(0.02, 0.02, 0.05), browM);
          alpha = max(alpha, browM);
        }
      }
    }

    // ── Cheeks (warm blush for happy / hyped) ──────────────────────
    if (cheekGlow > 0.001) {
      float lc = sdCircle(p - vec2(-0.62, -0.25), 0.14);
      float rc = sdCircle(p - vec2( 0.62, -0.25), 0.14);
      float cm = aa(lc) + aa(rc);
      col += vec3(1.0, 0.55, 0.55) * cm * cheekGlow * 0.45;
    }

    // ── Mouth ──────────────────────────────────────────────────────
    {
      float mx = p.x / mouthWidth;
      if (abs(mx) <= 1.0) {
        float yC = -0.55 + mouthCurve(mx, mouthCurl) * 0.18;
        float dy = abs(p.y - yC);
        float thick = mouthThick + uMouthOpen * 0.08;
        float lineM = smoothstep(thick, thick - 0.018, dy);
        // bored: just a flat line, sleepy: subtle
        col = mix(col, uAccent * 0.95, lineM);
        // mouth-open inner glow
        if (uMouthOpen > 0.05 && abs(mouthCurl) < 0.6) {
          float inside = smoothstep(thick * 0.4, 0.0, dy);
          col = mix(col, uAccent * 0.4, inside * uMouthOpen * 0.6);
        }
        alpha = max(alpha, lineM);
      }
    }

    // ── Plate mask: a clean circular screen embedded in the body.
    //    A real bezel torus sits in front of this plate (3D mesh), so the
    //    shader only needs to clip the visible disc and add a soft inner
    //    vignette + glass-dome top sheen.
    float plateR = 0.92;
    float plateD = length(p) - plateR;
    float plateMask = smoothstep(0.02, -0.02, plateD);

    // Inner vignette → darker toward the rim, gives the screen depth.
    float innerVign = smoothstep(plateR, 0.0, length(p));
    col *= 0.55 + 0.45 * innerVign;

    // Glass-dome arc highlight: bright crescent at the top, gives the
    //   "polished glass over the screen" Pixar-grade gloss.
    vec2 gp = p - vec2(0.0, 0.42);
    float arc = smoothstep(0.62, 0.55, length(gp)) - smoothstep(0.55, 0.48, length(gp));
    col += vec3(1.0) * arc * 0.22;
    // Secondary thin highlight just inside the rim
    float rimHi = smoothstep(plateR - 0.04, plateR - 0.10, length(p))
                - smoothstep(plateR - 0.10, plateR - 0.16, length(p));
    col += vec3(1.0) * rimHi * 0.10;

    // Bottom soft-shadow inside the screen — sells the recessed feel.
    float bottomShade = smoothstep(-0.6, -0.95, p.y) * 0.35;
    col *= (1.0 - bottomShade);

    gl_FragColor = vec4(col, plateMask);
  }
`;

function makeFaceMaterial(accent: number): THREE.ShaderMaterial {
  const a = new THREE.Color(accent);
  return new THREE.ShaderMaterial({
    vertexShader: FACE_VERT,
    fragmentShader: FACE_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uBlink: { value: 0 },
      uPupilOffset: { value: new THREE.Vector2(0, 0) },
      uAccent: { value: new THREE.Vector3(a.r, a.g, a.b) },
      uEyeWhite: { value: new THREE.Vector3(0.96, 0.97, 1.0) },
      uEyeStyle: { value: 0 },
      uExpression: { value: 6 },
      uMouthOpen: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
  });
}

function eyeStyleIndex(eyes?: string): number {
  switch (eyes) {
    case "visor": return 1;
    case "pixel": return 2;
    case "cyclops": return 3;
    default: return 0; // dual
  }
}

function expressionIndex(expr: AgentAvatarExpression): number {
  switch (expr) {
    case "happy": return 0;
    case "sad": return 1;
    case "angry": return 2;
    case "sleepy": return 3;
    case "bored": return 4;
    case "hyped": return 5;
    default: return 6; // neutral / nod / shake_head — neutral face
  }
}

/* ════════════════════════════════════════════════════════════════════
 *  Builders — chassis, antenna, hands, halo, contact shadow
 * ════════════════════════════════════════════════════════════════════ */

interface BuiltChassis {
  group: THREE.Group;
  bodyMesh: THREE.Mesh;
  faceMesh: THREE.Mesh;
  faceMaterial: THREE.ShaderMaterial;
  chestPip: THREE.Mesh;
}

function buildChassis(
  chassis: string | undefined,
  accent: number,
  mats: ReturnType<typeof makeMaterials>,
): BuiltChassis {
  const group = new THREE.Group();

  const profile = chassisProfile(chassis);
  const lathe = new THREE.LatheGeometry(profile, 80);
  const bodyMesh = new THREE.Mesh(lathe, mats.body);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Find body equator (widest point) for accent details.
  let maxR = 0, yAtMax = 0;
  for (const v of profile) {
    if (v.x > maxR) { maxR = v.x; yAtMax = v.y; }
  }

  // Face anchor — chosen per chassis to land on the head region.
  const anchor = faceAnchor(profile, chassis);
  const faceY = anchor.y;
  const faceR = anchor.r;

  /* ── FACE SOCKET ───────────────────────────────────────────────────
   * Pixar-grade screens read as INSET, not stuck-on. We achieve that with
   * a four-layer build:
   *   1. Recess cup     — a short dark cylinder ring "carved" into the
   *                        head surface. Adds visual depth behind the bezel.
   *   2. Bezel torus    — brushed-metal frame that sits proud of the
   *                        body surface (this is what catches highlight and
   *                        reads as "the screen frame").
   *   3. Face plate     — the shader-rendered screen, sunk back behind
   *                        the bezel so the rim casts visual depth onto it.
   *   4. Halo ring      — a faint accent-colored glow OUTSIDE the bezel
   *                        on the head, ties the screen to the body palette.
   * The whole stack tilts slightly upward so the bot reads as looking at
   * the viewer warmly, not staring straight ahead.
   */

  // Visible disc radius (must match the shader's plateR=0.92 in NDC of the
  // plate plane). Plate plane width = visibleR / 0.92 * 2.
  const visibleR = Math.max(0.42, faceR * 0.78);
  const plateSize = (visibleR / 0.92) * 2;

  // Socket parent group — gives the whole face a slight upward tilt so the
  // bot has a friendly, slightly-looking-up posture (a Pixar charm trick).
  const socket = new THREE.Group();
  socket.position.set(0, faceY, faceR - 0.02);
  socket.rotation.x = 0.08;
  group.add(socket);

  // 1. Recess cup — a thin dark disc behind the bezel that simulates a
  //    cavity in the body. Slight inward push.
  const recessGeo = new THREE.CircleGeometry(visibleR + 0.06, 64);
  const recessMat = new THREE.MeshStandardMaterial({
    color: 0x05060a,
    metalness: 0.2,
    roughness: 0.55,
  });
  const recess = new THREE.Mesh(recessGeo, recessMat);
  recess.position.set(0, 0, -0.05);
  socket.add(recess);

  // 2. Bezel torus — sits proud of the surface, the most important depth cue.
  //    Two-tone: an outer brushed-metal ring + a thin inner accent piping.
  const bezelOuter = new THREE.TorusGeometry(visibleR + 0.07, 0.045, 14, 96);
  const bezel = new THREE.Mesh(bezelOuter, mats.trim);
  bezel.position.set(0, 0, 0.005);
  socket.add(bezel);

  const bezelInner = new THREE.TorusGeometry(visibleR + 0.005, 0.012, 8, 96);
  const bezelAccent = new THREE.Mesh(bezelInner, mats.accentMat);
  bezelAccent.position.set(0, 0, 0.012);
  socket.add(bezelAccent);

  // 3. Face plate — recessed behind the bezel rim.
  const plateGeo = new THREE.PlaneGeometry(plateSize, plateSize, 1, 1);
  const faceMaterial = makeFaceMaterial(accent);
  faceMaterial.uniforms.uEyeStyle.value = 0;
  const faceMesh = new THREE.Mesh(plateGeo, faceMaterial);
  faceMesh.position.set(0, 0, -0.02);
  socket.add(faceMesh);

  // 4. Halo glow — soft accent ring just outside the bezel on the body.
  const haloGeo = new THREE.RingGeometry(visibleR + 0.13, visibleR + 0.30, 64);
  const haloMat = new THREE.MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeo, haloMat);
  halo.position.set(0, 0, -0.08);
  socket.add(halo);

  /* ── Body accents ──────────────────────────────────────────────── */

  // Equator accent ring — thin metallic stripe at the widest body point
  const equatorR = maxR * 0.998;
  const equatorGeo = new THREE.TorusGeometry(equatorR, 0.014, 8, 120);
  const equator = new THREE.Mesh(equatorGeo, mats.trim);
  equator.rotation.x = Math.PI / 2;
  equator.position.y = yAtMax;
  group.add(equator);

  // Three small accent pips on the chest below the equator — manufactured detail
  const pipGroup = new THREE.Group();
  const pipBaseY = yAtMax - Math.max(0.22, maxR * 0.32);
  const pipR = Math.min(0.55, maxR * 0.6);
  for (let i = 0; i < 3; i++) {
    const angle = (i - 1) * 0.32;
    const pipGeo = new THREE.SphereGeometry(0.045, 14, 14);
    const pip = new THREE.Mesh(pipGeo, mats.accentMat);
    pip.position.set(Math.sin(angle) * pipR, pipBaseY, Math.cos(angle) * pipR);
    pipGroup.add(pip);
  }
  group.add(pipGroup);
  // Use the central pip for the "heartbeat" pulse animation.
  const chestPip = pipGroup.children[1] as THREE.Mesh;

  return { group, bodyMesh, faceMesh, faceMaterial, chestPip };
}

function buildAntenna(
  type: string | undefined,
  parent: THREE.Object3D,
  topY: number,
  mats: ReturnType<typeof makeMaterials>,
): THREE.Group {
  const group = new THREE.Group();
  group.position.y = topY;

  switch (type) {
    case "dual": {
      [-0.28, 0.28].forEach((x) => {
        const stickGeo = new THREE.CapsuleGeometry(0.025, 0.42, 4, 8);
        const stick = new THREE.Mesh(stickGeo, mats.trim);
        stick.position.set(x, 0.25, 0);
        stick.rotation.z = x > 0 ? -0.2 : 0.2;
        group.add(stick);
        const tipGeo = new THREE.SphereGeometry(0.075, 16, 16);
        const tip = new THREE.Mesh(tipGeo, mats.accentMat);
        tip.position.set(0, 0.26, 0);
        stick.add(tip);
      });
      break;
    }
    case "dish": {
      const stickGeo = new THREE.CapsuleGeometry(0.03, 0.28, 4, 8);
      const stick = new THREE.Mesh(stickGeo, mats.trim);
      stick.position.set(0, 0.18, 0);
      group.add(stick);
      const dishGeo = new THREE.SphereGeometry(0.22, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2.2);
      const dish = new THREE.Mesh(dishGeo, mats.bodySoft);
      dish.position.set(0, 0.4, 0);
      dish.rotation.x = Math.PI;
      group.add(dish);
      const innerGeo = new THREE.SphereGeometry(0.18, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2.2);
      const inner = new THREE.Mesh(innerGeo, mats.accentMat);
      inner.position.set(0, 0.405, 0);
      inner.rotation.x = Math.PI;
      group.add(inner);
      const beadGeo = new THREE.SphereGeometry(0.05, 12, 12);
      const bead = new THREE.Mesh(beadGeo, mats.accentMat);
      bead.position.set(0, 0.36, 0);
      group.add(bead);
      break;
    }
    case "none":
      break;
    default: { // single
      const stickGeo = new THREE.CapsuleGeometry(0.028, 0.45, 4, 8);
      const stick = new THREE.Mesh(stickGeo, mats.trim);
      stick.position.set(0, 0.28, 0);
      group.add(stick);
      const tipGeo = new THREE.SphereGeometry(0.095, 18, 18);
      const tip = new THREE.Mesh(tipGeo, mats.accentMat);
      tip.position.set(0, 0.275, 0);
      stick.add(tip);
      // soft halo around tip
      const haloGeo = new THREE.RingGeometry(0.13, 0.16, 24);
      const halo = new THREE.Mesh(haloGeo, mats.accentGlow);
      halo.position.copy(tip.position);
      halo.rotation.x = Math.PI / 2;
      stick.add(halo);
      break;
    }
  }

  parent.add(group);
  return group;
}

interface BuiltHands {
  left: THREE.Group;
  right: THREE.Group;
}

/**
 * EVE-style floating side pods — the "hands" hover beside the body, no
 * hard arms attached. Looks more graceful and trustworthy than mech limbs.
 */
function buildHands(
  parent: THREE.Group,
  bodyHalfWidth: number,
  centerY: number,
  mats: ReturnType<typeof makeMaterials>,
): BuiltHands {
  function buildOne(side: number): THREE.Group {
    const g = new THREE.Group();
    g.position.set(side * (bodyHalfWidth + 0.28), centerY, 0);

    // Outer mitten shell
    const shellGeo = new THREE.SphereGeometry(0.18, 24, 24);
    shellGeo.scale(1.0, 1.25, 0.85);
    const shell = new THREE.Mesh(shellGeo, mats.body);
    g.add(shell);

    // Inner accent disc at the wrist (faces inward)
    const discGeo = new THREE.CircleGeometry(0.10, 24);
    const disc = new THREE.Mesh(discGeo, mats.accentMat);
    disc.position.set(side * -0.16, 0, 0);
    disc.rotation.y = side * Math.PI / 2;
    g.add(disc);

    return g;
  }

  const left = buildOne(-1);
  const right = buildOne(1);
  parent.add(left);
  parent.add(right);
  return { left, right };
}

interface BuiltAura {
  group: THREE.Group;
  spinTargets: THREE.Object3D[];
  flickerTargets: THREE.Mesh[];
}

function buildAura(
  type: string | undefined,
  parent: THREE.Group,
  topY: number,
  bottomY: number,
  bodyHalfWidth: number,
  mats: ReturnType<typeof makeMaterials>,
): BuiltAura {
  const group = new THREE.Group();
  const spinTargets: THREE.Object3D[] = [];
  const flickerTargets: THREE.Mesh[] = [];

  switch (type) {
    case "jets": {
      // Tiny side-thrusters tucked just below the equator
      [-1, 1].forEach((side) => {
        const podGeo = new THREE.CapsuleGeometry(0.085, 0.18, 6, 12);
        const pod = new THREE.Mesh(podGeo, mats.trim);
        pod.position.set(side * (bodyHalfWidth - 0.05), bottomY + 0.4, -0.15);
        pod.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        pod.rotation.x = -0.2;
        group.add(pod);
        const flameGeo = new THREE.SphereGeometry(0.10, 16, 16);
        flameGeo.scale(1, 1.6, 1);
        const flame = new THREE.Mesh(flameGeo, mats.accentGlow);
        flame.position.set(0, -0.18, 0);
        pod.add(flame);
        flickerTargets.push(flame);
      });
      break;
    }
    case "hover": {
      // Two glowing rings hovering below the body
      [
        [bottomY - 0.05, bodyHalfWidth + 0.15],
        [bottomY - 0.30, bodyHalfWidth - 0.10],
      ].forEach(([y, r]) => {
        const ringGeo = new THREE.TorusGeometry(r, 0.022, 12, 64);
        const ring = new THREE.Mesh(ringGeo, mats.accentMat);
        ring.position.y = y;
        ring.rotation.x = Math.PI / 2;
        group.add(ring);
        spinTargets.push(ring);
      });
      break;
    }
    case "tiny": {
      // EVE-style tiny side wings — small accent fins
      [-1, 1].forEach((side) => {
        const wGeo = new THREE.SphereGeometry(0.18, 16, 16);
        wGeo.scale(1.6, 0.45, 0.8);
        const w = new THREE.Mesh(wGeo, mats.bodySoft);
        w.position.set(side * (bodyHalfWidth + 0.05), 0.15, -0.05);
        w.rotation.z = side * 0.18;
        group.add(w);
        const tipGeo = new THREE.SphereGeometry(0.05, 12, 12);
        const tip = new THREE.Mesh(tipGeo, mats.accentMat);
        tip.position.set(side * 0.28, 0, 0);
        w.add(tip);
        flickerTargets.push(tip);
      });
      break;
    }
    default: { // propeller → "Halo": glowing orbiting ring above the head
      const haloGeo = new THREE.TorusGeometry(0.42, 0.022, 12, 64);
      const halo = new THREE.Mesh(haloGeo, mats.accentMat);
      halo.position.y = topY + 0.35;
      halo.rotation.x = Math.PI / 2.4;
      group.add(halo);
      spinTargets.push(halo);
      // soft secondary glow ring
      const halo2Geo = new THREE.RingGeometry(0.45, 0.55, 48);
      const halo2 = new THREE.Mesh(halo2Geo, mats.accentGlow);
      halo2.position.y = topY + 0.35;
      halo2.rotation.x = Math.PI / 2;
      group.add(halo2);
      break;
    }
  }

  parent.add(group);
  return { group, spinTargets, flickerTargets };
}

function buildContactShadow(
  parent: THREE.Object3D,
  y: number,
  width: number,
  shadowTex: THREE.Texture | null,
): THREE.Mesh | null {
  if (!shadowTex) return null;
  const geo = new THREE.PlaneGeometry(width * 2.4, width * 1.4);
  const mat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  parent.add(m);
  return m;
}

/* ════════════════════════════════════════════════════════════════════
 *  Main component
 * ════════════════════════════════════════════════════════════════════ */
export function AgentAvatarScene({
  config = DEFAULT_AGENT_AVATAR_CONFIG,
  expression = "happy",
  className = "",
  fallbackMode = false,
}: AgentAvatarSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    avatarGroup: THREE.Group;
    chassisGroup: THREE.Group;
    faceMaterial: THREE.ShaderMaterial;
    antennaGroup: THREE.Group;
    aura: BuiltAura;
    leftHand: THREE.Group;
    rightHand: THREE.Group;
    contactShadow: THREE.Mesh | null;
    chestPip: THREE.Mesh;
    particles: THREE.Points;
    accentLight: THREE.PointLight;
    pointer: { x: number; y: number };
    bodyTopY: number;
    bodyHalfWidth: number;
    animationId: number;
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const configKey = `${config.chassis}-${config.eyes}-${config.antenna}-${config.wings}-${config.accent}-${config.baseColor}`;

  // Build scene whenever config changes
  useEffect(() => {
    if (fallbackMode || webglError) return;
    const mount = mountRef.current;
    if (!mount) return;

    // Teardown previous
    if (sceneRef.current) {
      cancelAnimationFrame(sceneRef.current.animationId);
      const prev = sceneRef.current;
      if (mount.contains(prev.renderer.domElement)) {
        mount.removeChild(prev.renderer.domElement);
      }
      prev.renderer.dispose();
      prev.scene.traverse((obj: THREE.Object3D) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (mat) {
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else (mat as THREE.Material).dispose();
        }
      });
      sceneRef.current = null;
    }

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
    renderer.toneMappingExposure = 1.22;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, clientWidth / clientHeight, 0.1, 100);
    camera.position.set(0, 0.4, 6.8);
    camera.lookAt(0, 0.35, 0);

    /* ── Pro 3-point lighting + accent kicker ──────────────────────
     * Warm-cool contrast: key is amber-ish, fill is cool blue, rim is
     * pure white from behind to cut a clean silhouette. This is the
     * Disney/Pixar signature lighting recipe.
     */
    scene.add(new THREE.AmbientLight(0xeaf0ff, 0.32));

    const key = new THREE.DirectionalLight(0xffe9c9, 1.25);
    key.position.set(2.8, 4.2, 4.5);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x9bb6ff, 0.55);
    fill.position.set(-3.6, 1.0, 2.4);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 1.05);
    rim.position.set(0.4, 2.6, -3.8);
    scene.add(rim);

    // Soft top hair-light — adds the "halo" sheen on the head
    const top = new THREE.DirectionalLight(0xffffff, 0.45);
    top.position.set(0, 5, 0.8);
    scene.add(top);

    // Accent kicker — colors the underside, ties the bot to its accent palette
    const ac = accentHex(config.accent);
    const bc = baseColorHex(config.baseColor);
    const accentLight = new THREE.PointLight(ac, 0.6, 8);
    accentLight.position.set(0, -1.6, 2.2);
    scene.add(accentLight);

    const envMap = createEnvMap();
    const isLight = isLightBase(config.baseColor);
    const mats = makeMaterials(ac, bc, envMap, isLight);

    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    // Build body
    const profile = chassisProfile(config.chassis);
    const built = buildChassis(config.chassis, ac, mats);
    avatarGroup.add(built.group);
    built.faceMaterial.uniforms.uEyeStyle.value = eyeStyleIndex(config.eyes);

    let topY = -Infinity;
    let bottomY = Infinity;
    let halfWidth = 0;
    for (const v of profile) {
      if (v.y > topY) topY = v.y;
      if (v.y < bottomY) bottomY = v.y;
      if (v.x > halfWidth) halfWidth = v.x;
    }

    // Antenna at the top crown
    const antennaGroup = buildAntenna(config.antenna, built.group, topY - 0.06, mats);

    // Hands floating beside the equator
    const equatorY = (topY + bottomY) * 0.5 - 0.05;
    const { left: leftHand, right: rightHand } = buildHands(avatarGroup, halfWidth, equatorY, mats);

    // Aura layer (halo / hover / boosters / tiny wings)
    const aura = buildAura(config.wings, avatarGroup, topY, bottomY, halfWidth, mats);

    // Contact shadow
    const shadowTex = createShadowTexture();
    const contactShadow = buildContactShadow(avatarGroup, bottomY - 0.55, halfWidth + 0.4, shadowTex);

    // Particle aura — soft floating motes
    const pCount = 24;
    const pGeo = new THREE.BufferGeometry();
    const pos = new Float32Array(pCount * 3);
    const speeds = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.4 + Math.random() * (halfWidth + 1.6);
      pos[i * 3] = Math.cos(angle) * radius;
      pos[i * 3 + 1] = bottomY - 0.3 - Math.random() * 1.6;
      pos[i * 3 + 2] = Math.sin(angle) * radius * 0.6;
      speeds[i] = 0.005 + Math.random() * 0.012;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pMat = new THREE.PointsMaterial({
      color: ac,
      size: 0.06,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(pGeo, pMat);
    (particles as unknown as { userData: { speeds: Float32Array } }).userData = { speeds };
    avatarGroup.add(particles);

    sceneRef.current = {
      renderer,
      scene,
      camera,
      avatarGroup,
      chassisGroup: built.group,
      faceMaterial: built.faceMaterial,
      antennaGroup,
      aura,
      leftHand,
      rightHand,
      contactShadow,
      chestPip: built.chestPip,
      particles,
      accentLight,
      pointer: { x: 0, y: 0 },
      bodyTopY: topY,
      bodyHalfWidth: halfWidth,
      animationId: 0,
    };

    const onResize = () => {
      if (!mountRef.current || !sceneRef.current) return;
      const { clientWidth: w, clientHeight: h } = mountRef.current;
      sceneRef.current.renderer.setSize(w, h);
      sceneRef.current.camera.aspect = w / h;
      sceneRef.current.camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    const onPointerMove = (e: PointerEvent) => {
      if (!mountRef.current || !sceneRef.current) return;
      const rect = mountRef.current.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      sceneRef.current.pointer.x = Math.max(-1, Math.min(1, nx));
      sceneRef.current.pointer.y = Math.max(-1, Math.min(1, ny));
    };
    const onPointerLeave = () => {
      if (!sceneRef.current) return;
      sceneRef.current.pointer.x = 0;
      sceneRef.current.pointer.y = 0;
    };
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onPointerLeave);

    return () => {
      window.removeEventListener("resize", onResize);
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
      if (sceneRef.current) {
        cancelAnimationFrame(sceneRef.current.animationId);
        const cur = sceneRef.current;
        if (mount.contains(cur.renderer.domElement)) {
          mount.removeChild(cur.renderer.domElement);
        }
        cur.renderer.dispose();
        cur.scene.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const mat = mesh.material;
          if (mat) {
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else (mat as THREE.Material).dispose();
          }
        });
        sceneRef.current = null;
      }
    };
  }, [configKey, fallbackMode, webglError]);

  /* ── Animation loop ────────────────────────────────────────────── */
  useEffect(() => {
    if (!sceneRef.current || fallbackMode || webglError) return;
    const s = sceneRef.current;

    // Per-expression posture targets — live alongside the shader so the
    // whole bot moves in character, not just the face.
    type Posture = {
      bobAmp: number; bobSpeed: number;
      headTiltX: number; headTiltZ: number;
      handLift: number; handSpread: number;
      auraSpeed: number;
      mouthPulseAmp: number; mouthPulseSpeed: number;
      breathRate: number;
    };

    const posture: Posture = (() => {
      switch (expression) {
        case "happy":  return { bobAmp: 0.10, bobSpeed: 1.8, headTiltX: 0.0, headTiltZ: 0.0, handLift: 0.18, handSpread: 0.06, auraSpeed: 0.6, mouthPulseAmp: 0.12, mouthPulseSpeed: 4.0, breathRate: 1.2 };
        case "sad":    return { bobAmp: 0.04, bobSpeed: 0.7, headTiltX: 0.18, headTiltZ: 0.05, handLift: -0.18, handSpread: -0.04, auraSpeed: 0.18, mouthPulseAmp: 0.0, mouthPulseSpeed: 0.0, breathRate: 0.6 };
        case "angry":  return { bobAmp: 0.05, bobSpeed: 2.6, headTiltX: -0.14, headTiltZ: 0.0, handLift: 0.12, handSpread: -0.06, auraSpeed: 1.6, mouthPulseAmp: 0.0, mouthPulseSpeed: 0.0, breathRate: 1.8 };
        case "sleepy": return { bobAmp: 0.025, bobSpeed: 0.45, headTiltX: 0.10, headTiltZ: 0.22, handLift: -0.22, handSpread: -0.08, auraSpeed: 0.12, mouthPulseAmp: 0.0, mouthPulseSpeed: 0.0, breathRate: 0.4 };
        case "bored":  return { bobAmp: 0.03, bobSpeed: 0.55, headTiltX: 0.08, headTiltZ: 0.10, handLift: -0.10, handSpread: -0.02, auraSpeed: 0.25, mouthPulseAmp: 0.0, mouthPulseSpeed: 0.0, breathRate: 0.7 };
        case "hyped":  return { bobAmp: 0.22, bobSpeed: 3.6, headTiltX: -0.06, headTiltZ: 0.0, handLift: 0.32, handSpread: 0.14, auraSpeed: 2.4, mouthPulseAmp: 0.20, mouthPulseSpeed: 6.0, breathRate: 1.6 };
        case "shake_head": return { bobAmp: 0.06, bobSpeed: 1.2, headTiltX: 0, headTiltZ: 0, handLift: 0.04, handSpread: 0.0, auraSpeed: 0.8, mouthPulseAmp: 0, mouthPulseSpeed: 0, breathRate: 1.0 };
        case "nod":    return { bobAmp: 0.06, bobSpeed: 1.2, headTiltX: 0, headTiltZ: 0, handLift: 0.06, handSpread: 0.0, auraSpeed: 0.8, mouthPulseAmp: 0.06, mouthPulseSpeed: 3.0, breathRate: 1.0 };
        default:       return { bobAmp: 0.06, bobSpeed: 1.2, headTiltX: 0, headTiltZ: 0, handLift: 0.0, handSpread: 0.0, auraSpeed: 0.5, mouthPulseAmp: 0.0, mouthPulseSpeed: 0.0, breathRate: 1.0 };
      }
    })();

    const exprIdx = expressionIndex(expression);
    s.faceMaterial.uniforms.uExpression.value = exprIdx;

    let t = 0;
    let nextBlinkAt = 1.5 + Math.random() * 2.5;
    let blinkPhase = 0; // 0 = idle, increasing 0..1..0 over a blink
    let blinkActive = false;
    let saccadeTarget = { x: 0, y: 0 };
    let nextSaccadeAt = 1.0 + Math.random() * 2.5;

    const lerp = THREE.MathUtils.lerp;

    const animate = () => {
      if (!sceneRef.current) return;
      sceneRef.current.animationId = requestAnimationFrame(animate);

      const dt = 0.016;
      t += dt;

      if (isReducedMotion) {
        s.faceMaterial.uniforms.uTime.value = t;
        s.renderer.render(s.scene, s.camera);
        return;
      }

      /* ── Body float + breathing ─────────────────────────────────── */
      const bob = Math.sin(t * posture.bobSpeed) * posture.bobAmp;
      s.avatarGroup.position.y = bob;
      // breathing: subtle Y-scale on the body mesh
      const breath = 1 + Math.sin(t * posture.breathRate) * 0.012;
      s.chassisGroup.scale.set(1, breath, 1);
      // micro sway
      s.avatarGroup.rotation.z = Math.sin(t * 0.6) * 0.012;

      /* ── Head tilt / nod / shake ────────────────────────────────── */
      if (expression === "shake_head") {
        s.chassisGroup.rotation.y = Math.sin(t * 5.5) * 0.30;
        s.chassisGroup.rotation.x = lerp(s.chassisGroup.rotation.x, 0, 0.12);
        s.chassisGroup.rotation.z = lerp(s.chassisGroup.rotation.z, 0, 0.12);
      } else if (expression === "nod") {
        s.chassisGroup.rotation.x = Math.sin(t * 4.5) * 0.22;
        s.chassisGroup.rotation.y = lerp(s.chassisGroup.rotation.y, 0, 0.12);
        s.chassisGroup.rotation.z = lerp(s.chassisGroup.rotation.z, 0, 0.12);
      } else {
        // gentle curiosity: occasional head tilt
        const curiosity = Math.sin(t * 0.31) * 0.04;
        s.chassisGroup.rotation.x = lerp(s.chassisGroup.rotation.x, posture.headTiltX, 0.08);
        s.chassisGroup.rotation.z = lerp(s.chassisGroup.rotation.z, posture.headTiltZ + curiosity, 0.06);
        s.chassisGroup.rotation.y = lerp(s.chassisGroup.rotation.y, s.pointer.x * 0.18, 0.06);
      }

      /* ── Blink scheduler ────────────────────────────────────────── */
      if (!blinkActive && t >= nextBlinkAt) {
        blinkActive = true;
        blinkPhase = 0;
      }
      if (blinkActive) {
        blinkPhase += dt * 7.5;          // ~0.27s blink
        const v = blinkPhase < 1
          ? Math.sin(blinkPhase * Math.PI)  // 0 -> 1 -> 0 as phase goes 0..1
          : 0;
        s.faceMaterial.uniforms.uBlink.value = v;
        if (blinkPhase >= 1) {
          blinkActive = false;
          blinkPhase = 0;
          // double-blink occasionally
          const doubleBlink = Math.random() < 0.18;
          nextBlinkAt = t + (doubleBlink ? 0.18 : 2.2 + Math.random() * 3.5);
        }
      } else {
        // sleepy keeps lids low even between blinks
        const sleepyHold = expression === "sleepy" ? 0.6 : 0.0;
        s.faceMaterial.uniforms.uBlink.value = lerp(
          s.faceMaterial.uniforms.uBlink.value,
          sleepyHold,
          0.1,
        );
      }

      /* ── Saccades + cursor tracking ─────────────────────────────── */
      if (t >= nextSaccadeAt) {
        saccadeTarget = {
          x: (Math.random() - 0.5) * 0.6,
          y: (Math.random() - 0.5) * 0.4,
        };
        nextSaccadeAt = t + 1.4 + Math.random() * 2.6;
      }
      // cursor pull dominates when present, saccade when idle
      const pointerActive = Math.abs(s.pointer.x) + Math.abs(s.pointer.y) > 0.05;
      const targetPx = pointerActive ? s.pointer.x * 0.9 : saccadeTarget.x;
      const targetPy = pointerActive ? -s.pointer.y * 0.6 : saccadeTarget.y;
      const off = s.faceMaterial.uniforms.uPupilOffset.value as THREE.Vector2;
      off.x = lerp(off.x, targetPx, 0.10);
      off.y = lerp(off.y, targetPy, 0.10);

      /* ── Mouth pulse (talking feel for happy/hyped/nod) ─────────── */
      if (posture.mouthPulseAmp > 0) {
        const pulse = Math.max(0, Math.sin(t * posture.mouthPulseSpeed)) * posture.mouthPulseAmp;
        s.faceMaterial.uniforms.uMouthOpen.value = pulse;
      } else {
        s.faceMaterial.uniforms.uMouthOpen.value = lerp(
          s.faceMaterial.uniforms.uMouthOpen.value, 0, 0.1,
        );
      }

      /* ── Hands ──────────────────────────────────────────────────── */
      const handBase = (s.bodyHalfWidth + 0.28);
      const handBob = Math.sin(t * 1.6) * 0.04;
      const handBobR = Math.sin(t * 1.6 + 0.7) * 0.04;
      s.leftHand.position.x = lerp(s.leftHand.position.x, -(handBase + posture.handSpread), 0.08);
      s.leftHand.position.y = lerp(s.leftHand.position.y, posture.handLift + handBob, 0.08);
      s.rightHand.position.x = lerp(s.rightHand.position.x, (handBase + posture.handSpread), 0.08);
      s.rightHand.position.y = lerp(s.rightHand.position.y, posture.handLift + handBobR, 0.08);
      // tiny rotation flutter
      s.leftHand.rotation.z = Math.sin(t * 1.3) * 0.06 - 0.05;
      s.rightHand.rotation.z = -Math.sin(t * 1.3 + 0.4) * 0.06 + 0.05;

      /* ── Antenna sway ───────────────────────────────────────────── */
      s.antennaGroup.rotation.z = Math.sin(t * 2.1) * 0.06;
      s.antennaGroup.rotation.x = Math.sin(t * 1.4) * 0.04;

      /* ── Aura: spin halo / ring, flicker boosters ───────────────── */
      for (const tgt of s.aura.spinTargets) {
        tgt.rotation.z += dt * posture.auraSpeed;
      }
      for (const f of s.aura.flickerTargets) {
        const m = f.material as THREE.MeshBasicMaterial;
        m.opacity = 0.65 + Math.sin(t * 18 + f.id * 0.3) * 0.25;
        const flicker = 1 + Math.sin(t * 22 + f.id * 0.5) * 0.18;
        f.scale.set(flicker, flicker, flicker);
      }

      /* ── Chest pip pulse ────────────────────────────────────────── */
      const pipPulse = 1 + Math.sin(t * 2.4) * 0.18;
      s.chestPip.scale.set(pipPulse, pipPulse, pipPulse);

      /* ── Accent kicker breathes with the bot ────────────────────── */
      s.accentLight.intensity = 0.45 + Math.sin(t * 2.0) * 0.15;

      /* ── Particle motes drift up ────────────────────────────────── */
      const pa = s.particles.geometry.getAttribute("position") as THREE.BufferAttribute;
      const speeds = (s.particles as unknown as { userData: { speeds: Float32Array } }).userData.speeds;
      if (pa) {
        for (let i = 0; i < pa.count; i++) {
          let y = pa.getY(i);
          y += speeds[i];
          if (y > 1.6) y = -2.0 - Math.random() * 0.6;
          pa.setY(i, y);
          pa.setX(i, pa.getX(i) + Math.sin(t * 0.6 + i) * 0.0014);
        }
        pa.needsUpdate = true;
      }

      /* ── Drive shader time ──────────────────────────────────────── */
      s.faceMaterial.uniforms.uTime.value = t;

      s.renderer.render(s.scene, s.camera);
    };

    cancelAnimationFrame(s.animationId);
    animate();

    return () => {
      if (sceneRef.current) cancelAnimationFrame(sceneRef.current.animationId);
    };
  }, [expression, isReducedMotion, fallbackMode, webglError, configKey]);

  /* ── Fallback ──────────────────────────────────────────────────── */
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
