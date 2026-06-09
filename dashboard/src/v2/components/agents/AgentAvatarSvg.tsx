/**
 * AgentAvatarSvg — Logo-faithful 2D robot avatar.
 *
 * A literal SVG rendition of the Code UX brand mark: white face shell with
 * speech-bubble tail and side ear caps, dark inset screen containing the
 * smile-arc eyes, and the jade antenna stem with two diagonal tilt lines.
 * All base paths come verbatim from the production logo via
 * lib/agent-avatar-logo.ts — the same module the 3D renderer extrudes — so
 * both surfaces stay pixel/proportion-identical to the brand.
 *
 * Variants overlay or transform those paths instead of replacing them, so
 * every variation still reads as the same brand mark:
 *   • CHASSIS — non-uniform scale of the inner bot (shared scale table)
 *   • EYES    — swap the smile arcs for visor / single lens / pixel / heart
 *   • ANTENNA — swap the pill+lines for bunny ears / beacon / signal / none
 *   • ACCENT  — recolor jade elements (eyes, antenna, glints)
 *   • AURA    — optional ambient flourish behind the bot
 *
 * Expressions morph the eye arcs (smile / frown / squint / wide) so the
 * bot's mood reads at a glance.
 *
 * IMPORTANT: this file renders through plain `preact` (not preact/compat),
 * which sets SVG attributes verbatim — React-style camelCase presentation
 * attributes (stopColor, strokeWidth, clipPath, …) are silently ignored by
 * the browser. Always use the real SVG names: stop-color, stroke-width,
 * clip-path, pointer-events, … (native camelCase like attributeName,
 * repeatCount, stdDeviation stays camelCase).
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { AgentAvatarConfig } from "../../types.js";
import {
  BRAND_COLORS,
  getAccentHex,
  getInsetHex,
  getShellHex,
  isLightBase,
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
  PATH_BEZEL_SLIVER,
  PATH_EYE_LEFT_SMILE,
  PATH_EYE_RIGHT_SMILE,
  LOGO_ANCHORS,
  getChassisScale,
} from "../../lib/agent-avatar-logo.js";

interface AgentAvatarSvgProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  size?: number;
  /** Disable the floating + breathing micro-animations (for high-density UIs). */
  static?: boolean;
}

let agentAvatarSvgInstanceCounter = 0;

/* ════════════════════════════════════════════════════════════════════════
 *  Logo path bank + anchors — shared with the 3D renderer via
 *  lib/agent-avatar-logo.ts so both surfaces stay proportion-identical.
 *  viewBox is 0 0 1254 1254.
 * ════════════════════════════════════════════════════════════════════════ */

/* Forehead jewel was removed at user request — the brand smile-arc bot now
   has no forehead dot. The path is intentionally not exported. */

/* Anchor centers used by expression overlays */
const EYE_L = LOGO_ANCHORS.eyeL;
const EYE_R = LOGO_ANCHORS.eyeR;

/* ════════════════════════════════════════════════════════════════════════
 *  Eye renderers — the canonical smile and three brand-aligned variants.
 *  All renderers position relative to EYE_L/EYE_R anchor centers so the
 *  swap is drop-in regardless of expression.
 * ════════════════════════════════════════════════════════════════════════ */
