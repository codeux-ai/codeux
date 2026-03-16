import type { FunctionComponent } from "preact";
import { useRef, useMemo, useEffect, useCallback, useState } from "preact/hooks";
import gsap from "gsap";
import { Anchor } from "lucide-preact";
import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface BoatRaceProps {
    tasks: Subtask[];
    dispatches: ExecutionTaskDispatchSummary[];
    hasLiveSprint: boolean;
}

/* ─── Deterministic hash — stable across renders ─────────────────────────── */

const hashStr = (s: string): number => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
};

const stableRand = (id: string, salt = 0): number =>
    (hashStr(`${id}:${salt}`) % 10000) / 10000;

/* ─── Dark mode detection ────────────────────────────────────────────────── */

const useIsDark = (): boolean => {
    const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
    useEffect(() => {
        const observer = new MutationObserver(() => {
            setIsDark(document.documentElement.classList.contains("dark"));
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        return () => observer.disconnect();
    }, []);
    return isDark;
};

/* ─── Ship type: docker → container, mcp/local → wooden ─────────────────── */

const getShipType = (task: Subtask, dispatches: ExecutionTaskDispatchSummary[]): "container" | "wooden" => {
    const d = dispatches.find(dd => dd.taskKey === task.id || dd.taskId === task.record_id);
    if (d?.executorType === "docker_cli") return "container";
    if (d?.executorType === "mcp_worker") return "wooden";
    if (task.provider === "jules") return "wooden";
    return "container";
};

/* ─── Checkpoint system for continuous movement ──────────────────────────── */

// Checkpoints define confirmed positions along the course (0–1)
const CP = {
    HARBOUR:    0.00,
    DEPARTURE:  0.04,
    RUNNING:    0.25,   // target for running ships — 1/4 into the race
    COMPLETED:  0.48,
    COMP_TARGET: 0.56,
    CI:         0.62,
    CI_TARGET:  0.72,
    AUTOMERGE:  0.78,
    AM_TARGET:  0.90,
    MERGED:     0.96,
    FINISH:     1.06,   // past finish line so merged ships visually cross it
} as const;

// Half-life for Zeno's paradox: ship covers half remaining distance in this many ms
const HALF_LIFE_MS = 40_000;

interface ProgressTarget {
    confirmed: number; // minimum position (status guarantees ship is at least here)
    target: number;    // next checkpoint ship drifts toward
    stopped: boolean;  // true if ship should not animate (failed/blocked)
}

const getProgressTarget = (task: Subtask): ProgressTarget => {
    switch (task.status) {
        case "PENDING":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "BLOCKED":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "FAILED":   return { confirmed: CP.DEPARTURE + stableRand(task.id, 30) * 0.12, target: CP.DEPARTURE + stableRand(task.id, 30) * 0.12, stopped: true };
        case "RUNNING":  return { confirmed: CP.DEPARTURE, target: CP.RUNNING, stopped: false };
        case "COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "MERGED")         return { confirmed: CP.MERGED, target: CP.FINISH, stopped: false };
            if (mi === "AUTOMERGE")      return { confirmed: CP.AUTOMERGE, target: CP.AM_TARGET, stopped: false };
            if (mi === "CI")             return { confirmed: CP.CI, target: CP.CI_TARGET, stopped: false };
            if (mi === "MERGE_BLOCKED")  return { confirmed: CP.COMPLETED, target: CP.COMPLETED, stopped: true };
            if (mi === "MERGE_CONFLICT") return { confirmed: CP.COMPLETED, target: CP.COMPLETED, stopped: true };
            return { confirmed: CP.COMPLETED, target: CP.COMP_TARGET, stopped: false };
        }
        default: return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
    }
};

/* ─── Status → visual style ──────────────────────────────────────────────── */

interface StatusStyle { color: string; label: string; dim: boolean }

const getStyle = (task: Subtask): StatusStyle => {
    switch (task.status) {
        case "RUNNING":   return { color: "#00E0A0", label: "Racing",    dim: false };
        case "COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "MERGED")         return { color: "#00E0A0", label: "Merged",     dim: false };
            if (mi === "AUTOMERGE")      return { color: "#FFB800", label: "Automerge",  dim: false };
            if (mi === "CI")             return { color: "#5dade2", label: "CI",         dim: false };
            if (mi === "MERGE_BLOCKED")  return { color: "#F59E0B", label: "Blocked",    dim: false };
            if (mi === "MERGE_CONFLICT") return { color: "#E3000F", label: "Conflict",   dim: false };
            return { color: "#00AB84", label: "Completed", dim: false };
        }
        case "FAILED":  return { color: "#E3000F", label: "Failed",  dim: true };
        case "BLOCKED": return { color: "#F59E0B", label: "Blocked", dim: true };
        case "PENDING": return { color: "#475569", label: "Queued",  dim: true };
        default:        return { color: "#475569", label: "—",       dim: true };
    }
};

/* ─── Layout constants ───────────────────────────────────────────────────── */

const SVG_W = 1400;
const SVG_H = 440;
const HARBOUR_X = 100;
const FINISH_X = 1320;
const RACE_LEN = FINISH_X - HARBOUR_X - 40;
const LANE_TOP = 100;
const LANE_BOT = SVG_H - 60;
const MAX_SHIPS = 10;

/* ─── Ship data ──────────────────────────────────────────────────────────── */

interface ShipDatum {
    id: string;
    task: Subtask;
    shipType: "container" | "wooden";
    progress: ProgressTarget;
    laneY: number;       // target lane Y (ships spread to this)
    style: StatusStyle;
}

// Center Y where all ships spawn before spreading
const SPAWN_Y = (LANE_TOP + LANE_BOT) / 2;

/* ─── SVG: Container Ship ────────────────────────────────────────────────── */

