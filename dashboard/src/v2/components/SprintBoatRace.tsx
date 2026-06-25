import type { FunctionComponent } from "preact";
import { useRef, useMemo, useCallback } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { Anchor } from "lucide-preact";
import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";
import { getBoatRaceHeightPx } from "../lib/boat-race.js";

import { BoatRaceBackground, BoatRaceCourseLayer } from "./boat-race/BoatRaceCourse.js";
import { BoatRaceHarbourLayer } from "./boat-race/BoatRaceHarbour.js";
import { BoatRaceShipsLayer } from "./boat-race/BoatRaceShip.js";
import { SVG_W, SVG_H, TOW_LINE_LENGTH, BADGE_OFFSET } from "./boat-race/constants.js";
import { useIsDark } from "./boat-race/utils.js";
import { useBoatRaceAnimation } from "../hooks/useBoatRaceAnimation.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface BoatRaceProps {
    tasks: Subtask[];
    dispatches: ExecutionTaskDispatchSummary[];
    hasSprintContext: boolean;
}



export const SprintBoatRace: FunctionComponent<BoatRaceProps> = ({ tasks, dispatches, hasSprintContext }) => {
    const shipsGroupRef = useRef<SVGGElement>(null);
    const isDark = useIsDark();






    const { activeShips, harbourCount, animatedPositionsSignal } = useBoatRaceAnimation(tasks, dispatches, hasSprintContext);
    const animatedPositions = animatedPositionsSignal.value;

    const raceHeightPx = useMemo(() => getBoatRaceHeightPx(activeShips.length), [activeShips.length]);

    const svgRef = useRef<SVGSVGElement>(null);
    const ripplesSignal = useSignal<{ x: number; y: number; id: number }[]>([]);
    const rippleIdRef = useRef(0);
    const lastRippleRef = useRef(0);

    const prefersReducedMotion = useReducedMotion();

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (prefersReducedMotion) return;
        const svg = svgRef.current;
        if (!svg) return;
        const now = performance.now();
        if (now - lastRippleRef.current < 200) return;
        lastRippleRef.current = now;

        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * SVG_W;
        const y = ((e.clientY - rect.top) / rect.height) * SVG_H;
        const id = ++rippleIdRef.current;
        ripplesSignal.value = [...ripplesSignal.value.slice(-6), { x, y, id }];
        setTimeout(() => { ripplesSignal.value = ripplesSignal.value.filter(r => r.id !== id); }, 2000);
    }, [prefersReducedMotion]);

    /* ─── Idle state ─────────────────────────────────────────────── */
    if (!hasSprintContext || tasks.length === 0) {
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
                                {hasSprintContext ? "No tasks currently in the pipeline" : "Launch a sprint to begin the race"}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }


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
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:text-white/35">Sprint Race</span>
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
                    role="img"
                    aria-label="Sprint Boat Race: Visual representation of task progress as ships racing across a harbour toward the finish line."
                    style={{ height: `${raceHeightPx}px` }}
                    preserveAspectRatio="xMidYMid meet"
                    onMouseMove={handleMouseMove}
                >
                    <BoatRaceBackground isDark={isDark} ripples={ripplesSignal.value} />
                    <BoatRaceHarbourLayer isDark={isDark} waitingCount={harbourCount} />
                    <BoatRaceCourseLayer isDark={isDark} activeShips={activeShips} />
                    <BoatRaceShipsLayer
                        activeShips={activeShips}
                        animatedPositions={animatedPositions}
                        isDark={isDark}
                        shipsGroupRef={shipsGroupRef}
                        TOW_LINE_LENGTH={TOW_LINE_LENGTH}
                        BADGE_OFFSET={BADGE_OFFSET}
                    />
                </svg>
            </div>
        </div>
    );
};