function renderEyes(
  eyesId: string | undefined,
  expression: AgentAvatarExpression,
  accent: string,
  jadeBright: string,
): h.JSX.Element {
  const wide = expression === "hyped";
  const squint = expression === "sleepy" || expression === "bored";
  const sad = expression === "sad";
  const angry = expression === "angry";

  /* ── Visor (eye style): an award-winning HUD-style band ──
       Layered composition:
         1. Outer recess shadow — gives the visor depth in the dark inset
         2. Main body — solid accent slab, rounded
         3. Cylindrical highlight — lighter top half suggests glass curvature
         4. Inner recessed channel — darker band where the "display" lives
         5. Glass top shine — narrow white strip simulating reflection
         6. Two pulsing pupil cores at the eye centers
         7. HUD tick marks at the edges (sci-fi accent)
         8. Animated scan-line sweep moving left↔right
         9. Mini EQ bars below the visor (suggests live data feed)
       Squint/sad/angry expressions hide the busy elements so the mood
       still reads at a glance. ── */
  if (eyesId === "visor") {
    const yCenter = (EYE_L.y + EYE_R.y) / 2;
    const halfH = squint ? 16 : wide ? 36 : sad ? 22 : 28;
    const visorW = EYE_R.x - EYE_L.x + 220;
    const visorX = EYE_L.x - 110;
    const visorY = yCenter - halfH;
    const accentLight = lighten(accent, 0.45);
    const accentDeep = darken(accent, 0.42);
    const showDetails = !squint;
    const showDataBars = !squint && !sad && !angry;

    return (
      <g>
        {/* 1. Outer recess shadow — depth below the visor */}
        <rect
          x={visorX - 10}
          y={visorY - 6}
          width={visorW + 20}
          height={halfH * 2 + 18}
          rx={halfH * 0.95}
          ry={halfH * 0.95}
          fill="#000000"
          opacity="0.55"
        />

        {/* 2. Main visor body — solid accent slab */}
        <rect
          x={visorX}
          y={visorY}
          width={visorW}
          height={halfH * 2}
          rx={halfH * 0.85}
          ry={halfH * 0.85}
          fill={accent}
        >
          <animate attributeName="opacity" values="1;0.92;1" dur="2.6s" repeatCount="indefinite" />
        </rect>

        {/* 3. Cylindrical top-half highlight — gives the bar 3D feel */}
        <rect
          x={visorX + 4}
          y={visorY + 4}
          width={visorW - 8}
          height={halfH * 0.95}
          rx={halfH * 0.7}
          ry={halfH * 0.7}
          fill={accentLight}
          opacity="0.55"
        />

        {/* 4. Inner recessed channel — darker band */}
        <rect
          x={visorX + 22}
          y={visorY + 14}
          width={visorW - 44}
          height={halfH * 2 - 28}
          rx={Math.max(4, (halfH - 7) * 0.85)}
          ry={Math.max(4, (halfH - 7) * 0.85)}
          fill={accentDeep}
          opacity="0.9"
        />

        {/* 5. Glass top shine — thin reflective strip */}
        {showDetails && (
          <rect
            x={visorX + 28}
            y={visorY + 9}
            width={visorW - 56}
            height={Math.max(4, halfH * 0.45)}
            rx={halfH * 0.3}
            ry={halfH * 0.3}
            fill="#FFFFFF"
            opacity="0.34"
          />
        )}

        {/* 6. Two pulsing pupil cores at the eye anchors */}
        {showDetails && (
          <g>
            <circle cx={EYE_L.x} cy={yCenter + 2} r={wide ? 10 : 7.5} fill={accentLight}>
              <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="r" values={`${wide ? 10 : 7.5};${wide ? 12 : 9};${wide ? 10 : 7.5}`} dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={EYE_R.x} cy={yCenter + 2} r={wide ? 10 : 7.5} fill={accentLight}>
              <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" begin="0.5s" />
              <animate attributeName="r" values={`${wide ? 10 : 7.5};${wide ? 12 : 9};${wide ? 10 : 7.5}`} dur="1.6s" repeatCount="indefinite" begin="0.5s" />
            </circle>
            {/* Bright white cores */}
            <circle cx={EYE_L.x} cy={yCenter} r="2.5" fill="#FFFFFF" opacity="0.95" />
            <circle cx={EYE_R.x} cy={yCenter} r="2.5" fill="#FFFFFF" opacity="0.95" />
          </g>
        )}

        {/* 7. HUD tick marks at the edges */}
        {showDetails && (
          <g>
            <rect x={visorX + 10} y={yCenter - 8} width="3.5" height="16" rx="1.5" fill={accentLight} opacity="0.95" />
            <rect x={visorX + 18} y={yCenter - 5} width="2.5" height="10" rx="1.2" fill={accentLight} opacity="0.65" />
            <rect x={visorX + visorW - 14} y={yCenter - 8} width="3.5" height="16" rx="1.5" fill={accentLight} opacity="0.95" />
            <rect x={visorX + visorW - 21} y={yCenter - 5} width="2.5" height="10" rx="1.2" fill={accentLight} opacity="0.65" />
          </g>
        )}

        {/* 8. Animated scan-line sweep */}
        <rect
          x={visorX - 60}
          y={visorY + 4}
          width="60"
          height={halfH * 2 - 8}
          fill="#FFFFFF"
          opacity="0"
          rx="10"
        >
          <animate attributeName="x" values={`${visorX - 60};${visorX + visorW};${visorX - 60}`} dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.4;0;0" dur="4.5s" repeatCount="indefinite" />
        </rect>

        {/* 9. Mini EQ data bars below the visor — suggests live data feed */}
        {showDataBars && (
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const x = visorX + visorW / 2 - 48 + i * 16;
              const peakHeight = [10, 18, 26, 14, 22, 12, 16][i];
              const dur = 0.7 + (i % 3) * 0.18;
              return (
                <rect
                  key={i}
                  x={x}
                  y={visorY + halfH * 2 + 14}
                  width="6"
                  height="4"
                  rx="2.5"
                  fill={accent}
                  opacity="0.8"
                >
                  <animate
                    attributeName="height"
                    values={`4;${peakHeight};4`}
                    dur={`${dur}s`}
                    repeatCount="indefinite"
                  />
                </rect>
              );
            })}
          </g>
        )}
      </g>
    );
  }

  /* ── Heart: cute heart-shaped eyes ── */
  if (eyesId === "heart") {
    const s = squint ? 0.5 : wide ? 1.35 : 1.0;
    const heartPath = (cx: number, cy: number) => {
      const w = 50 * s;
      const h = 48 * s;
      return `M ${cx} ${cy + h * 0.5}
              C ${cx - w} ${cy} ${cx - w} ${cy - h * 0.6} ${cx - w * 0.4} ${cy - h * 0.6}
              C ${cx - w * 0.15} ${cy - h * 0.6} ${cx} ${cy - h * 0.3} ${cx} ${cy - h * 0.05}
              C ${cx} ${cy - h * 0.3} ${cx + w * 0.15} ${cy - h * 0.6} ${cx + w * 0.4} ${cy - h * 0.6}
              C ${cx + w} ${cy - h * 0.6} ${cx + w} ${cy} ${cx} ${cy + h * 0.5} Z`;
    };
    return (
      <g>
        <path d={heartPath(EYE_L.x, EYE_L.y)} fill={accent}>
          <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1.8s" repeatCount="indefinite" />
        </path>
        <path d={heartPath(EYE_R.x, EYE_R.y)} fill={accent}>
          <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1.8s" repeatCount="indefinite" begin="0.4s" />
        </path>
        {!squint && (
          <>
            <circle cx={EYE_L.x - 8} cy={EYE_L.y - 12} r="6" fill={jadeBright} opacity="0.9" />
            <circle cx={EYE_R.x - 8} cy={EYE_R.y - 12} r="6" fill={jadeBright} opacity="0.9" />
          </>
        )}
      </g>
    );
  }

  /* ── Single Lens: cyclops circle centered between the two eye anchors ── */
  if (eyesId === "single") {
    const cx = (EYE_L.x + EYE_R.x) / 2;
    const cy = (EYE_L.y + EYE_R.y) / 2;
    const r = squint ? 26 : wide ? 78 : 56;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r + 18} fill="none" stroke={accent} stroke-width="6" opacity="0.4">
          <animate attributeName="r" values={`${r + 18};${r + 30};${r + 18}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r={r} fill={accent} />
        <circle cx={cx - r * 0.32} cy={cy - r * 0.32} r={r * 0.3} fill={jadeBright} opacity="0.9" />
      </g>
    );
  }

  /* ── Pixel: chunky square eyes (Famicom-style) ── */
  if (eyesId === "pixel") {
    const s = squint ? 24 : wide ? 78 : 52;
    return (
      <g>
        <rect x={EYE_L.x - s / 2} y={EYE_L.y - s / 2} width={s} height={s} rx="8" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" />
        </rect>
        <rect x={EYE_R.x - s / 2} y={EYE_R.y - s / 2} width={s} height={s} rx="8" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" begin="0.5s" />
        </rect>
      </g>
    );
  }

  /* ── Default: smile arcs — the logo's signature eyes ──
       For happy/default we render the EXACT logo paths. For other
       expressions we render alternate eye shapes at the same centers,
       all in the same jade green, preserving the brand language. */

  if (expression === "happy" || expression === "hyped" || expression === "nod" || expression === "shake_head") {
    // The big smile-arc eyes of the logo, optionally scaled for "hyped"
    const transform = wide ? `translate(${EYE_L.x} ${EYE_L.y}) scale(1.18) translate(${-EYE_L.x} ${-EYE_L.y})` : undefined;
    return (
      <g transform={transform}>
        <path d={PATH_EYE_LEFT_SMILE} fill={accent}>
          <animate attributeName="opacity" values="1;0.9;1" dur="3.4s" repeatCount="indefinite" />
        </path>
        <path d={PATH_EYE_RIGHT_SMILE} fill={accent}>
          <animate attributeName="opacity" values="1;0.9;1" dur="3.4s" repeatCount="indefinite" begin="0.6s" />
        </path>
      </g>
    );
  }

  if (sad) {
    // Frown — flip the smile arcs vertically around the eye centers
    return (
      <g>
        <g transform={`translate(${EYE_L.x} ${EYE_L.y}) scale(1 -1) translate(${-EYE_L.x} ${-EYE_L.y})`}>
          <path d={PATH_EYE_LEFT_SMILE} fill={accent} opacity="0.8" />
        </g>
        <g transform={`translate(${EYE_R.x} ${EYE_R.y}) scale(1 -1) translate(${-EYE_R.x} ${-EYE_R.y})`}>
          <path d={PATH_EYE_RIGHT_SMILE} fill={accent} opacity="0.8" />
        </g>
      </g>
    );
  }

  if (angry) {
    // Thick angled brow-bars
    return (
      <g>
        <rect
          x={EYE_L.x - 56}
          y={EYE_L.y - 14}
          width="112"
          height="22"
          rx="11"
          fill={accent}
          transform={`rotate(-12 ${EYE_L.x} ${EYE_L.y})`}
        />
        <rect
          x={EYE_R.x - 56}
          y={EYE_R.y - 14}
          width="112"
          height="22"
          rx="11"
          fill={accent}
          transform={`rotate(12 ${EYE_R.x} ${EYE_R.y})`}
        />
      </g>
    );
  }

  if (squint) {
    // Long thin sleepy lines
    return (
      <g>
        <rect x={EYE_L.x - 50} y={EYE_L.y - 5} width="100" height="10" rx="5" fill={accent} opacity="0.85" />
        <rect x={EYE_R.x - 50} y={EYE_R.y - 5} width="100" height="10" rx="5" fill={accent} opacity="0.85" />
      </g>
    );
  }

  // Fallback — use the logo eyes
  return (
    <g>
      <path d={PATH_EYE_LEFT_SMILE} fill={accent} />
      <path d={PATH_EYE_RIGHT_SMILE} fill={accent} />
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Antenna renderers — the logo's pill + tilt lines + alternatives.
 * ════════════════════════════════════════════════════════════════════════ */
function renderAntenna(
  antennaId: string | undefined,
  accent: string,
  jadeBright: string,
  expression: AgentAvatarExpression,
): h.JSX.Element | null {
  const swayAnim = (
    <animateTransform
      attributeName="transform"
      type="rotate"
      values={`${expression === "hyped" ? -6 : -2} 628 410; ${expression === "hyped" ? 6 : 2} 628 410; ${expression === "hyped" ? -6 : -2} 628 410`}
      dur={expression === "hyped" ? "1.4s" : "3.2s"}
      repeatCount="indefinite"
    />
  );

  if (antennaId === "none") return null;

  if (antennaId === "bunny") {
    // Two diagonal jade pills as bunny ears + small jewels at the tips
    return (
      <g>
        {swayAnim}
        <rect x="500" y="240" width="36" height="120" rx="18" fill={accent} transform="rotate(-22 518 300)" />
        <rect x="720" y="240" width="36" height="120" rx="18" fill={accent} transform="rotate(22 738 300)" />
        <circle cx="478" cy="208" r="22" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="778" cy="208" r="22" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" begin="0.6s" />
        </circle>
        <circle cx="473" cy="201" r="7" fill={jadeBright} opacity="0.9" />
        <circle cx="773" cy="201" r="7" fill={jadeBright} opacity="0.9" />
      </g>
    );
  }

  if (antennaId === "beam") {
    // Tall thin stem with a glowing jewel ball + halo pulse
    return (
      <g>
        {swayAnim}
        <rect x="618" y="170" width="20" height="160" rx="10" fill={accent} />
        <circle cx="628" cy="160" r="28" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="620" cy="153" r="9" fill={jadeBright} opacity="0.9" />
        <circle cx="628" cy="160" r="48" fill="none" stroke={accent} stroke-width="6" opacity="0.4">
          <animate attributeName="r" values="48;72;48" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </g>
    );
  }

  if (antennaId === "wifi") {
    // Three concentric signal arcs emanating from a small antenna dot.
    // Each arc fades in then out in sequence, like a transmitting wifi mark.
    const arc = (rx: number, ry: number, dur: string, begin: string) => (
      <path
        d={`M ${628 - rx} 320 A ${rx} ${ry} 0 0 1 ${628 + rx} 320`}
        fill="none"
        stroke={accent}
        stroke-width="14"
        stroke-linecap="round"
        opacity="0"
      >
        <animate attributeName="opacity" values="0;0.95;0" dur={dur} repeatCount="indefinite" begin={begin} />
      </path>
    );
    return (
      <g>
        {swayAnim}
        {/* Small antenna stem + base dot */}
        <rect x="622" y="270" width="12" height="60" rx="6" fill={accent} />
        <circle cx="628" cy="332" r="12" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
        {/* Concentric signal arcs */}
        {arc(60, 36, "1.6s", "0s")}
        {arc(110, 64, "1.6s", "0.35s")}
        {arc(170, 100, "1.6s", "0.7s")}
      </g>
    );
  }

  // Default: jewel — the canonical logo antenna (pill stem + 2 diagonal lines)
  return (
    <g>
      {swayAnim}
      <path d={PATH_ANTENNA_PILL} fill={accent}>
        <animate attributeName="opacity" values="1;0.78;1" dur="2.4s" repeatCount="indefinite" />
      </path>
      <path d={PATH_ANTENNA_TILT_LEFT} fill={accent} />
      <path d={PATH_ANTENNA_TILT_RIGHT} fill={accent} />
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Aura — ambient flourish behind the tile
 * ════════════════════════════════════════════════════════════════════════ */
function renderAura(wingsId: string | undefined, accent: string, jadeBright: string, orbitPathId: string): h.JSX.Element | null {
  if (!wingsId || wingsId === "none") return null;

  /* ── Halo: stacked tilted ellipses — a celestial-feeling crown ── */
  if (wingsId === "halo") {
    return (
      <g>
        {/* Outer broad halo */}
        <ellipse cx="628" cy="200" rx="520" ry="80" fill="none" stroke={accent} stroke-width="10" opacity="0.55">
          <animate attributeName="opacity" values="0.55;0.25;0.55" dur="3.6s" repeatCount="indefinite" />
        </ellipse>
        {/* Inner crisp halo */}
        <ellipse cx="628" cy="190" rx="420" ry="56" fill="none" stroke={jadeBright} stroke-width="6" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0.4;0.7" dur="3.6s" repeatCount="indefinite" begin="0.4s" />
        </ellipse>
        {/* Slow rotation suggested by 3 tiny floating accent dots on the ring */}
        <g>
          <animateTransform attributeName="transform" type="rotate" from="0 628 200" to="360 628 200" dur="14s" repeatCount="indefinite" />
          <circle cx="1148" cy="200" r="12" fill={jadeBright} />
          <circle cx="108"  cy="200" r="10" fill={accent} />
          <circle cx="628"  cy="120" r="8"  fill={jadeBright} opacity="0.85" />
        </g>
      </g>
    );
  }

  /* ── Pulse: angular shock-wave with offset secondaries — avantgarde ── */
  if (wingsId === "pulse") {
    /* Concentric, slightly rotated rounded-squares pulsing outward with
       phase offsets — feels like a graphic-design shock wave rather than a
       generic radio pulse. */
    const shockwave = (delay: string, scaleFrom: number, scaleTo: number, opa: number, sw: number, rot: number) => (
      <rect
        x="200"
        y="200"
        width="854"
        height="854"
        rx="220"
        fill="none"
        stroke={accent}
        stroke-width={sw}
        opacity="0"
        transform={`rotate(${rot} 627 627)`}
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`${rot} 627 627`}
          additive="sum"
          dur="6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values={`0;${opa};0`}
          dur="2.6s"
          repeatCount="indefinite"
          begin={delay}
        />
        <animateTransform
          attributeName="transform"
          type="scale"
          additive="sum"
          values={`${scaleFrom};${scaleTo};${scaleFrom}`}
          dur="2.6s"
          repeatCount="indefinite"
          begin={delay}
        />
      </rect>
    );
    return (
      <g style="transform-origin: 627px 627px;">
        {shockwave("0s",   1.0, 1.25, 0.7,  18, 0)}
        {shockwave("0.5s", 1.0, 1.35, 0.5,  10, 6)}
        {shockwave("1.0s", 1.0, 1.45, 0.35, 6,  -6)}
        {/* Crisp focal dot in the lower center to anchor the wave */}
        <circle cx="627" cy="1180" r="14" fill={accent}>
          <animate attributeName="opacity" values="1;0.4;1" dur="2.6s" repeatCount="indefinite" />
        </circle>
      </g>
    );
  }

  /* ── Orbit: 3 jade satellites circling on a tilted elliptical path ── */
  if (wingsId === "orbit") {
    const orbitPathProps = {
      d: "M 627 200 a 540 180 0 1 0 0.001 0",
      fill: "none",
      stroke: accent,
      strokeOpacity: "0.18",
      strokeWidth: "3",
      strokeDasharray: "6 8",
    };
    const orbitPath = (
      <path
        id={orbitPathId}
        {...orbitPathProps}
      />
    );
    const satellite = (delay: string, r: number, fill: string, opacity: number) => (
      <circle r={r} fill={fill} opacity={opacity}>
        <animateMotion dur="6s" repeatCount="indefinite" begin={delay} rotate="auto">
          <mpath href={`#${orbitPathId}`} />
        </animateMotion>
        <animate attributeName="opacity" values={`${opacity};${opacity * 0.4};${opacity}`} dur="6s" repeatCount="indefinite" begin={delay} />
      </circle>
    );
    return (
      <g>
        <defs>{orbitPath}</defs>
        <path {...orbitPathProps} />
        {satellite("0s",   18, accent, 0.95)}
        {satellite("-2s",  14, jadeBright, 0.85)}
        {satellite("-4s",  10, accent, 0.75)}
      </g>
    );
  }

  /* ── Dust (kept as-is — user requested) ── */
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * 45 + 22) * (Math.PI / 180);
        const cx = 628 + Math.cos(angle) * 560;
        const cy = 700 + Math.sin(angle) * 520;
        return (
          <circle key={i} cx={cx} cy={cy} r="16" fill={accent} opacity="0.55">
            <animate attributeName="cy" values={`${cy};${cy - 60};${cy}`} dur="3.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
            <animate attributeName="opacity" values="0.55;0;0.55" dur="3.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
          </circle>
        );
      })}
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Headphones — five styles, layered over the white ear-cap area.
 *
 *  Anchor centers for the side decorations:
 *    LEFT_EAR   ≈ (272, 700)
 *    RIGHT_EAR  ≈ (980, 700)
 * ════════════════════════════════════════════════════════════════════════ */
