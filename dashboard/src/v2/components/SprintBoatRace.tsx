import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useMemo, useEffect } from "preact/hooks";
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

/* ─── Ship type: docker → container, mcp/local → wooden ─────────────────── */

const getShipType = (task: Subtask, dispatches: ExecutionTaskDispatchSummary[]): "container" | "wooden" => {
    const d = dispatches.find(dd => dd.taskKey === task.id || dd.taskId === task.record_id);
    if (d?.executorType === "docker_cli") return "container";
    if (d?.executorType === "mcp_worker") return "wooden";
    if (task.provider === "jules") return "wooden";
    return "container";
};

/* ─── Progress mapping: status + merge_indicator → 0…1 along the course ── */

const getProgress = (task: Subtask): number => {
    const jitter = stableRand(task.id, 10) * 0.06; // small per-task variation
    switch (task.status) {
        case "PENDING":   return 0.03 + stableRand(task.id, 11) * 0.04;
        case "BLOCKED":   return 0.10 + jitter;
        case "FAILED":    return 0.18 + stableRand(task.id, 12) * 0.15;
        case "RUNNING":   return 0.28 + stableRand(task.id, 0) * 0.30; // 28–58%
        case "COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "MERGED")           return 0.94 + jitter * 0.3;
            if (mi === "AUTOMERGE")        return 0.84 + jitter;
            if (mi === "CI")               return 0.74 + jitter;
            if (mi === "MERGE_BLOCKED")    return 0.68 + jitter;
            if (mi === "MERGE_CONFLICT")   return 0.66 + jitter;
            return 0.64 + jitter; // completed, no merge indicator yet
        }
        default: return 0.03;
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

const SVG_W = 1200;
const SVG_H = 420;
const DOCK_X = 60;
const FINISH_X = 1110;
const RACE_LEN = FINISH_X - DOCK_X - 60;
const LANE_TOP = 85;
const LANE_BOT = SVG_H - 55;
const MAX_SHIPS = 8;

/* ─── Ship data (stable across re-renders) ───────────────────────────────── */

interface ShipDatum {
    id: string;
    task: Subtask;
    shipType: "container" | "wooden";
    targetX: number;
    laneY: number;
    style: StatusStyle;
    bobAmp: number;
    bobDur: number;
    bobPhase: number;
    swayAmp: number;
    swayDur: number;
}

/* ─── SVG: Container Ship ────────────────────────────────────────────────── */

const ContainerShip: FunctionComponent<{ accentColor: string; dim: boolean }> = ({ accentColor, dim }) => {
    const o = dim ? 0.4 : 1;
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={22} rx={42} ry={7} fill={accentColor} opacity={0.06} />
            {/* Hull shadow */}
            <ellipse cx={2} cy={19} rx={38} ry={5} fill="black" opacity={0.35} />
            {/* Hull — sharp bow, round stern */}
            <path d="M-36 3 L-31 15 Q-28 18 0 18 Q28 18 31 15 L36 3 L30 -5 Q18 -9 0 -9 Q-18 -9 -30 -5 Z"
                fill="#131f35" stroke="#1e3358" strokeWidth={0.7} />
            {/* Waterline glow */}
            <path d="M-31 15 Q0 19 31 15 Q28 18 0 18 Q-28 18 -31 15 Z"
                fill={accentColor} opacity={0.15} />
            {/* Deck */}
            <rect x={-30} y={-6} width={60} height={8} rx={1.5} fill="#1a2d4d" />
            {/* Containers row 1 */}
            {[["#E74C3C", -26], ["#3498DB", -16], ["#F1C40F", -6], ["#2ECC71", 4], ["#9B59B6", 14]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-9} width={9.5} height={6.5} rx={1} fill={c as string} opacity={0.8} />
            )}
            {/* Containers row 2 */}
            {[["#E67E22", -24], ["#1ABC9C", -14], ["#E74C3C", -4], ["#3498DB", 6]].map(
                ([c, x]) => <rect key={x as number} x={x as number} y={-15.5} width={9.5} height={6} rx={1} fill={c as string} opacity={0.6} />
            )}
            {/* Bridge */}
            <rect x={-5.5} y={-27} width={11} height={11.5} rx={2} fill="#1e3050" stroke="#2a4a70" strokeWidth={0.5} />
            {/* Bridge windows */}
            <rect x={-4} y={-25} width={8} height={3.5} rx={1} fill="#3d7cc9" opacity={0.2} />
            <rect x={-4} y={-20.5} width={8} height={2} rx={0.5} fill="#3d7cc9" opacity={0.12} />
            {/* Funnel */}
            <rect x={-2.5} y={-34} width={5} height={7} rx={1.5} fill="#253a58" />
            {/* Funnel stripe */}
            <rect x={-2.2} y={-34.5} width={4.4} height={2} rx={0.8} fill={accentColor} opacity={0.85} />
            {/* Radar mast */}
            <line x1={0} y1={-27} x2={0} y2={-37} stroke="#2a4a70" strokeWidth={0.8} />
            <circle cx={0} cy={-37.5} r={1} fill={accentColor} opacity={0.5}>
                <animate attributeName="opacity" values="0.5;0.15;0.5" dur="1.8s" repeatCount="indefinite" />
            </circle>
            {/* Nav lights */}
            <circle cx={-32} cy={0} r={1.2} fill="#E3000F" opacity={0.6} />
            <circle cx={32} cy={0} r={1.2} fill="#2ECC71" opacity={0.6} />
        </g>
    );
};