const ContainerShip: FunctionComponent<{ accentColor: string; dim: boolean; isMoving: boolean; isDark: boolean }> = ({ accentColor, dim, isMoving, isDark }) => {
    const o = dim ? 0.35 : 1;
    const hullFill = isDark ? "#0f1d33" : "#c8d6e5";
    const hullStroke = isDark ? "#1a3050" : "#8395a7";
    const deckFill = isDark ? "#162840" : "#a4b0be";
    const bridgeFill = isDark ? "#1a2d50" : "#8395a7";
    const bridgeStroke = isDark ? "#25406a" : "#576574";
    const funnelFill = isDark ? "#1e3450" : "#8395a7";
    const windowFill = isDark ? "#4a8ad4" : "#2e86de";
    const smokeFill = isDark ? "#b8c8d8" : "#636e72";
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={24} rx={46} ry={8} fill={accentColor} opacity={0.08}>
                {isMoving && <animate attributeName="ry" values="8;10;8" dur="2.5s" repeatCount="indefinite" />}
            </ellipse>
            {/* Hull shadow */}
            <ellipse cx={3} cy={20} rx={40} ry={6} fill={isDark ? "black" : "#2d3436"} opacity={isDark ? 0.4 : 0.15} />
            {/* Hull */}
            <path d="M-40 3 L-35 16 Q-32 20 0 20 Q32 20 35 16 L40 3 L34 -6 Q20 -10 0 -10 Q-20 -10 -34 -6 Z"
                fill={hullFill} stroke={hullStroke} strokeWidth={0.8} />
            {/* Waterline accent */}
            <path d="M-35 16 Q0 21 35 16 Q32 20 0 20 Q-32 20 -35 16 Z"
                fill={accentColor} opacity={0.18} />
            {/* Deck */}
            <rect x={-33} y={-7} width={66} height={9} rx={1.5} fill={deckFill} />
            {/* Containers row 1 */}
            {[["#E74C3C", -29], ["#3498DB", -18], ["#F1C40F", -7], ["#2ECC71", 4], ["#9B59B6", 15]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-10} width={10} height={7} rx={1.2} fill={c as string} opacity={0.85} />
            )}
            {/* Containers row 2 */}
            {[["#E67E22", -26], ["#1ABC9C", -15], ["#E74C3C", -4], ["#3498DB", 7]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-17} width={10} height={6.5} rx={1.2} fill={c as string} opacity={0.65} />
            )}
            {/* Bridge */}
            <rect x={-6} y={-29} width={12} height={12} rx={2} fill={bridgeFill} stroke={bridgeStroke} strokeWidth={0.6} />
            {/* Bridge windows */}
            <rect x={-4.5} y={-27} width={9} height={4} rx={1} fill={windowFill} opacity={isDark ? 0.25 : 0.5} />
            <rect x={-4.5} y={-22} width={9} height={2.5} rx={0.6} fill={windowFill} opacity={isDark ? 0.15 : 0.35} />
            {/* Funnel */}
            <rect x={-3} y={-37} width={6} height={8} rx={1.8} fill={funnelFill} />
            <rect x={-2.5} y={-37.5} width={5} height={2.5} rx={1} fill={accentColor} opacity={0.9} />
            {/* Radar mast */}
            <line x1={0} y1={-29} x2={0} y2={-40} stroke={bridgeStroke} strokeWidth={0.8} />
            <circle cx={0} cy={-40.5} r={1.2} fill={accentColor} opacity={0.5}>
                <animate attributeName="opacity" values="0.5;0.1;0.5" dur="1.8s" repeatCount="indefinite" />
            </circle>
            {/* Nav lights */}
            <circle cx={-36} cy={0} r={1.5} fill="#E3000F" opacity={0.7} />
            <circle cx={36} cy={0} r={1.5} fill="#2ECC71" opacity={0.7} />
            {/* Smoke when moving */}
            {isMoving && (
                <g opacity={0.12}>
                    {[0, 1, 2, 3, 4].map(j => (
                        <circle key={j} cx={-2 + j * 0.8} cy={-37} r={1} fill={smokeFill}>
                            <animate attributeName="cy" values="-37;-62" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                            <animate attributeName="r" values="1;5" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                            <animate attributeName="opacity" values="0.2;0" dur={`${2 + j * 0.5}s`} repeatCount="indefinite" begin={`${j * 0.5}s`} />
                        </circle>
                    ))}
                </g>
            )}
        </g>
    );
};

/* ─── SVG: Wooden Ship ───────────────────────────────────────────────────── */