const EAR_L = { x: 272, y: 700 };
const EAR_R = { x: 980, y: 700 };

function renderHeadphones(
  headphonesId: string | undefined,
  accent: string,
  jadeBright: string,
  shellHex: string,
): h.JSX.Element | null {
  if (!headphonesId || headphonesId === "bumper") return null;

  /* ── Studio: over-ear cups with jade pad center + connecting band overhead ── */
  if (headphonesId === "studio") {
    return (
      <g>
        {/* Connecting band arcing over the head */}
        <path
          d={`M ${EAR_L.x + 20} 560 Q 627 360 ${EAR_R.x - 20} 560`}
          fill="none"
          stroke={shellHex}
          stroke-width="22"
          stroke-linecap="round"
        />
        <path
          d={`M ${EAR_L.x + 20} 560 Q 627 360 ${EAR_R.x - 20} 560`}
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          stroke-width="6"
          stroke-linecap="round"
          opacity="0.5"
        />
        {/* Left cup */}
        <circle cx={EAR_L.x} cy={EAR_L.y} r="98" fill="#1a1a22" />
        <circle cx={EAR_L.x} cy={EAR_L.y} r="98" fill="none" stroke={shellHex} stroke-width="6" opacity="0.6" />
        <circle cx={EAR_L.x} cy={EAR_L.y} r="58" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={EAR_L.x - 16} cy={EAR_L.y - 16} r="14" fill={jadeBright} opacity="0.85" />
        {/* Right cup */}
        <circle cx={EAR_R.x} cy={EAR_R.y} r="98" fill="#1a1a22" />
        <circle cx={EAR_R.x} cy={EAR_R.y} r="98" fill="none" stroke={shellHex} stroke-width="6" opacity="0.6" />
        <circle cx={EAR_R.x} cy={EAR_R.y} r="58" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" begin="0.4s" />
        </circle>
        <circle cx={EAR_R.x - 16} cy={EAR_R.y - 16} r="14" fill={jadeBright} opacity="0.85" />
      </g>
    );
  }

  /* ── Earbuds: small jade orbs clipping onto the ear caps ── */
  if (headphonesId === "earbuds") {
    return (
      <g>
        <circle cx={EAR_L.x - 30} cy={EAR_L.y} r="34" fill={accent}>
          <animate attributeName="opacity" values="1;0.65;1" dur="2.8s" repeatCount="indefinite" />
        </circle>
        <circle cx={EAR_L.x - 30 - 8} cy={EAR_L.y - 8} r="10" fill={jadeBright} opacity="0.85" />
        {/* Tiny audio cable hint */}
        <path d={`M ${EAR_L.x - 30} ${EAR_L.y + 30} Q ${EAR_L.x - 60} ${EAR_L.y + 120} ${EAR_L.x - 30} ${EAR_L.y + 200}`} fill="none" stroke={accent} stroke-width="6" opacity="0.55" />

        <circle cx={EAR_R.x + 30} cy={EAR_R.y} r="34" fill={accent}>
          <animate attributeName="opacity" values="1;0.65;1" dur="2.8s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx={EAR_R.x + 30 - 8} cy={EAR_R.y - 8} r="10" fill={jadeBright} opacity="0.85" />
        <path d={`M ${EAR_R.x + 30} ${EAR_R.y + 30} Q ${EAR_R.x + 60} ${EAR_R.y + 120} ${EAR_R.x + 30} ${EAR_R.y + 200}`} fill="none" stroke={accent} stroke-width="6" opacity="0.55" />
      </g>
    );
  }

  /* ── Halo Loop: bold jade rings framing the side caps ── */
  if (headphonesId === "loop") {
    return (
      <g>
        <ellipse cx={EAR_L.x} cy={EAR_L.y} rx="60" ry="86" fill="none" stroke={accent} stroke-width="14" />
        <ellipse cx={EAR_L.x} cy={EAR_L.y} rx="36" ry="56" fill={accent} opacity="0.35">
          <animate attributeName="opacity" values="0.35;0.7;0.35" dur="2.4s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx={EAR_R.x} cy={EAR_R.y} rx="60" ry="86" fill="none" stroke={accent} stroke-width="14" />
        <ellipse cx={EAR_R.x} cy={EAR_R.y} rx="36" ry="56" fill={accent} opacity="0.35">
          <animate attributeName="opacity" values="0.35;0.7;0.35" dur="2.4s" repeatCount="indefinite" begin="0.6s" />
        </ellipse>
      </g>
    );
  }

  /* ── Wing Fins: angular jade fins slicing back ── */
  if (headphonesId === "fins") {
    const finL = `M ${EAR_L.x + 20} ${EAR_L.y - 80}
                  L ${EAR_L.x - 130} ${EAR_L.y - 30}
                  L ${EAR_L.x - 150} ${EAR_L.y + 30}
                  L ${EAR_L.x - 60} ${EAR_L.y + 50}
                  L ${EAR_L.x + 20} ${EAR_L.y + 70} Z`;
    const finR = `M ${EAR_R.x - 20} ${EAR_R.y - 80}
                  L ${EAR_R.x + 130} ${EAR_R.y - 30}
                  L ${EAR_R.x + 150} ${EAR_R.y + 30}
                  L ${EAR_R.x + 60} ${EAR_R.y + 50}
                  L ${EAR_R.x - 20} ${EAR_R.y + 70} Z`;
    return (
      <g>
        <path d={finL} fill={accent} />
        <path d={finL} fill="none" stroke={jadeBright} stroke-width="4" opacity="0.6" />
        <path d={finR} fill={accent} />
        <path d={finR} fill="none" stroke={jadeBright} stroke-width="4" opacity="0.6" />
      </g>
    );
  }

  return null;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Main component
 * ════════════════════════════════════════════════════════════════════════ */
export function AgentAvatarSvg({
  config,
  expression = "happy",
  className = "",
  size,
  static: isStatic = false,
}: AgentAvatarSvgProps) {
  const accent = getAccentHex(config?.accent);
  const chassisSpec = getChassisScale(config?.chassis);
  const eyesId = config?.eyes ?? "smile";
  const antennaId = config?.antenna ?? "jewel";
  const wingsId = config?.wings ?? "none";
  const headphonesId = config?.headphones ?? "bumper";
  // Base color → chassis (shell) directly. Pearl chassis on a default bot,
  // onyx chassis when the user picks the dark base, etc.
  const shellHex = getShellHex(config?.baseColor);
  const light = isLightBase(config?.baseColor);
  // The "visor" is the screen plate around the eyes (the inset face).
  // When the user picks a Visor Color, it overrides the auto contrast.
  const insetHex = getInsetHex(config?.baseColor, config?.visorColor);
  // Bezel: a slightly darker line on light chassis, slightly lighter on dark.
  const bezelHex = light ? darken(shellHex, 0.55) : lighten(shellHex, 0.45);
  // Bright accent for glints/highlights — tracks the chosen accent instead
  // of staying brand-jade so amber/coral/violet bots get matching sparkle.
  // For the default jade accent this lands on the brand jadeBright tone.
  const jadeBright = config?.accent && config.accent !== "jade"
    ? lighten(accent, 0.55)
    : BRAND_COLORS.jadeBright;

  const innerScale = `translate(627 627) scale(${chassisSpec.scaleX} ${chassisSpec.scaleY}) translate(-627 -627)`;
  const svgId = useMemo(() => {
    agentAvatarSvgInstanceCounter += 1;
    return `cux-agent-avatar-${agentAvatarSvgInstanceCounter}`;
  }, []);
  const shellGradientId = `${svgId}-shell-grad`;
  const insetGradientId = `${svgId}-inset-grad`;
  const auraGlowId = `${svgId}-aura-glow`;
  const botShadowId = `${svgId}-bot-shadow`;
  const orbitPathId = `${svgId}-orbit-path`;
  const sheenGradId = `${svgId}-sheen-grad`;
  const screenShadeGradId = `${svgId}-screen-shade`;
  const eyeGlowGradId = `${svgId}-eye-glow`;
  const clipShellId = `${svgId}-clip-shell`;
  const clipInsetId = `${svgId}-clip-inset`;

  return (
    <svg
      viewBox="0 0 1254 1254"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      data-testid="agent-avatar-svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={shellGradientId} cx="50%" cy="32%" r="75%">
          <stop offset="0%" stop-color={lighten(shellHex, 0.06)} />
          <stop offset="55%" stop-color={shellHex} />
          <stop offset="100%" stop-color={darken(shellHex, 0.08)} />
        </radialGradient>
        <radialGradient id={insetGradientId} cx="50%" cy="30%" r="75%">
          <stop offset="0%" stop-color={lighten(insetHex, 0.12)} />
          <stop offset="100%" stop-color={insetHex} />
        </radialGradient>
        <radialGradient id={auraGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color={accent} stop-opacity="0.55" />
          <stop offset="100%" stop-color={accent} stop-opacity="0" />
        </radialGradient>
        <filter id={botShadowId} x="-12%" y="-12%" width="124%" height="124%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="18" />
          <feOffset dy="14" result="off" />
          <feComponentTransfer><feFuncA type="linear" slope={light ? "0.18" : "0.42"} /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        {/* Diagonal glass sheen — sweeps across the upper shell */}
        <linearGradient id={sheenGradId} x1="0%" y1="0%" x2="78%" y2="92%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity={light ? 0.5 : 0.3} />
          <stop offset="32%" stop-color="#FFFFFF" stop-opacity={light ? 0.12 : 0.08} />
          <stop offset="48%" stop-color="#FFFFFF" stop-opacity="0" />
        </linearGradient>
        {/* Inner shadow at the top of the screen — gives the inset depth */}
        <linearGradient id={screenShadeGradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#000000" stop-opacity="0.42" />
          <stop offset="26%" stop-color="#000000" stop-opacity="0" />
          <stop offset="84%" stop-color="#FFFFFF" stop-opacity="0" />
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0.07" />
        </linearGradient>
        {/* Screen-light glow behind the eyes */}
        <radialGradient id={eyeGlowGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color={accent} stop-opacity="0.4" />
          <stop offset="100%" stop-color={accent} stop-opacity="0" />
        </radialGradient>
        <clipPath id={clipInsetId}><path d={PATH_INSET_FACE} /></clipPath>
      </defs>

      {/* Ambient aura — sits behind the tile */}
      {renderAura(wingsId, accent, jadeBright, orbitPathId)}

      {/* Big soft jade glow behind the tile */}
      <ellipse cx="627" cy="700" rx="600" ry="560" fill={`url(#${auraGlowId})`} opacity="0.55" />

      {/* Float wrap — bot only (no surrounding tile). The drop-shadow
          filter wraps every layer so the floating bot casts a soft shadow
          on whatever background the host provides. */}
      <g filter={`url(#${botShadowId})`}>
        {!isStatic && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 0,-14; 0,0"
            dur="4.2s"
            repeatCount="indefinite"
          />
        )}

        {/* Antenna sits above the bot */}
        <g transform={innerScale}>{renderAntenna(antennaId, accent, jadeBright, expression)}</g>

        <g transform={innerScale}>
          {/* White face shell + ear caps — the bot's body */}
          <path d={PATH_FACE_SHELL} fill={`url(#${shellGradientId})`} />
          <path d={PATH_EAR_LEFT} fill={`url(#${shellGradientId})`} />
          <path d={PATH_EAR_RIGHT} fill={`url(#${shellGradientId})`} />

          {/* Subtle inner edge highlight on top of the shell */}
          <path
            d={PATH_FACE_SHELL}
            fill="none"
            stroke={light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.25)"}
            stroke-width="3"
            opacity="0.7"
          />

          {/* Diagonal glass sheen sweeping over the ceramic shell */}
          <path d={PATH_FACE_SHELL} fill={`url(#${sheenGradId})`} pointer-events="none" />

          {/* Headphones — layered over the ear-cap area (skipped for "bumper") */}
          {renderHeadphones(headphonesId, accent, jadeBright, shellHex)}

          {/* Dark inset face — the screen */}
          <path d={PATH_INSET_FACE} fill={`url(#${insetGradientId})`} />

          {/* Screen depth — inner shadow at the top, faint lift at the bottom */}
          <path d={PATH_INSET_FACE} fill={`url(#${screenShadeGradId})`} pointer-events="none" />

          {/* Screen-light glow washing out from behind the eyes */}
          <g clip-path={`url(#${clipInsetId})`}>
            <ellipse cx={630} cy={700} rx="255" ry="115" fill={`url(#${eyeGlowGradId})`} pointer-events="none" />
          </g>

          {/* Bezel sliver — the dark line above the inset */}
          <path d={PATH_BEZEL_SLIVER} fill={bezelHex} />

          {/* Eyes inside the dark inset */}
          {renderEyes(eyesId, expression, accent, jadeBright)}

          {/* Inner glow inside the inset face — pulses subtly */}
          <ellipse cx={627} cy={700} rx="220" ry="120" fill={`url(#${auraGlowId})`} opacity="0.18" pointer-events="none">
            <animate attributeName="opacity" values="0.18;0.08;0.18" dur="3s" repeatCount="indefinite" />
          </ellipse>
        </g>
      </g>
    </svg>
  );
}

/* ── tiny color helpers ── */
function lighten(hex: string, factor: number): string {
  const m = hex.match(/^#?([\da-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(factor * 90));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(factor * 90));
  const b = Math.min(255, (n & 0xff) + Math.round(factor * 90));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function darken(hex: string, factor: number): string {
  const m = hex.match(/^#?([\da-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - factor)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
