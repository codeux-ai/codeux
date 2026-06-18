import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { SVG_W, SVG_H, LANE_TOP, LANE_BOT, HARBOUR_X, FINISH_X, RACE_LEN } from "./constants.js";
import { hashStr } from "./utils.js";
import type { ShipDatum } from "../../hooks/useBoatRaceAnimation.js";
import { getBoatRaceCheckpoints } from "../../lib/boat-race.js";

import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export const CheckpointBuoy: FunctionComponent<{ x: number; label: string; color: string; isDark: boolean }> = memo(({ x, color, label, isDark }) => {
    const isReducedMotion = useReducedMotion();
    return (
    <g>
        {/* Dashed guide line */}
        <line x1={x} y1={LANE_TOP - 5} x2={x} y2={LANE_BOT + 5}
            stroke={isDark ? "white" : "black"} strokeWidth={0.3} strokeDasharray="3,12" opacity={0.06} />
        {/* Buoy body */}
        <g transform={`translate(${x}, ${LANE_TOP - 18})`}>
            <ellipse cx={0} cy={14} rx={8} ry={3} fill={color} opacity={0.06} />
            <rect x={-5} y={0} width={10} height={12} rx={3} fill={isDark ? "#0a1520" : "#e2d6c6"} stroke={color} strokeWidth={0.6} opacity={0.5} />
            {/* Buoy light */}
            <circle cx={0} cy={-2} r={2} fill={color} opacity={0.4}>
                {!isReducedMotion && <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />}
            </circle>
            {/* Label */}
            <text y={-8} textAnchor="middle" fill={color} fontSize={5.5} fontFamily="monospace"
                fontWeight="bold" letterSpacing="0.1em" opacity={0.4}>
                {label}
            </text>
        </g>
    </g>
    );
});

/* ─── Finish Line ────────────────────────────────────────────────────────── */