const WoodenShip: FunctionComponent<{ accentColor: string; dim: boolean; isMoving: boolean; isDark: boolean }> = ({ accentColor, dim, isMoving, isDark }) => {
    const o = dim ? 0.35 : 1;
    const hullFill = isDark ? "#5C3D0E" : "#8B6914";
    const hullStroke = isDark ? "#7A5518" : "#A67B20";
    const plankStroke = isDark ? "#4A3008" : "#7A5518";
    const deckFill = isDark ? "#7A5518" : "#A67B20";
    const mastStroke = isDark ? "#4A3008" : "#5C3D0E";
    const sailFill = isDark ? "#F5EFE0" : "#FFF8E7";
    const sailStroke = isDark ? "#C9BFA8" : "#B8A888";
    const cabinFill = isDark ? "#4A3008" : "#7A5518";
    const windowFill = isDark ? "#FFD080" : "#FFE0A0";
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={24} rx={38} ry={7} fill={accentColor} opacity={0.06}>
                {isMoving && <animate attributeName="ry" values="7;9;7" dur="2.8s" repeatCount="indefinite" />}
            </ellipse>
            {/* Hull shadow */}
            <ellipse cx={3} cy={20} rx={36} ry={5.5} fill={isDark ? "black" : "#2d3436"} opacity={isDark ? 0.35 : 0.12} />
            {/* Hull */}
            <path d="M-32 5 Q-36 5 -32 17 L-24 20 Q0 22 24 20 L32 17 Q36 5 32 5 Z"
                fill={hullFill} stroke={hullStroke} strokeWidth={0.9} />
            {/* Hull planking */}
            <path d="M-29 10 Q0 8 29 10" fill="none" stroke={plankStroke} strokeWidth={0.5} opacity={0.45} />
            <path d="M-27 14 Q0 12 27 14" fill="none" stroke={plankStroke} strokeWidth={0.4} opacity={0.35} />
            {/* Keel highlight */}
            <path d="M-32 17 Q0 20 32 17 Q30 19 0 19 Q-30 19 -32 17 Z"
                fill={accentColor} opacity={0.1} />
            {/* Deck */}
            <path d="M-28 5 Q0 2 28 5 Q22 2 0 2 Q-22 2 -28 5 Z" fill={deckFill} opacity={0.85} />
            {/* Railing */}
            {[-22, -14, -6, 2, 10, 18].map(x => (
                <line key={x} x1={x} y1={2} x2={x} y2={-1.5} stroke={isDark ? "#8B6914" : "#A67B20"} strokeWidth={0.5} opacity={0.35} />
            ))}
            <line x1={-24} y1={-1} x2={24} y2={-1} stroke={isDark ? "#8B6914" : "#A67B20"} strokeWidth={0.5} opacity={0.3} />
            {/* Main mast */}
            <line x1={-2} y1={2} x2={-2} y2={-48} stroke={mastStroke} strokeWidth={3} />
            {/* Cross spars */}
            <line x1={-22} y1={-36} x2={18} y2={-36} stroke={mastStroke} strokeWidth={2} />
            <line x1={-18} y1={-24} x2={14} y2={-24} stroke={mastStroke} strokeWidth={1.3} />
            {/* Main sail */}
            <path d="M0 -46 Q22 -34 22 -14 L0 -10 Z" fill={sailFill} opacity={0.92} stroke={sailStroke} strokeWidth={0.6}>
                <animate attributeName="d"
                    values="M0 -46 Q22 -34 22 -14 L0 -10 Z;M0 -46 Q24 -33 23 -13 L0 -10 Z;M0 -46 Q22 -34 22 -14 L0 -10 Z"
                    dur="5s" repeatCount="indefinite" />
            </path>
            {/* Topsail */}
            <path d="M0 -46 Q14 -42 14 -36 L0 -34 Z" fill={sailFill} opacity={0.7} stroke={sailStroke} strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M0 -46 Q14 -42 14 -36 L0 -34 Z;M0 -46 Q15 -41 15 -35 L0 -34 Z;M0 -46 Q14 -42 14 -36 L0 -34 Z"
                    dur="4s" repeatCount="indefinite" />
            </path>
            {/* Jib */}
            <path d="M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z" fill={sailFill} opacity={0.75} stroke={sailStroke} strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z;M-4 -44 Q-20 -31 -19 -13 L-4 -12 Z;M-4 -44 Q-18 -32 -18 -14 L-4 -12 Z"
                    dur="4.5s" repeatCount="indefinite" />
            </path>
            {/* Rigging */}
            <line x1={-2} y1={-46} x2={22} y2={-14} stroke={mastStroke} strokeWidth={0.3} opacity={0.3} />
            <line x1={-2} y1={-46} x2={-18} y2={-14} stroke={mastStroke} strokeWidth={0.3} opacity={0.3} />
            {/* Flag */}
            <path d="M-2 -48 L10 -46 L-2 -44" fill={accentColor} opacity={0.9}>
                <animate attributeName="d"
                    values="M-2 -48 L10 -46 L-2 -44;M-2 -48 L11 -45.5 L-2 -44;M-2 -48 L10 -46 L-2 -44"
                    dur="2s" repeatCount="indefinite" />
            </path>
            {/* Fore mast */}
            <line x1={18} y1={3} x2={18} y2={-22} stroke={mastStroke} strokeWidth={1.6} />
            {/* Cabin */}
            <rect x={-20} y={-4.5} width={12} height={6.5} rx={1.5} fill={cabinFill} opacity={0.75} />
            <rect x={-18} y={-3.5} width={4.5} height={4} rx={0.8} fill={windowFill} opacity={0.35} />
            <rect x={-12.5} y={-3.5} width={3.5} height={4} rx={0.8} fill={windowFill} opacity={0.25} />
            {/* Lanterns */}
            <circle cx={30} cy={4} r={2} fill="#FFB800" opacity={0.6}>
                <animate attributeName="opacity" values="0.6;0.15;0.6" dur="3.5s" repeatCount="indefinite" />
            </circle>
            <circle cx={-30} cy={8} r={1.4} fill={accentColor} opacity={0.4}>
                <animate attributeName="opacity" values="0.4;0.1;0.4" dur="2.5s" repeatCount="indefinite" />
            </circle>
        </g>
    );
};

/* ─── Tow line: animated dots connecting ship to trailing badge ──────────── */

const TowLine: FunctionComponent<{ color: string; length: number }> = ({ color, length }) => {
    const dotCount = 5;
    const spacing = length / (dotCount + 1);
    return (
        <g>
            {/* Main tow rope line */}
            <line x1={0} y1={0} x2={-length} y2={0}
                stroke={color} strokeWidth={0.5} opacity={0.15} strokeDasharray="2,3" />
            {/* Animated dots along the line */}
            {Array.from({ length: dotCount }, (_, i) => {
                const cx = -(spacing * (i + 1));
                const delay = i * 0.18;
                return (
                    <circle key={i} cx={cx} cy={0} r={1.8 - i * 0.15} fill={color} opacity={0.4}>
                        <animate attributeName="cy" values="0;-2;0;2;0" dur="1.6s"
                            repeatCount="indefinite" begin={`${delay}s`} />
                        <animate attributeName="opacity" values="0.4;0.7;0.4" dur="1.6s"
                            repeatCount="indefinite" begin={`${delay}s`} />
                    </circle>
                );
            })}
        </g>
    );
};

/* ─── Status badge (trailing behind ship) ────────────────────────────────── */

const ShipBadge: FunctionComponent<{
    taskId: string;
    title: string;
    style: StatusStyle;
    mergeIndicator?: string;
    isRunning: boolean;
    isDark: boolean;
}> = ({ taskId, title, style, mergeIndicator, isRunning, isDark }) => {
    const pillBg = isDark ? "rgba(4,8,16,0.92)" : "rgba(255,255,255,0.92)";
    const textColor = isDark ? "white" : "#1e293b";
    return (
        <g>
            {/* Halo glow */}
            <circle r={22} fill={style.color} opacity={0.06} />
            {/* Pill background */}
            <rect x={-58} y={-12} width={116} height={24} rx={12}
                fill={pillBg} stroke={style.color} strokeWidth={0.8} strokeOpacity={0.5} />
            {/* Running pulse ring */}
            {isRunning && (
                <rect x={-58} y={-12} width={116} height={24} rx={12}
                    fill="none" stroke={style.color} strokeWidth={0.9} opacity={0}>
                    <animate attributeName="opacity" values="0;0.4;0" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="x" values="-58;-61" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="y" values="-12;-15" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="width" values="116;122" dur="2s" repeatCount="indefinite" />
                    <animate attributeName="height" values="24;30" dur="2s" repeatCount="indefinite" />
                </rect>
            )}
            {/* Status dot */}
            <circle cx={-42} cy={0} r={isRunning ? 3.5 : 2.5} fill={style.color}>
                {isRunning && (
                    <>
                        <animate attributeName="r" values="3.5;4.5;3.5" dur="1.5s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
                    </>
                )}
            </circle>
            {/* Label */}
            <text x={-32} y={1} fill={style.color} fontSize={7.5} fontFamily="monospace" fontWeight="bold" opacity={0.9}
                dominantBaseline="middle">{style.label}</text>
            {/* Task ID */}
            <text x={16} y={1} fill={textColor} fontSize={7.5} fontFamily="monospace" fontWeight="bold" opacity={isDark ? 0.4 : 0.5}
                dominantBaseline="middle">#{taskId}</text>
            {/* Merge indicator badge */}
            {mergeIndicator && (
                <g transform="translate(44, 0)">
                    <circle r={7} fill={
                        mergeIndicator === "MERGED" ? "#00AB84"
                        : mergeIndicator === "CI" ? "#5dade2"
                        : mergeIndicator === "MERGE_CONFLICT" ? "#E3000F"
                        : "#F59E0B"
                    } opacity={0.85} />
                    <text y={0.5} textAnchor="middle" fill="white" fontSize={5.2} fontWeight="bold" fontFamily="monospace"
                        dominantBaseline="middle">
                        {mergeIndicator === "MERGED" ? "M" : mergeIndicator === "CI" ? "CI"
                        : mergeIndicator === "MERGE_CONFLICT" ? "!" : "AM"}
                    </text>
                </g>
            )}
            {/* Title */}
            <text y={20} textAnchor="middle" fill={textColor} fontSize={6.5} fontFamily="monospace" opacity={isDark ? 0.2 : 0.3}>
                {title.length > 34 ? title.slice(0, 32) + "…" : title}
            </text>
        </g>
    );
};