/* ─── SVG: Wooden Ship ───────────────────────────────────────────────────── */

const WoodenShip: FunctionComponent<{ accentColor: string; dim: boolean }> = ({ accentColor, dim }) => {
    const o = dim ? 0.4 : 1;
    return (
        <g opacity={o}>
            {/* Water reflection */}
            <ellipse cx={0} cy={22} rx={36} ry={6} fill={accentColor} opacity={0.05} />
            {/* Hull shadow */}
            <ellipse cx={2} cy={19} rx={34} ry={5} fill="black" opacity={0.3} />
            {/* Hull */}
            <path d="M-30 5 Q-34 5 -30 16 L-22 19 Q0 21 22 19 L30 16 Q34 5 30 5 Z"
                fill="#5C3D0E" stroke="#7A5518" strokeWidth={0.8} />
            {/* Hull planking lines */}
            <path d="M-27 10 Q0 8 27 10" fill="none" stroke="#4A3008" strokeWidth={0.4} opacity={0.5} />
            <path d="M-25 14 Q0 12 25 14" fill="none" stroke="#4A3008" strokeWidth={0.4} opacity={0.4} />
            {/* Keel highlight */}
            <path d="M-30 16 Q0 19 30 16 Q28 18 0 18 Q-28 18 -30 16 Z"
                fill={accentColor} opacity={0.08} />
            {/* Deck */}
            <path d="M-26 5 Q0 2 26 5 Q20 2 0 2 Q-20 2 -26 5 Z" fill="#7A5518" opacity={0.85} />
            {/* Railing posts */}
            {[-20, -12, -4, 4, 12, 20].map(x => (
                <line key={x} x1={x} y1={2} x2={x} y2={-1} stroke="#8B6914" strokeWidth={0.5} opacity={0.35} />
            ))}
            <line x1={-22} y1={-0.5} x2={22} y2={-0.5} stroke="#8B6914" strokeWidth={0.5} opacity={0.3} />
            {/* Main mast */}
            <line x1={-2} y1={2} x2={-2} y2={-46} stroke="#4A3008" strokeWidth={2.8} />
            {/* Cross spars */}
            <line x1={-20} y1={-34} x2={16} y2={-34} stroke="#4A3008" strokeWidth={1.8} />
            <line x1={-16} y1={-22} x2={12} y2={-22} stroke="#4A3008" strokeWidth={1.2} />
            {/* Main sail */}
            <path d="M0 -44 Q20 -32 20 -14 L0 -10 Z" fill="#F5EFE0" opacity={0.92} stroke="#C9BFA8" strokeWidth={0.5}>
                <animate attributeName="d"
                    values="M0 -44 Q20 -32 20 -14 L0 -10 Z;M0 -44 Q22 -31 21 -13 L0 -10 Z;M0 -44 Q20 -32 20 -14 L0 -10 Z"
                    dur="5s" repeatCount="indefinite" />
            </path>
            {/* Topsail */}
            <path d="M0 -44 Q12 -40 12 -34 L0 -32 Z" fill="#F5EFE0" opacity={0.7} stroke="#C9BFA8" strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M0 -44 Q12 -40 12 -34 L0 -32 Z;M0 -44 Q13 -39 13 -33 L0 -32 Z;M0 -44 Q12 -40 12 -34 L0 -32 Z"
                    dur="4s" repeatCount="indefinite" />
            </path>
            {/* Jib */}
            <path d="M-4 -42 Q-16 -30 -16 -14 L-4 -12 Z" fill="#F5EFE0" opacity={0.75} stroke="#C9BFA8" strokeWidth={0.4}>
                <animate attributeName="d"
                    values="M-4 -42 Q-16 -30 -16 -14 L-4 -12 Z;M-4 -42 Q-18 -29 -17 -13 L-4 -12 Z;M-4 -42 Q-16 -30 -16 -14 L-4 -12 Z"
                    dur="4.5s" repeatCount="indefinite" />
            </path>
            {/* Sail rigging lines */}
            <line x1={-2} y1={-44} x2={20} y2={-14} stroke="#4A3008" strokeWidth={0.3} opacity={0.3} />
            <line x1={-2} y1={-44} x2={-16} y2={-14} stroke="#4A3008" strokeWidth={0.3} opacity={0.3} />
            {/* Flag */}
            <path d="M-2 -46 L9 -44 L-2 -42" fill={accentColor} opacity={0.9}>
                <animate attributeName="d"
                    values="M-2 -46 L9 -44 L-2 -42;M-2 -46 L10 -43.5 L-2 -42;M-2 -46 L9 -44 L-2 -42"
                    dur="2s" repeatCount="indefinite" />
            </path>
            {/* Fore mast */}
            <line x1={16} y1={3} x2={16} y2={-20} stroke="#4A3008" strokeWidth={1.5} />
            {/* Cabin */}
            <rect x={-18} y={-4} width={11} height={6} rx={1.5} fill="#4A3008" opacity={0.75} />
            <rect x={-16.5} y={-3} width={4} height={3.5} rx={0.8} fill="#FFD080" opacity={0.35} />
            <rect x={-11.5} y={-3} width={3} height={3.5} rx={0.8} fill="#FFD080" opacity={0.25} />
            {/* Stern lantern */}
            <circle cx={28} cy={4} r={1.8} fill="#FFB800" opacity={0.6}>
                <animate attributeName="opacity" values="0.6;0.2;0.6" dur="3.5s" repeatCount="indefinite" />
            </circle>
            {/* Bow lantern */}
            <circle cx={-28} cy={8} r={1.2} fill={accentColor} opacity={0.4}>
                <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2.5s" repeatCount="indefinite" />
            </circle>
        </g>
    );
};