export const FinishLine: FunctionComponent<{ x: number; isDark: boolean }> = memo(({ x, isDark }) => {
    const isReducedMotion = useReducedMotion();
    return (
    <g>
        {/* Radial glow */}
        <ellipse cx={x} cy={SVG_H / 2} rx={60} ry={SVG_H * 0.65} fill="url(#br-finish-glow)" />

        {/* Finish gate — two poles with banner */}
        <line x1={x - 4} y1={24} x2={x - 4} y2={LANE_BOT + 12} stroke={isDark ? "#1a3050" : "#8395a7"} strokeWidth={2.5} opacity={0.5} />
        <line x1={x + 18} y1={24} x2={x + 18} y2={LANE_BOT + 12} stroke={isDark ? "#1a3050" : "#8395a7"} strokeWidth={2.5} opacity={0.5} />

        {/* Checkered banner */}
        <defs>
            <pattern id="br-checker" width="6" height="6" patternUnits="userSpaceOnUse">
                <rect width="3" height="3" fill={isDark ? "white" : "#1e293b"} opacity={0.6} />
                <rect x="3" y="3" width="3" height="3" fill={isDark ? "white" : "#1e293b"} opacity={0.6} />
            </pattern>
        </defs>
        <rect x={x - 2} y={24} width={18} height={14} rx={1.5} fill="url(#br-checker)" opacity={isDark ? 0.4 : 0.5}>
            {!isReducedMotion && <animate attributeName="width" values="18;19.5;18" dur="2.5s" repeatCount="indefinite" />}
        </rect>

        {/* Glow line */}
        <line x1={x - 8} y1={LANE_TOP - 12} x2={x - 8} y2={LANE_BOT + 12}
            stroke="#00E0A0" strokeWidth={1.8} opacity={0.08}>
            {!isReducedMotion && <animate attributeName="opacity" values="0.08;0.2;0.08" dur="2.5s" repeatCount="indefinite" />}
        </line>
        <line x1={x - 8} y1={LANE_TOP - 12} x2={x - 8} y2={LANE_BOT + 12}
            stroke="#00E0A0" strokeWidth={6} opacity={0.02} filter="url(#br-glow2)">
            {!isReducedMotion && <animate attributeName="opacity" values="0.02;0.06;0.02" dur="2.5s" repeatCount="indefinite" />}
        </line>

        {/* Top lights */}
        <circle cx={x - 4} cy={22} r={2.5} fill="#00E0A0" opacity={0.4} filter="url(#br-glow)">
            {!isReducedMotion && <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />}
        </circle>
        <circle cx={x + 18} cy={22} r={2.5} fill="#00E0A0" opacity={0.4} filter="url(#br-glow)">
            {!isReducedMotion && <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" begin="0.5s" />}
        </circle>

        {/* FINISH label */}
        <text x={x + 7} y={SVG_H - 16} textAnchor="middle" fill="#00E0A0" fontSize={7.5} fontFamily="monospace"
            fontWeight="bold" letterSpacing="0.3em" opacity={0.3}>
            FINISH
        </text>
    </g>
    );
});

/* ─── Celestial body (moon in dark mode, sun in light mode) ──────────────── */

const STAR_DATA = Array.from({ length: 30 }, (_, i) => ({
    cx: 40 + hashStr(`sx${i}`) % (SVG_W - 80),
    cy: 4 + hashStr(`sy${i}`) % 55,
    r: 0.3 + (hashStr(`sr${i}`) % 8) / 10,
    dur: 2 + (hashStr(`sd${i}`) % 40) / 10,
    op: 0.04 + (hashStr(`so${i}`) % 10) / 100,
}));

export const CelestialBody: FunctionComponent<{ isDark: boolean }> = memo(({ isDark }) => {
    const isReducedMotion = useReducedMotion();
    if (isDark) {
        return (
            <g>
                {/* Moon glow */}
                <circle cx={SVG_W * 0.88} cy={28} r={22} fill="#E8E4D0" opacity={0.04} />
                <circle cx={SVG_W * 0.88} cy={28} r={16} fill="#E8E4D0" opacity={0.06} />
                <circle cx={SVG_W * 0.88} cy={28} r={11} fill="#F0ECD8" opacity={0.08} />
                {/* Crescent shadow */}
                <circle cx={SVG_W * 0.88 + 5} cy={26} r={9} fill="#030810" opacity={0.06} />
                {/* Stars */}
                {STAR_DATA.map((star, i) => {
                    return (
                        <circle key={`s${i}`} cx={star.cx} cy={star.cy} r={star.r} fill="white" opacity={star.op}>
                            {!isReducedMotion && <animate attributeName="opacity" values={`${star.op};${star.op + 0.12};${star.op}`} dur={`${star.dur}s`} repeatCount="indefinite" />}
                        </circle>
                    );
                })}
            </g>
        );
    }
    // Light mode: sun
    return (
        <g>
            {/* Sun glow */}
            <circle cx={SVG_W * 0.85} cy={36} r={40} fill="#FFB800" opacity={0.04} />
            <circle cx={SVG_W * 0.85} cy={36} r={24} fill="#FFB800" opacity={0.06} />
            <circle cx={SVG_W * 0.85} cy={36} r={14} fill="#FFD060" opacity={0.12} />
            {/* Sun rays */}
            {[...Array(8)].map((_, i) => {
                const angle = (i * 45) * Math.PI / 180;
                const x1 = SVG_W * 0.85 + Math.cos(angle) * 18;
                const y1 = 36 + Math.sin(angle) * 18;
                const x2 = SVG_W * 0.85 + Math.cos(angle) * 32;
                const y2 = 36 + Math.sin(angle) * 32;
                return (
                    <line key={`ray${i}`} x1={x1} y1={y1} x2={x2} y2={y2}
                        stroke="#FFB800" strokeWidth={1.5} opacity={0.08} strokeLinecap="round">
                        {!isReducedMotion && <animate attributeName="opacity" values="0.08;0.15;0.08" dur={`${3 + i * 0.3}s`} repeatCount="indefinite" />}
                    </line>
                );
            })}
            {/* Light clouds */}
            {[[180, 20], [400, 35], [900, 15]].map(([cx, cy], i) => (
                <g key={`cloud${i}`} opacity={0.06}>
                    <ellipse cx={cx} cy={cy} rx={30} ry={8} fill="#64748b" />
                    <ellipse cx={(cx as number) + 20} cy={(cy as number) - 3} rx={20} ry={7} fill="#64748b" />
                    <ellipse cx={(cx as number) - 15} cy={(cy as number) + 2} rx={18} ry={6} fill="#64748b" />
                </g>
            ))}
        </g>
    );
});

/* ─── Subtle wave lines (transparent-friendly, works on any background) ──── */

export const SubtleWaves: FunctionComponent<{ isDark: boolean }> = memo(({ isDark }) => {
    const isReducedMotion = useReducedMotion();
    const waveColor = isDark ? "white" : "#334155";
    return (
        <g>
            {[80, 140, 200, 260, 320, 380].map((y, i) => {
                const amp = 3 + i * 0.6;
                const freq = 160 + i * 15;
                const dur = 7 + i * 1.5;
                const op = isDark ? 0.02 + i * 0.004 : 0.03 + i * 0.005;
                const curves = Array.from({ length: 10 }, (_, j) => {
                    const x0 = -100 + j * freq;
                    const x1 = x0 + freq / 2;
                    const x2 = x0 + freq;
                    return `Q${x1} ${y - amp} ${x2} ${y}`;
                }).join(" ");
                return (
                    <path key={i} d={`M-100 ${y} ${curves}`} fill="none" stroke={waveColor} strokeWidth={0.4} opacity={op}>
                        {!isReducedMotion && <animateTransform attributeName="transform" type="translate"
                            values={`0 0; ${freq / 3} ${amp * 0.4}; 0 0`}
                            dur={`${dur}s`} repeatCount="indefinite" />}
                    </path>
                );
            })}
        </g>
    );
});



export const BoatRaceBackground = memo(({ isDark, ripples }: { isDark: boolean; ripples: {x: number, y: number, id: number}[] }) => {
    const isReducedMotion = useReducedMotion();
    return (
        <g>
            <defs>
                <linearGradient id="br-wake" x1="1" y1="0.5" x2="0" y2="0.5">
                    <stop offset="0%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.14} />
                    <stop offset="50%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.04} />
                    <stop offset="100%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0} />
                </linearGradient>
                <radialGradient id="br-harbour-glow" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#FFB800" stopOpacity={isDark ? 0.06 : 0.04} />
                    <stop offset="100%" stopColor="transparent" />
                </radialGradient>
                <radialGradient id="br-finish-glow" cx="0.5" cy="0.5" r="0.5">
                    <stop offset="0%" stopColor="#00AB84" stopOpacity={isDark ? 0.08 : 0.05} />
                    <stop offset="100%" stopColor="transparent" />
                </radialGradient>
                <filter id="br-glow"><feGaussianBlur stdDeviation="2.5" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id="br-glow2"><feGaussianBlur stdDeviation="6" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id="br-ripple"><feGaussianBlur stdDeviation="1.5" /></filter>
            </defs>
            <CelestialBody isDark={isDark} />
            <SubtleWaves isDark={isDark} />
            {ripples.map(r => (
                <g key={r.id}>
                    <circle cx={r.x} cy={r.y} r={2} fill="none"
                        stroke={isDark ? "white" : "#334155"} strokeWidth={0.5} opacity={isReducedMotion ? 0.12 : 0}>
                        {!isReducedMotion && <animate attributeName="r" values="2;40" dur="2s" fill="freeze" />}
                        {!isReducedMotion && <animate attributeName="opacity" values="0.12;0" dur="2s" fill="freeze" />}
                    </circle>
                    <circle cx={r.x} cy={r.y} r={2} fill="none"
                        stroke={isDark ? "white" : "#334155"} strokeWidth={0.3} opacity={isReducedMotion ? 0.08 : 0}>
                        {!isReducedMotion && <animate attributeName="r" values="2;25" dur="1.5s" fill="freeze" />}
                        {!isReducedMotion && <animate attributeName="opacity" values="0.08;0" dur="1.5s" fill="freeze" />}
                    </circle>
                </g>
            ))}
        </g>
    );
});

const buoys = getBoatRaceCheckpoints();

export const BoatRaceCourseLayer = memo(({ isDark, activeShips }: { isDark: boolean; activeShips: ShipDatum[] }) => {
    return (
        <g>
            {buoys.map(b => (
                <CheckpointBuoy key={b.label}
                    x={HARBOUR_X + 20 + b.progress * RACE_LEN}
                    label={b.label}
                    color={b.color}
                    isDark={isDark}
                />
            ))}
            <FinishLine x={FINISH_X} isDark={isDark} />
            {activeShips.map(s => (
                <line key={`ln-${s.key}`}
                    x1={HARBOUR_X + 40} y1={s.laneY + 16} x2={FINISH_X - 20} y2={s.laneY + 16}
                    stroke={isDark ? "white" : "black"} strokeWidth={0.2} strokeDasharray="2,24" opacity={0.025} />
            ))}
        </g>
    );
});