/* ─── Harbour Building SVG ───────────────────────────────────────────────── */

const HarbourBuilding: FunctionComponent<{ x: number; waitingCount: number; isDark: boolean }> = ({ x, waitingCount, isDark }) => {
    const buildingFill = isDark ? "#0c1825" : "#c8d6e5";
    const buildingStroke = isDark ? "#162840" : "#8395a7";
    const roofFill = isDark ? "#101c2e" : "#a4b0be";
    const roofStroke = isDark ? "#1a3050" : "#8395a7";
    const pilingFill = isDark ? "#0e1e30" : "#a4b0be";
    const plankStroke = isDark ? "#152540" : "#8395a7";
    const windowGlow = isDark ? "#FFCC44" : "#FFB800";
    const windowBg = isDark ? "#FFB800" : "#F59E0B";
    const labelColor = isDark ? "#1a3050" : "#8395a7";
    const craneFill = isDark ? "#1e3a5e" : "#8395a7";
    return (
        <g>
            {/* Ambient glow */}
            <ellipse cx={x} cy={SVG_H / 2} rx={90} ry={SVG_H * 0.6} fill="url(#br-harbour-glow)" />

            {/* Water-level dock pilings */}
            {[0, 14, 28, 42].map(dx => (
                <rect key={dx} x={x + dx - 6} y={70} width={5} height={SVG_H - 110} fill={pilingFill} opacity={0.6} rx={1.5} />
            ))}
            {/* Dock planks */}
            {[95, 140, 185, 230, 275, 320].map(yy => (
                <line key={yy} x1={x - 8} y1={yy} x2={x + 44} y2={yy}
                    stroke={plankStroke} strokeWidth={2.5} opacity={0.35} />
            ))}

            {/* Main building — stone warehouse */}
            <rect x={x - 36} y={30} width={56} height={65} rx={2} fill={buildingFill} stroke={buildingStroke} strokeWidth={0.8} />
            {/* Roof */}
            <path d={`M${x - 40} 30 L${x - 8} 10 L${x + 24} 30 Z`} fill={roofFill} stroke={roofStroke} strokeWidth={0.6} />
            {/* Roof ridge */}
            <line x1={x - 8} y1={10} x2={x - 8} y2={6} stroke={roofStroke} strokeWidth={1.2} />
            {/* Weather vane */}
            <line x1={x - 8} y1={6} x2={x + 2} y2={4} stroke={isDark ? "#2a4a70" : "#8395a7"} strokeWidth={0.6} />
            <polygon points={`${x + 2},2 ${x + 6},4 ${x + 2},6`} fill="#FFB800" opacity={isDark ? 0.5 : 0.7} />

            {/* Windows — warm amber glow */}
            {[[x - 30, 40], [x - 18, 40], [x - 6, 40], [x + 6, 40],
              [x - 30, 56], [x - 18, 56], [x - 6, 56], [x + 6, 56]].map(([wx, wy], i) => (
                <g key={i}>
                    <rect x={wx} y={wy} width={8} height={10} rx={1} fill={windowBg} opacity={isDark ? 0.06 : 0.12} />
                    <rect x={wx + 1} y={wy + 1} width={6} height={8} rx={0.8} fill={windowGlow} opacity={isDark ? 0.12 : 0.25}>
                        <animate attributeName="opacity" values={`${isDark ? 0.12 : 0.25};${(isDark ? 0.06 : 0.15) + (hashStr(`w${i}`) % 8) / 100};${isDark ? 0.12 : 0.25}`}
                            dur={`${3 + (hashStr(`wd${i}`) % 30) / 10}s`} repeatCount="indefinite" />
                    </rect>
                </g>
            ))}

            {/* Entrance arch (water level) */}
            <path d={`M${x - 10} 95 Q${x + 4} 76 ${x + 18} 95`} fill="none" stroke={roofStroke} strokeWidth={1.5} />
            <rect x={x - 10} y={85} width={28} height={10} fill={isDark ? "#060e18" : "#a4b0be"} opacity={0.6} rx={1} />

            {/* Crane */}
            <g opacity={isDark ? 0.25 : 0.35}>
                <line x1={x + 30} y1={60} x2={x + 30} y2={15} stroke={craneFill} strokeWidth={3} />
                <line x1={x + 30} y1={15} x2={x + 75} y2={15} stroke={craneFill} strokeWidth={2.2} />
                <line x1={x + 30} y1={60} x2={x + 75} y2={15} stroke={craneFill} strokeWidth={0.8} opacity={0.4} />
                <line x1={x + 72} y1={15} x2={x + 72} y2={34} stroke={craneFill} strokeWidth={0.8} strokeDasharray="2,2">
                    <animate attributeName="y2" values="34;42;34" dur="4s" repeatCount="indefinite" />
                </line>
                {/* Crane light */}
                <circle cx={x + 30} cy={13} r={2.5} fill="#FFB800" opacity={0.35} filter="url(#br-glow)">
                    <animate attributeName="opacity" values="0.35;0.1;0.35" dur="3s" repeatCount="indefinite" />
                </circle>
            </g>

            {/* Harbour lights */}
            <circle cx={x - 8} cy={28} r={3} fill="#FFB800" opacity={isDark ? 0.5 : 0.7} filter="url(#br-glow)">
                <animate attributeName="opacity" values={isDark ? "0.5;0.15;0.5" : "0.7;0.3;0.7"} dur="2.8s" repeatCount="indefinite" />
            </circle>
            <circle cx={x + 38} cy={58} r={2.5} fill="#FFB800" opacity={isDark ? 0.3 : 0.5} filter="url(#br-glow)">
                <animate attributeName="opacity" values={isDark ? "0.3;0.08;0.3" : "0.5;0.2;0.5"} dur="3.5s" repeatCount="indefinite" />
            </circle>

            {/* Waiting ships count badge */}
            {waitingCount > 0 && (
                <g transform={`translate(${x + 4}, ${75})`}>
                    {/* Badge background */}
                    <circle r={14} fill={isDark ? "#0a1520" : "#f0e6d2"} stroke="#FFB800" strokeWidth={1.2} opacity={0.95} />
                    <circle r={14} fill="none" stroke="#FFB800" strokeWidth={0.6} opacity={0}>
                        <animate attributeName="opacity" values="0;0.5;0" dur="2.5s" repeatCount="indefinite" />
                        <animate attributeName="r" values="14;18;14" dur="2.5s" repeatCount="indefinite" />
                    </circle>
                    {/* Ship icon */}
                    <text y={-2} textAnchor="middle" fill="#FFB800" fontSize={10} fontWeight="bold" fontFamily="monospace"
                        dominantBaseline="middle" opacity={0.9}>
                        {waitingCount}
                    </text>
                    <text y={9} textAnchor="middle" fill="#FFB800" fontSize={4.5} fontFamily="monospace"
                        dominantBaseline="middle" opacity={0.5} letterSpacing="0.1em">
                        WAITING
                    </text>
                </g>
            )}

            {/* PORT label */}
            <text x={x + 4} y={SVG_H - 18} textAnchor="middle" fill={labelColor} fontSize={7.5} fontFamily="monospace"
                fontWeight="bold" letterSpacing="0.3em" opacity={isDark ? 0.5 : 0.6}>
                HARBOUR
            </text>
        </g>
    );
};