/* ─── Status badge above ship ────────────────────────────────────────────── */

const ShipBadge: FunctionComponent<{
    taskId: string;
    title: string;
    style: StatusStyle;
    mergeIndicator?: string;
    isRunning: boolean;
}> = ({ taskId, title, style, mergeIndicator, isRunning }) => (
    <g>
        {/* Halo */}
        <circle r={22} fill={style.color} opacity={0.04} />
        {/* Pill bg */}
        <rect x={-58} y={-13} width={116} height={26} rx={13}
            fill="rgba(4,8,16,0.88)" stroke={style.color} strokeWidth={0.7} strokeOpacity={0.6} />
        {/* Outer pulse (running only) */}
        {isRunning && (
            <rect x={-58} y={-13} width={116} height={26} rx={13}
                fill="none" stroke={style.color} strokeWidth={0.8} opacity={0}>
                <animate attributeName="opacity" values="0;0.35;0" dur="2s" repeatCount="indefinite" />
                <animate attributeName="x" values="-58;-60" dur="2s" repeatCount="indefinite" />
                <animate attributeName="y" values="-13;-15" dur="2s" repeatCount="indefinite" />
                <animate attributeName="width" values="116;120" dur="2s" repeatCount="indefinite" />
                <animate attributeName="height" values="26;30" dur="2s" repeatCount="indefinite" />
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
            dominantBaseline="middle">
            {style.label}
        </text>
        {/* Task ID */}
        <text x={16} y={1} fill="white" fontSize={7.5} fontFamily="monospace" fontWeight="bold" opacity={0.5}
            dominantBaseline="middle">
            #{taskId}
        </text>
        {/* Merge badge */}
        {mergeIndicator && (
            <g transform="translate(42, 0)">
                <circle r={7.5} fill={
                    mergeIndicator === "MERGED" ? "#00AB84"
                    : mergeIndicator === "CI" ? "#5dade2"
                    : mergeIndicator === "MERGE_CONFLICT" ? "#E3000F"
                    : "#F59E0B"
                } opacity={0.85} />
                <text y={0.5} textAnchor="middle" fill="white" fontSize={5.5} fontWeight="bold" fontFamily="monospace"
                    dominantBaseline="middle">
                    {mergeIndicator === "MERGED" ? "M" : mergeIndicator === "CI" ? "CI"
                    : mergeIndicator === "MERGE_CONFLICT" ? "!" : "AM"}
                </text>
            </g>
        )}
        {/* Title below */}
        <text y={22} textAnchor="middle" fill="white" fontSize={6.5} fontFamily="monospace" opacity={0.25}>
            {title.length > 32 ? title.slice(0, 30) + "…" : title}
        </text>
    </g>
);

/* ─── Wave layer (reusable for parallax depths) ──────────────────────────── */

const WaveLayer: FunctionComponent<{
    y: number; amp: number; freq: number; dur: number; color: string; opacity: number; strokeW: number;
}> = ({ y, amp, freq, dur, color, opacity: op, strokeW }) => {
    const p = `M-80 ${y}`;
    const curves = Array.from({ length: 8 }, (_, i) => {
        const x0 = -80 + i * freq;
        const x1 = x0 + freq / 2;
        const x2 = x0 + freq;
        return `Q${x1} ${y - amp} ${x2} ${y}`;
    }).join(" ");
    return (
        <path d={`${p} ${curves}`} fill="none" stroke={color} strokeWidth={strokeW} opacity={op}>
            <animateTransform attributeName="transform" type="translate"
                values={`0 0; ${freq / 3} ${amp * 0.4}; 0 0`}
                dur={`${dur}s`} repeatCount="indefinite" />
        </path>
    );
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

export const SprintBoatRace: FunctionComponent<BoatRaceProps> = ({ tasks, dispatches, hasLiveSprint }) => {
    const shipsGroupRef = useRef<SVGGElement>(null);
    const bobTweensRef = useRef<gsap.core.Tween[]>([]);
    const positionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
    const mountedRef = useRef(false);

    /* ── Build stable ship data ──────────────────────────────────────── */
    const ships: ShipDatum[] = useMemo(() => {
        if (!hasLiveSprint || tasks.length === 0) return [];

        const visible = tasks.slice(0, MAX_SHIPS);
        const count = visible.length;
        const usable = LANE_BOT - LANE_TOP;
        const laneH = Math.min(70, usable / count);
        const totalH = laneH * count;
        const offsetY = LANE_TOP + (usable - totalH) / 2;

        return visible.map((task, i) => {
            const progress = getProgress(task);
            const style = getStyle(task);
            return {
                id: task.id,
                task,
                shipType: getShipType(task, dispatches),
                targetX: DOCK_X + 30 + progress * RACE_LEN,
                laneY: offsetY + i * laneH + laneH / 2,
                style,
                bobAmp: task.status === "RUNNING" ? 2.5 + stableRand(task.id, 2) * 2 : 1 + stableRand(task.id, 2) * 1,
                bobDur: 3 + stableRand(task.id, 3) * 2,
                bobPhase: stableRand(task.id, 1) * 6,
                swayAmp: task.status === "RUNNING" ? 4 + stableRand(task.id, 5) * 5 : 1.5,
                swayDur: 5 + stableRand(task.id, 6) * 4,
            };
        });
    }, [tasks, dispatches, hasLiveSprint]);

    /* ── Serialize to detect actual changes (avoids re-triggering on same data) */
    const shipsFingerprint = useMemo(
        () => ships.map(s => `${s.id}:${s.targetX.toFixed(0)}:${s.laneY.toFixed(0)}:${s.style.label}`).join("|"),
        [ships],
    );

    const shipIdLineup = useMemo(
        () => ships.map(s => s.id).join(","),
        [ships],
    );

    /* ── Position animation: only fires when positions actually change ── */
    useLayoutEffect(() => {
        const group = shipsGroupRef.current;
        if (!group || ships.length === 0) return;

        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));
        const isFirstMount = !mountedRef.current;
        mountedRef.current = true;

        els.forEach((el, i) => {
            const ship = ships[i];
            if (!ship) return;

            const prev = positionsRef.current.get(ship.id);
            const newX = ship.targetX;
            const newY = ship.laneY;

            if (isFirstMount || !prev) {
                // First appearance: sail in from dock
                gsap.set(el, { x: DOCK_X, y: newY, opacity: 0, scale: 0.65 });
                gsap.to(el, {
                    x: newX,
                    opacity: 1,
                    scale: 1,
                    duration: 2.8,
                    ease: "power2.out",
                    delay: isFirstMount ? 0.1 + i * 0.2 : 0,
                });
            } else if (Math.abs(prev.x - newX) > 2 || Math.abs(prev.y - newY) > 2) {
                // Position actually changed → smooth glide (don't touch bob tweens)
                gsap.to(el, {
                    x: newX,
                    y: newY,
                    duration: 2.0,
                    ease: "power2.inOut",
                    overwrite: false, // CRITICAL: don't kill bob/sway tweens
                });
            }
            // else: same position, do nothing — bobs continue undisturbed

            positionsRef.current.set(ship.id, { x: newX, y: newY });
        });

        // Clean up departed ships from the position map
        const currentIds = new Set(ships.map(s => s.id));
        for (const key of positionsRef.current.keys()) {
            if (!currentIds.has(key)) positionsRef.current.delete(key);
        }
    }, [shipsFingerprint]); // fingerprint ensures we only animate on actual position changes

    /* ── Bobbing & sway: independent lifecycle, only reinit on lineup change ─ */
    useEffect(() => {
        const group = shipsGroupRef.current;
        if (!group || ships.length === 0) return;

        // Kill previous bobs
        bobTweensRef.current.forEach(t => t.kill());
        bobTweensRef.current = [];

        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));

        els.forEach((el, i) => {
            const ship = ships[i];
            if (!ship) return;

            // Vertical bob
            const bob = gsap.to(el, {
                y: `+=${ship.bobAmp}`,
                rotation: (stableRand(ship.id, 4) - 0.5) * (ship.task.status === "RUNNING" ? 3 : 1.2),
                duration: ship.bobDur,
                ease: "sine.inOut",
                repeat: -1,
                yoyo: true,
                delay: ship.bobPhase,
            });

            // Horizontal sway
            const sway = gsap.to(el, {
                x: `+=${ship.swayAmp}`,
                duration: ship.swayDur,
                ease: "sine.inOut",
                repeat: -1,
                yoyo: true,
            });

            bobTweensRef.current.push(bob, sway);
        });

        return () => {
            bobTweensRef.current.forEach(t => t.kill());
            bobTweensRef.current = [];
        };
    }, [shipIdLineup]);

    /* ── Cleanup on unmount ──────────────────────────────────────────── */
    useEffect(() => () => {
        bobTweensRef.current.forEach(t => t.kill());
        bobTweensRef.current = [];
    }, []);

    /* ─── Idle state ─────────────────────────────────────────────────── */
    if (!hasLiveSprint || ships.length === 0) {
        return (
            <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.03] bg-gradient-to-br from-[#060a14] via-[#0a1525] to-[#040812] p-12 boat-race-container shadow-[0_8px_40px_rgba(0,0,0,0.4)]">
                <div className="absolute inset-0 pointer-events-none overflow-hidden">
                    <svg viewBox="0 0 600 120" className="absolute bottom-0 w-full opacity-[0.03]" preserveAspectRatio="none">
                        <path d="M0 80 Q75 55 150 80 T300 80 T450 80 T600 80 V120 H0 Z" fill="#00E0A0">
                            <animateTransform attributeName="transform" type="translate" values="0 0;-50 4;0 0" dur="8s" repeatCount="indefinite" />
                        </path>
                        <path d="M0 90 Q100 70 200 90 T400 90 T600 90 V120 H0 Z" fill="#00E0A0" opacity="0.5">
                            <animateTransform attributeName="transform" type="translate" values="0 0;30 -3;0 0" dur="6s" repeatCount="indefinite" />
                        </path>
                    </svg>
                </div>
                <div className="relative z-10 flex items-center justify-center py-10">
                    <div className="text-center">
                        <div className="relative inline-flex items-center justify-center w-20 h-20 mb-6">
                            <div className="absolute inset-0 rounded-full border border-white/[0.04]" />
                            <div className="absolute inset-2 rounded-full border border-white/[0.03] animate-[spin_30s_linear_infinite]" />
                            <div className="absolute inset-4 rounded-full bg-signal-500/[0.06] animate-pulse" />
                            <Anchor className="w-7 h-7 text-white/20" strokeWidth={1.2} />
                        </div>
                        <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-white/25">Fleet Awaiting Departure</p>
                        <p className="text-[11px] text-white/12 mt-3 font-mono max-w-xs mx-auto">
                            {hasLiveSprint ? "No tasks currently in the pipeline" : "Launch a sprint to begin the race"}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    /* ─── Progress milestones for the race course ────────────────────── */
    const milestones = [
        { x: DOCK_X + 30 + 0.28 * RACE_LEN, label: "RUNNING" },
        { x: DOCK_X + 30 + 0.64 * RACE_LEN, label: "COMPLETED" },
        { x: DOCK_X + 30 + 0.74 * RACE_LEN, label: "CI" },
        { x: DOCK_X + 30 + 0.84 * RACE_LEN, label: "AUTOMERGE" },
        { x: DOCK_X + 30 + 0.94 * RACE_LEN, label: "MERGED" },
    ];

    return (
        <div className="relative overflow-hidden rounded-[2rem] border border-white/[0.04] bg-gradient-to-b from-[#040810] via-[#081020] to-[#030610] shadow-[0_16px_80px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.04)] boat-race-container">

            {/* ── Title chrome ─────────────────────────────────────── */}
            <div className="relative z-20 flex items-center justify-between px-8 pt-5 pb-1">
                <div className="flex items-center gap-3">
                    <div className="relative w-2.5 h-2.5">
                        <div className="absolute inset-0 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />
                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-ping opacity-30" />
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Sprint Race</span>
                    <span className="text-[8px] font-mono text-white/15 ml-1">{ships.length} vessel{ships.length !== 1 ? "s" : ""}</span>
                </div>
                <div className="flex items-center gap-5 text-[7px] font-mono text-white/20 uppercase tracking-wider">
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
                viewBox={`0 0 ${SVG_W} ${SVG_H}`}
                className="w-full"
                style={{ height: "380px" }}
                preserveAspectRatio="xMidYMid meet"
            >
                <defs>
                    {/* Ocean depth */}
                    <linearGradient id="br-depth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="transparent" />
                        <stop offset="100%" stopColor="#010408" stopOpacity={0.6} />
                    </linearGradient>
                    {/* Horizontal shimmer */}
                    <linearGradient id="br-shimmer" x1="0" y1="0.5" x2="1" y2="0.5">
                        <stop offset="0%" stopColor="#00E0A0" stopOpacity={0} />
                        <stop offset="50%" stopColor="#00E0A0" stopOpacity={0.02}>
                            <animate attributeName="stopOpacity" values="0.02;0.05;0.02" dur="6s" repeatCount="indefinite" />
                        </stop>
                        <stop offset="100%" stopColor="#00E0A0" stopOpacity={0} />
                    </linearGradient>
                    {/* Moon glow */}
                    <radialGradient id="br-moon" cx="0.88" cy="0.08" r="0.15" gradientUnits="objectBoundingBox">
                        <stop offset="0%" stopColor="#E8E4D8" stopOpacity={0.12} />
                        <stop offset="50%" stopColor="#C8C0A8" stopOpacity={0.04} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    {/* Moonbeam on water */}
                    <linearGradient id="br-moonbeam" x1="0.85" y1="0" x2="0.90" y2="1">
                        <stop offset="0%" stopColor="#F0ECD8" stopOpacity={0.01} />
                        <stop offset="40%" stopColor="#F0ECD8" stopOpacity={0.03} />
                        <stop offset="100%" stopColor="transparent" />
                    </linearGradient>
                    {/* Wake */}
                    <linearGradient id="br-wake" x1="1" y1="0.5" x2="0" y2="0.5">
                        <stop offset="0%" stopColor="white" stopOpacity={0.12} />
                        <stop offset="50%" stopColor="white" stopOpacity={0.03} />
                        <stop offset="100%" stopColor="white" stopOpacity={0} />
                    </linearGradient>
                    {/* Dock / Finish glows */}
                    <radialGradient id="br-dock-g" cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0%" stopColor="#FFB800" stopOpacity={0.07} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    <radialGradient id="br-fin-g" cx="0.5" cy="0.5" r="0.5">
                        <stop offset="0%" stopColor="#00E0A0" stopOpacity={0.1} />
                        <stop offset="100%" stopColor="transparent" />
                    </radialGradient>
                    {/* Filters */}
                    <filter id="br-gl"><feGaussianBlur stdDeviation="2.5" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    <filter id="br-gl2"><feGaussianBlur stdDeviation="6" /><feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    {/* Checkered */}
                    <pattern id="br-chk" width="6" height="6" patternUnits="userSpaceOnUse">
                        <rect width="3" height="3" fill="white" opacity={0.55} />
                        <rect x="3" y="3" width="3" height="3" fill="white" opacity={0.55} />
                    </pattern>
                </defs>

                {/* ── Sky / ocean base ──────────────────────────────────── */}
                <rect width={SVG_W} height={SVG_H} fill="url(#br-depth)" />
                <rect width={SVG_W} height={SVG_H} fill="url(#br-shimmer)" />
                <rect width={SVG_W} height={SVG_H} fill="url(#br-moon)" />
                <rect width={SVG_W} height={SVG_H} fill="url(#br-moonbeam)" />

                {/* ── Moon ──────────────────────────────────────────────── */}
                <circle cx={SVG_W * 0.88} cy={32} r={14} fill="#E8E4D0" opacity={0.08} />
                <circle cx={SVG_W * 0.88} cy={32} r={10} fill="#F0ECD8" opacity={0.04} />

                {/* ── Stars ────────────────────────────────────────────── */}
                {[...Array(28)].map((_, i) => {
                    const cx = 40 + hashStr(`sx${i}`) % (SVG_W - 80);
                    const cy = 5 + hashStr(`sy${i}`) % 50;
                    const r = 0.3 + (hashStr(`sr${i}`) % 7) / 10;
                    const dur = 2 + (hashStr(`sd${i}`) % 40) / 10;
                    const op = 0.06 + (hashStr(`so${i}`) % 12) / 100;
                    return (
                        <circle key={`s${i}`} cx={cx} cy={cy} r={r} fill="white" opacity={op}>
                            <animate attributeName="opacity" values={`${op};${op + 0.12};${op}`} dur={`${dur}s`} repeatCount="indefinite" />
                        </circle>
                    );
                })}

                {/* ── Wave layers (parallax depth) ─────────────────────── */}
                {/* Far background waves */}
                <WaveLayer y={90}  amp={4}  freq={180} dur={10} color="#0e4a6a" opacity={0.06} strokeW={0.8} />
                <WaveLayer y={140} amp={5}  freq={160} dur={8}  color="#00E0A0" opacity={0.025} strokeW={0.5} />
                <WaveLayer y={190} amp={4}  freq={200} dur={12} color="#0e4a6a" opacity={0.05} strokeW={0.6} />
                {/* Mid waves */}
                <WaveLayer y={240} amp={5}  freq={150} dur={7}  color="#00E0A0" opacity={0.03} strokeW={0.5} />
                <WaveLayer y={280} amp={6}  freq={140} dur={9}  color="#0e4a6a" opacity={0.04} strokeW={0.6} />
                {/* Foreground waves */}
                <WaveLayer y={320} amp={5}  freq={130} dur={6}  color="#00E0A0" opacity={0.035} strokeW={0.6} />
                <WaveLayer y={360} amp={7}  freq={120} dur={7}  color="#0a3048" opacity={0.06} strokeW={0.8} />

                {/* ── Dockyard ──────────────────────────────────────────── */}
                <g>
                    <ellipse cx={DOCK_X} cy={SVG_H / 2} rx={70} ry={SVG_H * 0.55} fill="url(#br-dock-g)" />
                    {/* Pier */}
                    <rect x={DOCK_X - 6} y={55} width={6} height={SVG_H - 85} fill="#14243c" opacity={0.7} rx={2} />
                    <rect x={DOCK_X + 16} y={65} width={5} height={SVG_H - 95} fill="#14243c" opacity={0.5} rx={2} />
                    {/* Planks between pilings */}
                    {[80, 130, 180, 230, 280].map(yy => (
                        <line key={yy} x1={DOCK_X - 6} y1={yy} x2={DOCK_X + 21} y2={yy}
                            stroke="#1a3050" strokeWidth={2} opacity={0.3} />
                    ))}
                    {/* Crane */}
                    <g opacity={0.22}>
                        <line x1={DOCK_X - 3} y1={55} x2={DOCK_X - 3} y2={18} stroke="#1e3a5e" strokeWidth={3} />
                        <line x1={DOCK_X - 3} y1={18} x2={DOCK_X + 42} y2={18} stroke="#1e3a5e" strokeWidth={2} />
                        <line x1={DOCK_X - 3} y1={55} x2={DOCK_X + 42} y2={18} stroke="#1e3a5e" strokeWidth={0.8} opacity={0.4} />
                        <line x1={DOCK_X + 40} y1={18} x2={DOCK_X + 40} y2={36} stroke="#1e3a5e" strokeWidth={0.7} strokeDasharray="2,2">
                            <animate attributeName="y2" values="36;42;36" dur="4s" repeatCount="indefinite" />
                        </line>
                    </g>
                    {/* Harbor lights */}
                    <circle cx={DOCK_X - 3} cy={53} r={3} fill="#FFB800" opacity={0.45} filter="url(#br-gl)">
                        <animate attributeName="opacity" values="0.45;0.12;0.45" dur="3s" repeatCount="indefinite" />
                    </circle>
                    <circle cx={DOCK_X + 18} cy={63} r={2.5} fill="#FFB800" opacity={0.3} filter="url(#br-gl)">
                        <animate attributeName="opacity" values="0.3;0.08;0.3" dur="4s" repeatCount="indefinite" />
                    </circle>
                    <text x={DOCK_X + 5} y={SVG_H - 16} textAnchor="middle" fill="#1e3a5e" fontSize={7} fontFamily="monospace" fontWeight="bold" letterSpacing="0.25em">
                        PORT
                    </text>
                </g>

                {/* ── Milestone markers along the course ───────────────── */}
                {milestones.map(m => (
                    <g key={m.label} opacity={0.12}>
                        <line x1={m.x} y1={LANE_TOP - 10} x2={m.x} y2={LANE_BOT + 10}
                            stroke="white" strokeWidth={0.3} strokeDasharray="2,8" />
                        <text x={m.x} y={LANE_TOP - 16} textAnchor="middle" fill="white"
                            fontSize={5.5} fontFamily="monospace" fontWeight="bold" letterSpacing="0.12em" opacity={0.6}>
                            {m.label}
                        </text>
                    </g>
                ))}

                {/* ── Finish area ──────────────────────────────────────── */}
                <g>
                    <ellipse cx={FINISH_X} cy={SVG_H / 2} rx={55} ry={SVG_H * 0.65} fill="url(#br-fin-g)" />
                    {/* Glow line */}
                    <line x1={FINISH_X - 12} y1={LANE_TOP - 15} x2={FINISH_X - 12} y2={LANE_BOT + 15}
                        stroke="#00E0A0" strokeWidth={1.5} opacity={0.1}>
                        <animate attributeName="opacity" values="0.1;0.22;0.1" dur="2.5s" repeatCount="indefinite" />
                    </line>
                    <line x1={FINISH_X - 12} y1={LANE_TOP - 15} x2={FINISH_X - 12} y2={LANE_BOT + 15}
                        stroke="#00E0A0" strokeWidth={5} opacity={0.02} filter="url(#br-gl2)">
                        <animate attributeName="opacity" values="0.02;0.06;0.02" dur="2.5s" repeatCount="indefinite" />
                    </line>
                    {/* Flagpole */}
                    <line x1={FINISH_X + 4} y1={28} x2={FINISH_X + 4} y2={LANE_BOT + 10} stroke="#1e3a5e" strokeWidth={1.8} opacity={0.4} />
                    {/* Checkered flag */}
                    <rect x={FINISH_X + 6} y={28} width={20} height={13} rx={1.5} fill="url(#br-chk)" opacity={0.45}>
                        <animate attributeName="width" values="20;21;20" dur="2.5s" repeatCount="indefinite" />
                    </rect>
                    <text x={FINISH_X - 2} y={SVG_H - 14} textAnchor="middle" fill="#00E0A0" fontSize={7} fontFamily="monospace" fontWeight="bold" letterSpacing="0.3em" opacity={0.25}>
                        FINISH
                    </text>
                </g>

                {/* ── Lane guides ──────────────────────────────────────── */}
                {ships.map(s => (
                    <line key={`ln-${s.id}`}
                        x1={DOCK_X + 25} y1={s.laneY + 15} x2={FINISH_X - 18} y2={s.laneY + 15}
                        stroke="white" strokeWidth={0.25} strokeDasharray="2,20" opacity={0.035} />
                ))}

                {/* ── Ships ────────────────────────────────────────────── */}
                <g ref={shipsGroupRef}>
                    {ships.map(s => {
                        const isRunning = s.task.status === "RUNNING";
                        const isFailed = s.task.status === "FAILED";
                        return (
                            <g key={s.id} className="race-ship">
                                {/* Wake trail (stronger for running) */}
                                <ellipse cx={-42} cy={13} rx={isRunning ? 55 : 30} ry={isRunning ? 4 : 2.5}
                                    fill="url(#br-wake)" opacity={isRunning ? 0.25 : 0.08}>
                                    {isRunning && (
                                        <animate attributeName="rx" values="50;65;50" dur="3.5s" repeatCount="indefinite" />
                                    )}
                                </ellipse>
                                {isRunning && (
                                    <>
                                        {/* Secondary wake */}
                                        <ellipse cx={-60} cy={15} rx={28} ry={2} fill="white" opacity={0.03}>
                                            <animate attributeName="rx" values="22;34;22" dur="4.5s" repeatCount="indefinite" />
                                        </ellipse>
                                        {/* Bow spray particles */}
                                        {[0, 1, 2, 3].map(j => (
                                            <circle key={j} cx={35 + j * 2} cy={j * 2} r={0.8 + j * 0.2} fill="white" opacity={0}>
                                                <animate attributeName="cy" values={`${j * 2};${-5 - j * 2};${j * 2}`} dur={`${0.6 + j * 0.15}s`} repeatCount="indefinite" begin={`${j * 0.12}s`} />
                                                <animate attributeName="opacity" values="0.2;0;0.2" dur={`${0.6 + j * 0.15}s`} repeatCount="indefinite" begin={`${j * 0.12}s`} />
                                            </circle>
                                        ))}
                                    </>
                                )}

                                {/* Hull glow on water */}
                                <ellipse cx={0} cy={22} rx={isRunning ? 44 : 32} ry={isRunning ? 9 : 6}
                                    fill={s.style.color} opacity={isRunning ? 0.07 : 0.03} filter="url(#br-gl2)" />

                                {/* Failed: red X overlay */}
                                {isFailed && (
                                    <g opacity={0.3}>
                                        <line x1={-15} y1={-15} x2={15} y2={15} stroke="#E3000F" strokeWidth={3} />
                                        <line x1={15} y1={-15} x2={-15} y2={15} stroke="#E3000F" strokeWidth={3} />
                                    </g>
                                )}

                                {/* The ship */}
                                {s.shipType === "container"
                                    ? <ContainerShip accentColor={s.style.color} dim={s.style.dim} />
                                    : <WoodenShip accentColor={s.style.color} dim={s.style.dim} />
                                }

                                {/* Smoke (container + running) */}
                                {s.shipType === "container" && isRunning && (
                                    <g opacity={0.1}>
                                        {[0, 1, 2, 3].map(j => (
                                            <circle key={j} cx={-1.5 + j} cy={-34} r={1.2} fill="#c8d8e8">
                                                <animate attributeName="cy" values="-34;-58" dur={`${2.2 + j * 0.6}s`} repeatCount="indefinite" begin={`${j * 0.6}s`} />
                                                <animate attributeName="r" values="1.2;4.5" dur={`${2.2 + j * 0.6}s`} repeatCount="indefinite" begin={`${j * 0.6}s`} />
                                                <animate attributeName="opacity" values="0.18;0" dur={`${2.2 + j * 0.6}s`} repeatCount="indefinite" begin={`${j * 0.6}s`} />
                                            </circle>
                                        ))}
                                    </g>
                                )}

                                {/* Badge above */}
                                <g transform={`translate(0, ${s.shipType === "container" ? -50 : -62})`}>
                                    <ShipBadge
                                        taskId={s.task.id}
                                        title={s.task.title}
                                        style={s.style}
                                        mergeIndicator={s.task.merge_indicator}
                                        isRunning={isRunning}
                                    />
                                </g>
                            </g>
                        );
                    })}
                </g>

                {/* ── Foreground wave (depth) ──────────────────────────── */}
                <path
                    d={`M0 ${SVG_H - 6} Q${SVG_W * 0.12} ${SVG_H - 13} ${SVG_W * 0.25} ${SVG_H - 6} T${SVG_W * 0.5} ${SVG_H - 6} T${SVG_W * 0.75} ${SVG_H - 6} T${SVG_W} ${SVG_H - 6} V${SVG_H} H0 Z`}
                    fill="#020508" opacity={0.5}>
                    <animateTransform attributeName="transform" type="translate" values="0 0;-18 1.5;0 0" dur="7s" repeatCount="indefinite" />
                </path>
                <path
                    d={`M0 ${SVG_H - 2} Q${SVG_W * 0.18} ${SVG_H - 8} ${SVG_W * 0.35} ${SVG_H - 2} T${SVG_W * 0.7} ${SVG_H - 2} T${SVG_W} ${SVG_H - 2} V${SVG_H} H0 Z`}
                    fill="#010306" opacity={0.7}>
                    <animateTransform attributeName="transform" type="translate" values="0 0;12 -1;0 0" dur="5s" repeatCount="indefinite" />
                </path>
            </svg>
        </div>
    );
};
