/**
 * AgentAvatarSvg — pure-SVG companion-bot avatar, designed to mirror the
 * silhouette and personality of the WebGL scene so thumbnails and the 3D
 * preview feel like the same character.
 *
 * Used for card thumbnails and anywhere we'd otherwise blow through WebGL
 * contexts (browsers cap us at ~16). Same {config, expression} API as the
 * 3D scene.
 */
import { h } from "preact";
import type { AgentAvatarConfig } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { getAccentHex, getBaseColorHex } from "../../lib/agent-avatar.js";

interface AgentAvatarSvgProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  size?: number;
}

/* ── Silhouette path per chassis ──────────────────────────────────────
 * viewBox: 0..120 x 0..120, body roughly centered around (60, 60).
 * Each path is the outer body silhouette, drawn as a smooth bezier blob.
 */
function chassisPath(type?: string): string {
  switch (type) {
    case "egg":
      // EVE-style elongated companion egg
      return "M 60 14 C 84 14 92 36 92 58 C 92 86 78 100 60 100 C 42 100 28 86 28 58 C 28 36 36 14 60 14 Z";
    case "capsule":
      // Streamlined pod
      return "M 60 16 C 78 18 84 32 84 50 C 84 72 80 96 60 100 C 40 96 36 72 36 50 C 36 32 42 18 60 16 Z";
    case "square":
      // Wide bumper drum
      return "M 30 36 C 30 26 42 22 60 22 C 78 22 90 26 90 36 L 90 80 C 90 90 78 94 60 94 C 42 94 30 90 30 80 Z";
    default:
      // round → "Pebble" — friendly low-wide stone
      return "M 60 18 C 86 18 96 38 96 60 C 96 84 80 98 60 98 C 40 98 24 84 24 60 C 24 38 34 18 60 18 Z";
  }
}

/* ── Face plate (dark screen) sits on the upper-front of the body ── */
function facePlate(type?: string) {
  switch (type) {
    case "egg":
      return { cx: 60, cy: 50, rx: 22, ry: 19 };
    case "capsule":
      return { cx: 60, cy: 50, rx: 19, ry: 19 };
    case "square":
      return { cx: 60, cy: 52, rx: 26, ry: 18 };
    default:
      return { cx: 60, cy: 54, rx: 24, ry: 20 };
  }
}