/* ─── Checkpoint Buoy ────────────────────────────────────────────────────── */

const CheckpointBuoy: FunctionComponent<{ x: number; label: string; color: string; isDark: boolean }> = ({ x, color, label, isDark }) => (
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
                <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* Label */}
            <text y={-8} textAnchor="middle" fill={color} fontSize={5.5} fontFamily="monospace"
                fontWeight="bold" letterSpacing="0.1em" opacity={0.4}>
                {label}
            </text>
        </g>
    </g>
);

/* ─── Finish Line ────────────────────────────────────────────────────────── */

const FinishLine: FunctionComponent<{ x: number; isDark: boolean }> = ({ x, isDark }) => (
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
            <animate attributeName="width" values="18;19.5;18" dur="2.5s" repeatCount="indefinite" />
        </rect>

        {/* Glow line */}
        <line x1={x - 8} y1={LANE_TOP - 12} x2={x - 8} y2={LANE_BOT + 12}
            stroke="#00E0A0" strokeWidth={1.8} opacity={0.08}>
            <animate attributeName="opacity" values="0.08;0.2;0.08" dur="2.5s" repeatCount="indefinite" />
        </line>
        <line x1={x - 8} y1={LANE_TOP - 12} x2={x - 8} y2={LANE_BOT + 12}
            stroke="#00E0A0" strokeWidth={6} opacity={0.02} filter="url(#br-glow2)">
            <animate attributeName="opacity" values="0.02;0.06;0.02" dur="2.5s" repeatCount="indefinite" />
        </line>

        {/* Top lights */}
        <circle cx={x - 4} cy={22} r={2.5} fill="#00E0A0" opacity={0.4} filter="url(#br-glow)">
            <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx={x + 18} cy={22} r={2.5} fill="#00E0A0" opacity={0.4} filter="url(#br-glow)">
            <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2s" repeatCount="indefinite" begin="0.5s" />
        </circle>

        {/* FINISH label */}
        <text x={x + 7} y={SVG_H - 16} textAnchor="middle" fill="#00E0A0" fontSize={7.5} fontFamily="monospace"
            fontWeight="bold" letterSpacing="0.3em" opacity={0.3}>
            FINISH
        </text>
    </g>
);

/* ─── Celestial body (moon in dark mode, sun in light mode) ──────────────── */