/* ── Eye + brow rendering on the face plate ─────────────────────────── */
function renderFace(
  eyes: string | undefined,
  expr: AgentAvatarExpression,
  accent: string,
  plate: { cx: number; cy: number; rx: number; ry: number },
  bid: string,
) {
  const cx = plate.cx;
  const cy = plate.cy - 1; // eyes sit a touch above plate center

  const isHappy = expr === "happy";
  const isSad = expr === "sad";
  const isAngry = expr === "angry";
  const isSleepy = expr === "sleepy";
  const isBored = expr === "bored";
  const isHyped = expr === "hyped";

  const eyeYScale = isSleepy ? 0.18 : isBored ? 0.55 : isHyped ? 1.15 : isAngry ? 0.65 : isHappy ? 0.85 : 1.0;
  const showBrows = isAngry || isSad;
  const browTilt = isAngry ? 18 : isSad ? -22 : 0;

  // Mouth shape parameters
  let mouthD = `M ${cx - 7} ${cy + 12} Q ${cx} ${cy + 14} ${cx + 7} ${cy + 12}`; // neutral
  if (isHappy)  mouthD = `M ${cx - 8} ${cy + 11} Q ${cx} ${cy + 18} ${cx + 8} ${cy + 11}`;
  if (isHyped)  mouthD = `M ${cx - 10} ${cy + 10} Q ${cx} ${cy + 22} ${cx + 10} ${cy + 10}`;
  if (isSad)    mouthD = `M ${cx - 7} ${cy + 16} Q ${cx} ${cy + 10} ${cx + 7} ${cy + 16}`;
  if (isAngry)  mouthD = `M ${cx - 8} ${cy + 14} Q ${cx} ${cy + 10} ${cx + 8} ${cy + 14}`;
  if (isBored)  mouthD = `M ${cx - 7} ${cy + 13} L ${cx + 7} ${cy + 13}`;
  if (isSleepy) mouthD = `M ${cx - 5} ${cy + 14} Q ${cx} ${cy + 16} ${cx + 5} ${cy + 14}`;

  // Cheek glow
  const showCheeks = isHappy || isHyped;

  switch (eyes) {
    case "visor": {
      const w = isHyped ? 22 : isSleepy ? 18 : 20;
      const hgt = isSleepy ? 4 : isHyped ? 9 : 7;
      return (
        <g>
          <rect x={cx - w / 2} y={cy - hgt / 2} width={w} height={hgt} rx={hgt / 2} fill={accent} opacity="0.95">
            <animate attributeName="opacity" values="0.95;0.7;0.95" dur="2.8s" repeatCount="indefinite" />
          </rect>
          {!isSleepy && (
            <>
              <circle cx={cx - 5} cy={cy} r="1.6" fill="#0a0a14" />
              <circle cx={cx + 5} cy={cy} r="1.6" fill="#0a0a14" />
            </>
          )}
          <path d={mouthD} stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" />
          {showCheeks && (
            <g opacity="0.45">
              <circle cx={cx - 16} cy={cy + 8} r="3" fill="#ff9999" />
              <circle cx={cx + 16} cy={cy + 8} r="3" fill="#ff9999" />
            </g>
          )}
        </g>
      );
    }

    case "pixel": {
      const sz = isSleepy ? 3 : isHyped ? 8 : 6;
      return (
        <g>
          <rect x={cx - 9 - sz / 2} y={cy - sz / 2} width={sz} height={sz} rx="1" fill={accent}>
            <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" />
          </rect>
          <rect x={cx + 9 - sz / 2} y={cy - sz / 2} width={sz} height={sz} rx="1" fill={accent}>
            <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" begin="0.3s" />
          </rect>
          <path d={mouthD} stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
      );
    }

    case "cyclops": {
      const r = isSleepy ? 4 : isHyped ? 12 : 10;
      return (
        <g>
          {/* Sclera */}
          <circle cx={cx} cy={cy} r={r} fill="url(#sclera-grad-${bid})" />
          {/* Iris */}
          <circle cx={cx} cy={cy} r={r * 0.6} fill={accent} opacity="0.85" />
          {/* Pupil */}
          <circle cx={cx} cy={cy} r={r * 0.32} fill="#0a0a14" />
          {/* Glints */}
          <circle cx={cx + r * 0.22} cy={cy - r * 0.22} r={r * 0.13} fill="#fff" opacity="0.95" />
          <circle cx={cx - r * 0.20} cy={cy} r={r * 0.05} fill="#fff" opacity="0.7" />
          {/* Outer ring */}
          <circle cx={cx} cy={cy} r={r + 2} fill="none" stroke={accent} strokeWidth="1.2" opacity="0.5">
            <animate attributeName="opacity" values="0.5;0.2;0.5" dur="2.6s" repeatCount="indefinite" />
          </circle>
          <path d={mouthD} stroke={accent} strokeWidth="2" fill="none" strokeLinecap="round" />
          {showCheeks && (
            <g opacity="0.45">
              <circle cx={cx - 18} cy={cy + 8} r="3" fill="#ff9999" />
              <circle cx={cx + 18} cy={cy + 8} r="3" fill="#ff9999" />
            </g>
          )}
        </g>
      );
    }

    default: {
      // Dual eyes
      const r = isSleepy ? 3 : isHyped ? 8 : 6.5;
      const ry = r * eyeYScale;
      const eyeXs = [cx - 9, cx + 9];
      const pupilOffsetX = 0;
      const pupilOffsetY = 0;
      return (
        <g>
          {/* Eye whites with gradient */}
          {eyeXs.map((ex) => (
            <ellipse key={`s${ex}`} cx={ex} cy={cy} rx={r} ry={ry} fill={`url(#sclera-grad-${bid})`} />
          ))}
          {/* Iris */}
          {!isSleepy && eyeXs.map((ex) => (
            <ellipse key={`i${ex}`} cx={ex + pupilOffsetX} cy={cy + pupilOffsetY} rx={r * 0.55} ry={ry * 0.55} fill={accent} opacity="0.9" />
          ))}
          {/* Pupils */}
          {!isSleepy && eyeXs.map((ex) => (
            <ellipse key={`p${ex}`} cx={ex + pupilOffsetX} cy={cy + pupilOffsetY} rx={r * 0.3} ry={ry * 0.3} fill="#0a0a14" />
          ))}
          {/* Glints */}
          {!isSleepy && eyeXs.map((ex) => (
            <circle key={`g${ex}`} cx={ex + r * 0.22} cy={cy - ry * 0.22} r={r * 0.13} fill="#fff" opacity="0.95" />
          ))}
          {/* Sleepy closed lid line */}
          {isSleepy && eyeXs.map((ex) => (
            <line key={`l${ex}`} x1={ex - r} y1={cy} x2={ex + r} y2={cy} stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
          ))}
          {/* Brows */}
          {showBrows && eyeXs.map((ex, i) => {
            const tilt = browTilt * (i === 0 ? 1 : -1);
            return (
              <g key={`b${ex}`} transform={`rotate(${tilt} ${ex} ${cy - r - 3})`}>
                <line
                  x1={ex - r - 1}
                  y1={cy - r - 3}
                  x2={ex + r + 1}
                  y2={cy - r - 3}
                  stroke="#0a0a14"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          <path d={mouthD} stroke={accent} strokeWidth="2.2" fill="none" strokeLinecap="round" />
          {showCheeks && (
            <g opacity="0.5">
              <circle cx={cx - 18} cy={cy + 8} r="3" fill="#ff9999" />
              <circle cx={cx + 18} cy={cy + 8} r="3" fill="#ff9999" />
            </g>
          )}
          {/* Sleepy Z's */}
          {isSleepy && (
            <g fill={accent} opacity="0.55" font-family="ui-sans-serif, system-ui">
              <text x={cx + 22} y={cy - 12} fontSize="7" fontWeight="700">z</text>
              <text x={cx + 27} y={cy - 18} fontSize="5" fontWeight="700" opacity="0.7">z</text>
            </g>
          )}
        </g>
      );
    }
  }
}

/* ── Antenna ────────────────────────────────────────────────────────── */
function renderAntenna(type: string | undefined, accent: string, topY: number) {
  switch (type) {
    case "dual":
      return (
        <g>
          <line x1="50" y1={topY + 4} x2="44" y2={topY - 8} stroke="#7a8190" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="44" cy={topY - 9} r="3" fill={accent}>
            <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" />
          </circle>
          <line x1="70" y1={topY + 4} x2="76" y2={topY - 8} stroke="#7a8190" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="76" cy={topY - 9} r="3" fill={accent}>
            <animate attributeName="opacity" values="1;0.55;1" dur="2s" repeatCount="indefinite" begin="0.5s" />
          </circle>
        </g>
      );
    case "dish":
      return (
        <g>
          <line x1="60" y1={topY + 2} x2="60" y2={topY - 8} stroke="#7a8190" strokeWidth="2" strokeLinecap="round" />
          <path d={`M 50 ${topY - 8} Q 60 ${topY - 16} 70 ${topY - 8}`} fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round">
            <animate attributeName="opacity" values="0.9;0.45;0.9" dur="2.4s" repeatCount="indefinite" />
          </path>
          <circle cx="60" cy={topY - 8} r="2" fill={accent} />
        </g>
      );
    case "none":
      return null;
    default:
      return (
        <g>
          <line x1="60" y1={topY + 2} x2="60" y2={topY - 10} stroke="#7a8190" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="60" cy={topY - 11} r="3.5" fill={accent}>
            <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* halo */}
          <circle cx="60" cy={topY - 11} r="6" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.5">
            <animate attributeName="r" values="5;8;5" dur="2.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
          </circle>
        </g>
      );
  }
}

/* ── Aura: halo / boosters / hover rings / tiny wings ──────────────── */
function renderAura(type: string | undefined, accent: string, topY: number, bottomY: number) {
  switch (type) {
    case "jets":
      return (
        <g>
          {[26, 94].map((x) => (
            <g key={x}>
              <ellipse cx={x} cy={62} rx="4" ry="6" fill="#5b6472" />
              <ellipse cx={x} cy={70} rx="3" ry="6" fill={accent} opacity="0.7">
                <animate attributeName="ry" values="6;9;6" dur="0.45s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.7;0.35;0.7" dur="0.45s" repeatCount="indefinite" />
              </ellipse>
            </g>
          ))}
        </g>
      );
    case "hover":
      return (
        <g>
          <ellipse cx="60" cy={bottomY + 2} rx="32" ry="4" fill="none" stroke={accent} strokeWidth="1.6" opacity="0.55" strokeDasharray="4 3">
            <animate attributeName="opacity" values="0.55;0.2;0.55" dur="1.6s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="60" cy={bottomY + 6} rx="24" ry="3" fill="none" stroke={accent} strokeWidth="1.2" opacity="0.35" strokeDasharray="3 3">
            <animate attributeName="opacity" values="0.35;0.1;0.35" dur="1.6s" repeatCount="indefinite" begin="0.3s" />
          </ellipse>
        </g>
      );
    case "tiny":
      return (
        <g>
          <ellipse cx="22" cy="62" rx="9" ry="4" fill={accent} opacity="0.55" />
          <circle cx="14" cy="62" r="2" fill={accent} />
          <ellipse cx="98" cy="62" rx="9" ry="4" fill={accent} opacity="0.55" />
          <circle cx="106" cy="62" r="2" fill={accent} />
        </g>
      );
    default:
      // halo orbiting above the head
      return (
        <g>
          <ellipse cx="60" cy={topY + 2} rx="22" ry="5" fill="none" stroke={accent} strokeWidth="1.8" opacity="0.85">
            <animate attributeName="opacity" values="0.85;0.5;0.85" dur="2.2s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="60" cy={topY + 2} rx="26" ry="6.5" fill="none" stroke={accent} strokeWidth="0.8" opacity="0.35">
            <animate attributeName="opacity" values="0.35;0.1;0.35" dur="2.2s" repeatCount="indefinite" />
          </ellipse>
        </g>
      );
  }
}

/* ── Floating side hands (always shown — they're part of the character) ─ */
function renderHands(expr: AgentAvatarExpression, accent: string, baseColor: string) {
  const lift = expr === "happy" ? -6 : expr === "hyped" ? -12 : expr === "sad" ? 8 : expr === "sleepy" ? 10 : 0;
  return (
    <g>
      <ellipse cx={20} cy={62 + lift} rx="6" ry="9" fill={baseColor} stroke="#000" strokeOpacity="0.05" />
      <circle cx={22} cy={62 + lift} r="2" fill={accent} opacity="0.85" />
      <ellipse cx={100} cy={62 + lift} rx="6" ry="9" fill={baseColor} stroke="#000" strokeOpacity="0.05" />
      <circle cx={98} cy={62 + lift} r="2" fill={accent} opacity="0.85" />
    </g>
  );
}

/* ── Component ─────────────────────────────────────────────────────── */
export function AgentAvatarSvg({
  config,
  expression = "happy",
  className = "",
  size,
}: AgentAvatarSvgProps) {
  const accent = getAccentHex(config?.accent);
  const baseColor = getBaseColorHex(config?.baseColor);
  const chassis = config?.chassis ?? "round";
  const eyes = config?.eyes ?? "dual";
  const antenna = config?.antenna ?? "single";
  const wings = config?.wings ?? "propeller";

  // Stable per-instance id so gradient defs don't collide when many avatars
  // share a page (a SSR-safe deterministic value derived from config keys).
  const bid = `${chassis}-${eyes}-${(config?.accent ?? "j").slice(0, 2)}`;

  const plate = facePlate(chassis);

  // Body Y bounds derived from chassis path (roughly)
  const topY = chassis === "square" ? 22 : chassis === "egg" ? 14 : chassis === "capsule" ? 16 : 18;
  const bottomY = chassis === "square" ? 94 : 100;

  return (
    <svg
      viewBox="0 0 120 120"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      data-testid="agent-avatar-svg"
    >
      <defs>
        {/* Body lighting gradient: brighter top, darker base — gives depth */}
        <linearGradient id={`body-grad-${bid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lighten(baseColor, 0.25)} />
          <stop offset="55%" stopColor={baseColor} />
          <stop offset="100%" stopColor={darken(baseColor, 0.18)} />
        </linearGradient>
        {/* Sclera radial gradient for big rounded eyes */}
        <radialGradient id={`sclera-grad-${bid}`} cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="80%" stopColor="#dbe5f4" />
          <stop offset="100%" stopColor="#aeb8cc" />
        </radialGradient>
        {/* Soft drop shadow */}
        <filter id={`body-shadow-${bid}`} x="-20%" y="-10%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#000" floodOpacity="0.30" />
        </filter>
        {/* Face plate inner shadow */}
        <radialGradient id={`face-plate-${bid}`} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor="#1a1d2c" />
          <stop offset="100%" stopColor="#06070d" />
        </radialGradient>
      </defs>

      {/* contact shadow under the bot */}
      <ellipse cx="60" cy="112" rx="26" ry="3" fill="#000" opacity="0.25" />

      {/* gentle float */}
      <g>
        <animateTransform attributeName="transform" type="translate" values="0,0;0,-2.5;0,0" dur="3.4s" repeatCount="indefinite" />

        {/* aura behind the body */}
        {renderAura(wings, accent, topY, bottomY)}

        {/* antenna */}
        {renderAntenna(antenna, accent, topY)}

        {/* hands */}
        {renderHands(expression, accent, baseColor)}

        {/* main body */}
        <path
          d={chassisPath(chassis)}
          fill={`url(#body-grad-${bid})`}
          stroke={darken(baseColor, 0.25)}
          strokeWidth="1"
          filter={`url(#body-shadow-${bid})`}
        />

        {/* equator accent band */}
        <ellipse
          cx="60"
          cy={chassis === "square" ? 78 : chassis === "egg" ? 80 : 78}
          rx={chassis === "square" ? 30 : chassis === "egg" ? 30 : 33}
          ry="2.4"
          fill="none"
          stroke={accent}
          strokeWidth="1.2"
          opacity="0.7"
        />

        {/* face plate (dark screen) */}
        <ellipse
          cx={plate.cx}
          cy={plate.cy}
          rx={plate.rx}
          ry={plate.ry}
          fill={`url(#face-plate-${bid})`}
        />
        {/* bezel */}
        <ellipse
          cx={plate.cx}
          cy={plate.cy}
          rx={plate.rx}
          ry={plate.ry}
          fill="none"
          stroke={lighten(baseColor, 0.4)}
          strokeWidth="0.8"
          opacity="0.7"
        />

        {/* face content */}
        {renderFace(eyes, expression, accent, plate, bid)}

        {/* chest pip */}
        <circle cx="60" cy={chassis === "square" ? 86 : 88} r="2.2" fill={accent}>
          <animate attributeName="opacity" values="1;0.45;1" dur="2.6s" repeatCount="indefinite" />
        </circle>
      </g>
    </svg>
  );
}

/* ── Mini color helpers (string hex in / hex out) ──────────────────── */
function clamp255(n: number): number { return Math.max(0, Math.min(255, Math.round(n))); }
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp255(((n >> 16) & 0xff) + 255 * amount);
  const g = clamp255(((n >> 8) & 0xff) + 255 * amount);
  const b = clamp255((n & 0xff) + 255 * amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp255(((n >> 16) & 0xff) * (1 - amount));
  const g = clamp255(((n >> 8) & 0xff) * (1 - amount));
  const b = clamp255((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