const CelestialBody: FunctionComponent<{ isDark: boolean }> = ({ isDark }) => {
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
                {[...Array(30)].map((_, i) => {
                    const cx = 40 + hashStr(`sx${i}`) % (SVG_W - 80);
                    const cy = 4 + hashStr(`sy${i}`) % 55;
                    const r = 0.3 + (hashStr(`sr${i}`) % 8) / 10;
                    const dur = 2 + (hashStr(`sd${i}`) % 40) / 10;
                    const op = 0.04 + (hashStr(`so${i}`) % 10) / 100;
                    return (
                        <circle key={`s${i}`} cx={cx} cy={cy} r={r} fill="white" opacity={op}>
                            <animate attributeName="opacity" values={`${op};${op + 0.12};${op}`} dur={`${dur}s`} repeatCount="indefinite" />
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
                        <animate attributeName="opacity" values="0.08;0.15;0.08" dur={`${3 + i * 0.3}s`} repeatCount="indefinite" />
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
};

/* ─── Subtle wave lines (transparent-friendly, works on any background) ──── */

const SubtleWaves: FunctionComponent<{ isDark: boolean }> = ({ isDark }) => {
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
                        <animateTransform attributeName="transform" type="translate"
                            values={`0 0; ${freq / 3} ${amp * 0.4}; 0 0`}
                            dur={`${dur}s`} repeatCount="indefinite" />
                    </path>
                );
            })}
        </g>
    );
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export const SprintBoatRace: FunctionComponent<BoatRaceProps> = ({ tasks, dispatches, hasLiveSprint }) => {
    const shipsGroupRef = useRef<SVGGElement>(null);
    const animStateRef = useRef<Map<string, {
        currentProgress: number;
        currentY: number;       // animated Y (starts at SPAWN_Y, drifts to laneY)
        lastTime: number;
        yWobbleOffset: number;  // small random Y wobble for natural movement
        yWobblePhase: number;   // phase of wobble oscillation
    }>>(new Map());
    const tickerRef = useRef<(() => void) | null>(null);
    const bobTweensRef = useRef<gsap.core.Tween[]>([]);
    const isDark = useIsDark();

    /* ── Mouse ripple effect ─────────────────────────────────────── */
    const svgRef = useRef<SVGSVGElement>(null);
    const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([]);
    const rippleIdRef = useRef(0);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const svg = svgRef.current;
        if (!svg) return;
        // Throttle: only add ripple every ~200ms
        const now = performance.now();
        if ((handleMouseMove as any)._lastRipple && now - (handleMouseMove as any)._lastRipple < 200) return;
        (handleMouseMove as any)._lastRipple = now;

        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * SVG_W;
        const y = ((e.clientY - rect.top) / rect.height) * SVG_H;
        const id = ++rippleIdRef.current;
        setRipples(prev => [...prev.slice(-6), { x, y, id }]);
        // Auto-remove after animation
        setTimeout(() => setRipples(prev => prev.filter(r => r.id !== id)), 2000);
    }, []);

    /* ── Separate waiting (harbour) vs active (on water) ────────── */
    const { activeShips, harbourCount } = useMemo(() => {
        if (!hasLiveSprint || tasks.length === 0) return { activeShips: [] as ShipDatum[], harbourCount: 0 };

        // PENDING + BLOCKED = waiting in harbour
        const waiting = tasks.filter(t => t.status === "PENDING" || t.status === "BLOCKED");
        const active = tasks.filter(t => t.status !== "PENDING" && t.status !== "BLOCKED").slice(0, MAX_SHIPS);

        // Dynamic lanes based on active ship count
        const count = active.length;
        const usable = LANE_BOT - LANE_TOP;
        const laneH = count > 0 ? Math.min(75, usable / count) : usable;
        const totalH = laneH * count;
        const offsetY = LANE_TOP + (usable - totalH) / 2;

        const ships: ShipDatum[] = active.map((task, i) => {
            const progress = getProgressTarget(task);
            const style = getStyle(task);
            // Subtle vertical jitter within lane for natural look
            const yJitter = (stableRand(task.id, 20) - 0.5) * laneH * 0.2;
            return {
                id: task.id,
                task,
                shipType: getShipType(task, dispatches),
                progress,
                laneY: offsetY + i * laneH + laneH / 2 + yJitter,
                style,
            };
        });

        return { activeShips: ships, harbourCount: waiting.length };
    }, [tasks, dispatches, hasLiveSprint]);

    /* ── Continuous Zeno's paradox animation via GSAP ticker ─────── */
    const updatePositions = useCallback(() => {
        const group = shipsGroupRef.current;
        if (!group || activeShips.length === 0) return;

        const now = performance.now();
        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));

        els.forEach((el, i) => {
            const ship = activeShips[i];
            if (!ship) return;

            const state = animStateRef.current.get(ship.id);
            const target = ship.progress.target;
            const confirmed = ship.progress.confirmed;

            if (!state) {
                // First appearance — spawn at centre of start line
                const initial = CP.DEPARTURE * 0.5;
                // Small horizontal offset so ships don't stack perfectly
                const spawnXOffset = (stableRand(ship.id, 40) - 0.5) * 0.02;
                animStateRef.current.set(ship.id, {
                    currentProgress: initial + spawnXOffset,
                    currentY: SPAWN_Y + (stableRand(ship.id, 41) - 0.5) * 20, // cluster near center with slight spread
                    lastTime: now,
                    yWobbleOffset: (stableRand(ship.id, 42) - 0.5) * 6,
                    yWobblePhase: stableRand(ship.id, 43) * Math.PI * 2,
                });
                const x = HARBOUR_X + 20 + (initial + spawnXOffset) * RACE_LEN;
                gsap.set(el, { x, y: SPAWN_Y, opacity: 0, scale: 0.6 });
                gsap.to(el, {
                    opacity: 1,
                    scale: 1,
                    duration: 1.6,
                    ease: "power2.out",
                    delay: i * 0.12,
                });
                return;
            }

            const dt = now - state.lastTime;
            state.lastTime = now;

            // ── X: Ensure current is at least at confirmed checkpoint
            if (state.currentProgress < confirmed) {
                state.currentProgress = state.currentProgress + (confirmed - state.currentProgress) * 0.12;
                if (confirmed - state.currentProgress < 0.002) {
                    state.currentProgress = confirmed;
                }
            }

            // ── X: Zeno's paradox drift toward target
            if (!ship.progress.stopped && Math.abs(target - state.currentProgress) > 0.0005) {
                const decay = 1 - Math.pow(0.5, dt / HALF_LIFE_MS);
                state.currentProgress += (target - state.currentProgress) * decay;
            }

            // ── Y: Smoothly drift from current Y toward target lane
            const targetY = ship.laneY;
            const yDiff = targetY - state.currentY;
            if (Math.abs(yDiff) > 0.5) {
                // Smooth exponential approach with natural wobble
                const yDecay = 1 - Math.pow(0.5, dt / 3000); // ~3s half-life for lane spreading
                state.currentY += yDiff * yDecay;
                // Add subtle sinusoidal wobble for natural curved paths
                state.yWobblePhase += dt * 0.0008;
                const wobble = Math.sin(state.yWobblePhase) * state.yWobbleOffset * Math.min(1, Math.abs(yDiff) / 30);
                state.currentY += wobble * yDecay * 0.3;
            } else {
                state.currentY = targetY;
            }

            const x = HARBOUR_X + 20 + state.currentProgress * RACE_LEN;
            gsap.set(el, { x, y: state.currentY });
        });
    }, [activeShips]);

    // Start/stop GSAP ticker
    useEffect(() => {
        if (activeShips.length === 0) return;

        // Clean up departed ships from animation state
        const currentIds = new Set(activeShips.map(s => s.id));
        for (const key of animStateRef.current.keys()) {
            if (!currentIds.has(key)) animStateRef.current.delete(key);
        }

        const handler = () => updatePositions();
        tickerRef.current = handler;
        gsap.ticker.add(handler);

        return () => {
            if (tickerRef.current) {
                gsap.ticker.remove(tickerRef.current);
                tickerRef.current = null;
            }
        };
    }, [activeShips, updatePositions]);

    /* ── Bobbing & sway animation ────────────────────────────────── */
    const shipIdLineup = useMemo(() => activeShips.map(s => s.id).join(","), [activeShips]);
    useEffect(() => {
        const group = shipsGroupRef.current;
        if (!group || activeShips.length === 0) return;

        bobTweensRef.current.forEach(t => t.kill());
        bobTweensRef.current = [];

        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));
        els.forEach((el, i) => {
            const ship = activeShips[i];
            if (!ship) return;
            const isMoving = !ship.progress.stopped;
            const bobAmp = isMoving ? 2.5 + stableRand(ship.id, 2) * 2 : 1 + stableRand(ship.id, 2) * 0.8;
            const bobDur = 3 + stableRand(ship.id, 3) * 2;

            bobTweensRef.current.push(
                gsap.to(el, {
                    y: `+=${bobAmp}`,
                    rotation: (stableRand(ship.id, 4) - 0.5) * (isMoving ? 3 : 1),
                    duration: bobDur,
                    ease: "sine.inOut",
                    repeat: -1,
                    yoyo: true,
                    delay: stableRand(ship.id, 1) * 4,
                }),
                gsap.to(el, {
                    x: `+=${isMoving ? 3 + stableRand(ship.id, 5) * 4 : 1}`,
                    duration: 5 + stableRand(ship.id, 6) * 3,
                    ease: "sine.inOut",
                    repeat: -1,
                    yoyo: true,
                }),
            );
        });

        return () => {
            bobTweensRef.current.forEach(t => t.kill());
            bobTweensRef.current = [];
        };
    }, [shipIdLineup]);

    /* ── Cleanup ─────────────────────────────────────────────────── */
    useEffect(() => () => {
        bobTweensRef.current.forEach(t => t.kill());
        bobTweensRef.current = [];
        if (tickerRef.current) gsap.ticker.remove(tickerRef.current);
    }, []);

    /* ─── Checkpoint buoy data ───────────────────────────────────── */
    const buoys = useMemo(() => [
        { progress: CP.RUNNING, label: "CODING", color: "#00E0A0" },
        { progress: CP.COMPLETED, label: "DONE", color: "#00AB84" },
        { progress: CP.CI, label: "CI", color: "#5dade2" },
        { progress: CP.AUTOMERGE, label: "MERGE", color: "#FFB800" },
    ], []);

    /* ─── Idle state ─────────────────────────────────────────────── */
    if (!hasLiveSprint || tasks.length === 0) {
        return (
            <div className="relative boat-race-bleed">
                <div className="relative overflow-hidden p-12">
                    <div className="absolute inset-0 pointer-events-none overflow-hidden">
                        <svg viewBox="0 0 600 120" className="absolute bottom-0 w-full opacity-[0.04]" preserveAspectRatio="none">
                            <path d="M0 80 Q75 55 150 80 T300 80 T450 80 T600 80 V120 H0 Z" fill="currentColor">
                                <animateTransform attributeName="transform" type="translate" values="0 0;-50 4;0 0" dur="8s" repeatCount="indefinite" />
                            </path>
                            <path d="M0 90 Q100 70 200 90 T400 90 T600 90 V120 H0 Z" fill="currentColor" opacity="0.5">
                                <animateTransform attributeName="transform" type="translate" values="0 0;30 -3;0 0" dur="6s" repeatCount="indefinite" />
                            </path>
                        </svg>
                    </div>
                    <div className="relative z-10 flex items-center justify-center py-10">
                        <div className="text-center">
                            <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
                                <div className="absolute inset-0 rounded-full border border-black/[0.04] dark:border-white/[0.04]" />
                                <div className="absolute inset-2 rounded-full border border-black/[0.03] dark:border-white/[0.03] animate-[spin_30s_linear_infinite]" />
                                <div className="absolute inset-4 rounded-full bg-signal-500/[0.06] animate-pulse" />
                                <Anchor className="w-7 h-7 text-slate-400 dark:text-white/20" strokeWidth={1.2} />
                            </div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-500 dark:text-white/25">Fleet Awaiting Departure</p>
                            <p className="text-[11px] text-slate-400/60 dark:text-white/12 mt-3 font-mono max-w-xs mx-auto">
                                {hasLiveSprint ? "No tasks currently in the pipeline" : "Launch a sprint to begin the race"}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const TOW_LINE_LENGTH = 70;
    const BADGE_OFFSET = TOW_LINE_LENGTH + 58; // tow line + half badge width

    return (
        <div className="relative boat-race-bleed">
            <div className="relative overflow-hidden">

                {/* ── Title bar ──────────────────────────────────────── */}
                <div className="relative z-20 flex items-center justify-between px-8 pt-5 pb-1">
                    <div className="flex items-center gap-3">
                        <div className="relative w-2.5 h-2.5">
                            <div className="absolute inset-0 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />
                            <div className="absolute inset-0 rounded-full bg-signal-500 animate-ping opacity-30" />
                        </div>
                        <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-slate-500 dark:text-white/35">Sprint Race</span>
                        <span className="text-[8px] font-mono text-slate-400 dark:text-white/15 ml-1">
                            {activeShips.length + harbourCount} vessel{(activeShips.length + harbourCount) !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <div className="flex items-center gap-5 text-[7px] font-mono text-slate-400 dark:text-white/20 uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-1.5 rounded-[1px] bg-gradient-to-r from-[#E74C3C]/60 to-[#3498DB]/60" />
                            Container
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="inline-block w-2.5 h-2.5 rounded-sm border border-[#7A5518]/50 bg-[#5C3D0E]/30" />
                            Wooden
                        </span>
                    </div>
                </div>

                <svg
                    ref={svgRef}
                    viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                    className="w-full"
                    style={{ height: "400px" }}
                    preserveAspectRatio="xMidYMid meet"
                    onMouseMove={handleMouseMove as any}
                >
                    <defs>
                        {/* Wake */}
                        <linearGradient id="br-wake" x1="1" y1="0.5" x2="0" y2="0.5">
                            <stop offset="0%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.14} />
                            <stop offset="50%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0.04} />
                            <stop offset="100%" stopColor={isDark ? "white" : "#334155"} stopOpacity={0} />
                        </linearGradient>
                        {/* Harbour glow */}
                        <radialGradient id="br-harbour-glow" cx="0.5" cy="0.5" r="0.5">
                            <stop offset="0%" stopColor="#FFB800" stopOpacity={isDark ? 0.06 : 0.04} />
                            <stop offset="100%" stopColor="transparent" />
                        </radialGradient>
                        {/* Finish glow */}
                        <radialGradient id="br-finish-glow" cx="0.5" cy="0.5" r="0.5">
                            <stop offset="0%" stopColor="#00E0A0" stopOpacity={isDark ? 0.08 : 0.05} />
                            <stop offset="100%" stopColor="transparent" />
                        </radialGradient>
                        {/* Glow filters */}
                        <filter id="br-glow"><feGaussianBlur stdDeviation="2.5" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                        <filter id="br-glow2"><feGaussianBlur stdDeviation="6" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                        {/* Ripple filter */}
                        <filter id="br-ripple">
                            <feGaussianBlur stdDeviation="1.5" />
                        </filter>
                    </defs>

                    {/* ── Celestial body (moon/sun) ─────────────────────── */}
                    <CelestialBody isDark={isDark} />

                    {/* ── Subtle wave lines ─────────────────────────────── */}
                    <SubtleWaves isDark={isDark} />

                    {/* ── Mouse ripple effects ──────────────────────────── */}
                    {ripples.map(r => (
                        <g key={r.id}>
                            <circle cx={r.x} cy={r.y} r={2} fill="none"
                                stroke={isDark ? "white" : "#334155"} strokeWidth={0.5} opacity={0}>
                                <animate attributeName="r" values="2;40" dur="2s" fill="freeze" />
                                <animate attributeName="opacity" values="0.12;0" dur="2s" fill="freeze" />
                            </circle>
                            <circle cx={r.x} cy={r.y} r={2} fill="none"
                                stroke={isDark ? "white" : "#334155"} strokeWidth={0.3} opacity={0}>
                                <animate attributeName="r" values="2;25" dur="1.5s" fill="freeze" />
                                <animate attributeName="opacity" values="0.08;0" dur="1.5s" fill="freeze" />
                            </circle>
                        </g>
                    ))}

                    {/* ── Harbour Building ──────────────────────────────── */}
                    <HarbourBuilding x={HARBOUR_X - 40} waitingCount={harbourCount} isDark={isDark} />

                    {/* ── Checkpoint Buoys ──────────────────────────────── */}
                    {buoys.map(b => (
                        <CheckpointBuoy key={b.label}
                            x={HARBOUR_X + 20 + b.progress * RACE_LEN}
                            label={b.label}
                            color={b.color}
                            isDark={isDark}
                        />
                    ))}

                    {/* ── Finish Line ───────────────────────────────────── */}
                    <FinishLine x={FINISH_X} isDark={isDark} />

                    {/* ── Lane guides ───────────────────────────────────── */}
                    {activeShips.map(s => (
                        <line key={`ln-${s.id}`}
                            x1={HARBOUR_X + 40} y1={s.laneY + 16} x2={FINISH_X - 20} y2={s.laneY + 16}
                            stroke={isDark ? "white" : "black"} strokeWidth={0.2} strokeDasharray="2,24" opacity={0.025} />
                    ))}

                    {/* ── Ships ─────────────────────────────────────────── */}
                    <g ref={shipsGroupRef}>
                        {activeShips.map(s => {
                            const isRunning = s.task.status === "RUNNING";
                            const isMoving = !s.progress.stopped;
                            const isFailed = s.task.status === "FAILED";
                            return (
                                <g key={s.id} className="race-ship">
                                    {/* Wake trail */}
                                    <ellipse cx={-45} cy={14} rx={isMoving ? 60 : 25} ry={isMoving ? 4.5 : 2}
                                        fill="url(#br-wake)" opacity={isMoving ? 0.3 : 0.06}>
                                        {isMoving && (
                                            <animate attributeName="rx" values="55;70;55" dur="3s" repeatCount="indefinite" />
                                        )}
                                    </ellipse>
                                    {isRunning && (
                                        <>
                                            {/* Secondary wake */}
                                            <ellipse cx={-65} cy={16} rx={30} ry={2.5} fill={isDark ? "white" : "#334155"} opacity={0.04}>
                                                <animate attributeName="rx" values="24;36;24" dur="4s" repeatCount="indefinite" />
                                            </ellipse>
                                            {/* Bow spray */}
                                            {[0, 1, 2, 3, 4].map(j => (
                                                <circle key={j} cx={38 + j * 2} cy={j * 2.5} r={0.7 + j * 0.15} fill={isDark ? "white" : "#475569"} opacity={0}>
                                                    <animate attributeName="cy" values={`${j * 2.5};${-6 - j * 3};${j * 2.5}`} dur={`${0.5 + j * 0.12}s`} repeatCount="indefinite" begin={`${j * 0.1}s`} />
                                                    <animate attributeName="opacity" values="0.25;0;0.25" dur={`${0.5 + j * 0.12}s`} repeatCount="indefinite" begin={`${j * 0.1}s`} />
                                                </circle>
                                            ))}
                                        </>
                                    )}

                                    {/* Hull water glow */}
                                    <ellipse cx={0} cy={24} rx={isMoving ? 48 : 34} ry={isMoving ? 10 : 6}
                                        fill={s.style.color} opacity={isMoving ? 0.08 : 0.03} filter="url(#br-glow2)" />

                                    {/* Failed X */}
                                    {isFailed && (
                                        <g opacity={0.3}>
                                            <line x1={-16} y1={-16} x2={16} y2={16} stroke="#E3000F" strokeWidth={3} />
                                            <line x1={16} y1={-16} x2={-16} y2={16} stroke="#E3000F" strokeWidth={3} />
                                        </g>
                                    )}

                                    {/* Ship */}
                                    {s.shipType === "container"
                                        ? <ContainerShip accentColor={s.style.color} dim={s.style.dim} isMoving={isMoving} isDark={isDark} />
                                        : <WoodenShip accentColor={s.style.color} dim={s.style.dim} isMoving={isMoving} isDark={isDark} />
                                    }

                                    {/* Tow line + trailing badge */}
                                    <g transform="translate(-44, 4)">
                                        <TowLine color={s.style.color} length={TOW_LINE_LENGTH} />
                                        <g transform={`translate(${-BADGE_OFFSET + 44}, 0)`}>
                                            <ShipBadge
                                                taskId={s.task.id}
                                                title={s.task.title}
                                                style={s.style}
                                                mergeIndicator={s.task.merge_indicator}
                                                isRunning={isRunning}
                                                isDark={isDark}
                                            />
                                        </g>
                                    </g>
                                </g>
                            );
                        })}
                    </g>
                </svg>
            </div>
        </div>
    );
};
