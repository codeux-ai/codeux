import type { FunctionComponent } from "preact";
import { useRef, useMemo, useEffect, useCallback, useState } from "preact/hooks";
import { useSignal, useComputed } from "@preact/signals";
import { memo } from "preact/compat";
import gsap from "gsap";
import { Anchor } from "lucide-preact";
import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";
import { getBoatRaceHeightPx, getBoatRaceTaskKey, buildBoatRaceDispatchIndex, getShipType } from "../lib/boat-race.js";

import { BoatRaceBackground, BoatRaceCourseLayer } from "./boat-race/BoatRaceCourse.js";
import { BoatRaceHarbourLayer } from "./boat-race/BoatRaceHarbour.js";
import { BoatRaceShipsLayer } from "./boat-race/BoatRaceShip.js";
import { SVG_W, SVG_H, HARBOUR_X, FINISH_X, RACE_LEN, LANE_TOP, LANE_BOT, TOW_LINE_LENGTH, BADGE_OFFSET, SPAWN_Y } from "./boat-race/constants.js";
import { useIsDark, getProgressTarget, getStyle, CP, HALF_LIFE_MS, hashStr, stableRand, createInitialShipAnimationState } from "./boat-race/utils.js";
import type { ShipDatum } from "./boat-race/utils.js";

/* ─── Props ──────────────────────────────────────────────────────────────── */

interface BoatRaceProps {
    tasks: Subtask[];
    dispatches: ExecutionTaskDispatchSummary[];
    hasLiveSprint: boolean;
}



export const SprintBoatRace: FunctionComponent<BoatRaceProps> = ({ tasks, dispatches, hasLiveSprint }) => {
    const shipsGroupRef = useRef<SVGGElement>(null);
    const animStateRef = useRef<Map<string, {
        currentProgress: number;
        currentY: number;       // animated Y (starts at SPAWN_Y, drifts to laneY)
        lastTime: number;
        yWobbleOffset: number;  // small random Y wobble for natural movement
        yWobblePhase: number;   // phase of wobble oscillation
        pingedCheckpoints: Set<number>;
    }>>(new Map());
    const tickerRef = useRef<(() => void) | null>(null);
    const bobTweensRef = useRef<gsap.core.Tween[]>([]);
    const isDark = useIsDark();

    /* ── Tracking previous statuses for shake/tilt effect ────────── */
    const prevStatusesRef = useRef<Map<string, string>>(new Map());

    /* ── Mouse ripple effect ─────────────────────────────────────── */
    const svgRef = useRef<SVGSVGElement>(null);
    const ripplesSignal = useSignal<{ x: number; y: number; id: number }[]>([]);
    const rippleIdRef = useRef(0);
    const lastRippleRef = useRef(0);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        const svg = svgRef.current;
        if (!svg) return;
        // Throttle: only add ripple every ~200ms
        const now = performance.now();
        if (now - lastRippleRef.current < 200) return;
        lastRippleRef.current = now;

        const rect = svg.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * SVG_W;
        const y = ((e.clientY - rect.top) / rect.height) * SVG_H;
        const id = ++rippleIdRef.current;
        ripplesSignal.value = [...ripplesSignal.value.slice(-6), { x, y, id }];
        // Auto-remove after animation
        setTimeout(() => { ripplesSignal.value = ripplesSignal.value.filter(r => r.id !== id); }, 2000);
    }, []);

    /* ── Separate waiting (harbour) vs active (on water) ────────── */
    const tasksSignal = useSignal(tasks);
    tasksSignal.value = tasks;

    const dispatchesSignal = useSignal(dispatches);
    dispatchesSignal.value = dispatches;

    const activeShipsSignal = useComputed(() => {
        if (!hasLiveSprint || tasksSignal.value.length === 0) return [];
        const active = tasksSignal.value.filter(t => t.status !== "PENDING" && t.status !== "BLOCKED");
        const count = active.length;
        const usable = LANE_BOT - LANE_TOP;
        const laneH = Math.min(60, usable / Math.max(1, count));
        const totalH = laneH * count;
        const offsetY = LANE_TOP + (usable - totalH) / 2;
        const dispatchIndex = buildBoatRaceDispatchIndex(dispatchesSignal.value);
        return active.map((task, i) => {
            const raceKey = getBoatRaceTaskKey(task);
            const progress = getProgressTarget(task);
            const style = getStyle(task);
            const yJitter = (stableRand(raceKey, 20) - 0.5) * laneH * 0.2;
            return {
                key: raceKey,
                task,
                shipType: getShipType(task, dispatchIndex),
                progress,
                laneY: offsetY + i * laneH + laneH / 2 + yJitter,
                style
            } as ShipDatum;
        });
    });

    const harbourCountSignal = useComputed(() => {
        if (!hasLiveSprint || tasksSignal.value.length === 0) return 0;
        return tasksSignal.value.filter(t => t.status === "PENDING" || t.status === "BLOCKED").length;
    });

    const raceHeightPx = useMemo(() => getBoatRaceHeightPx(activeShipsSignal.value.length), [activeShipsSignal.value.length]);

    useEffect(() => {
        if (!hasLiveSprint || activeShipsSignal.value.length === 0) {
            animStateRef.current.clear();
        }
    }, [activeShipsSignal.value.length, hasLiveSprint]);

    /* ── Continuous Zeno's paradox animation via GSAP ticker ─────── */
    const updatePositions = useCallback(() => {
        const group = shipsGroupRef.current;
        if (!group || activeShipsSignal.value.length === 0) return;

        const now = performance.now();
        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));

        els.forEach((el, i) => {
            const ship = activeShipsSignal.value[i];
            if (!ship) return;

            const state = animStateRef.current.get(ship.key);
            const target = ship.progress.target;
            const confirmed = ship.progress.confirmed;

            if (!state) {
                const initialState = createInitialShipAnimationState(ship.key, now);
                animStateRef.current.set(ship.key, initialState);
                const x = HARBOUR_X + 20 + initialState.currentProgress * RACE_LEN;
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

            if (getTaskProgressPhase(ship.task) === "RUNNING" && state.currentProgress > CP.CODING_COMPLETED) {
                const resetState = createInitialShipAnimationState(ship.key, now);
                state.currentProgress = resetState.currentProgress;
                state.currentY = resetState.currentY;
                state.lastTime = resetState.lastTime;
                state.yWobbleOffset = resetState.yWobbleOffset;
                state.yWobblePhase = resetState.yWobblePhase;
                state.pingedCheckpoints.clear();
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

            // Checkpoint pings
            const checkPing = (cp: number) => {
                if (state.currentProgress >= cp && !state.pingedCheckpoints.has(cp)) {
                    state.pingedCheckpoints.add(cp);
                    const pingEl = el.querySelector(".checkpoint-ping");
                    if (pingEl) {
                        gsap.fromTo(pingEl,
                            { opacity: 0.8, r: 0 },
                            { opacity: 0, r: 60, duration: 1.5, ease: "power2.out" }
                        );
                    }
                }
            };

            checkPing(CP.CI);
            checkPing(CP.AUTOMERGE);
            checkPing(CP.COMPLETED);
        });
    }, [activeShipsSignal.value]);

    // Start/stop GSAP ticker
    useEffect(() => {
        if (activeShipsSignal.value.length === 0) return;

        // Clean up departed ships from animation state
        const currentIds = new Set(activeShipsSignal.value.map(s => s.key));
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
    }, [activeShipsSignal.value, updatePositions]);

    /* ── Status change animations (shake/tilt) ───────────────────── */
    useEffect(() => {
        const group = shipsGroupRef.current;
        if (!group) return;

        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));

        activeShipsSignal.value.forEach((ship, i) => {
            const prevStatus = prevStatusesRef.current.get(ship.key);
            const currentStatus = ship.task.status;

            if (prevStatus && prevStatus !== currentStatus && (currentStatus === "FAILED" || currentStatus === "BLOCKED")) {
                const el = els[i];
                if (el) {
                    const wrapper = el.querySelector(".ship-model-wrapper");
                    if (wrapper) {
                        // Momentary tilt/shake
                        gsap.timeline()
                            .to(wrapper, { rotation: -15, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                            .to(wrapper, { rotation: 10, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                            .to(wrapper, { rotation: -5, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                            .to(wrapper, { rotation: 0, duration: 0.3, ease: "power2.out", transformOrigin: "center center" });
                    }
                }
            }

            if (currentStatus) {
                prevStatusesRef.current.set(ship.key, currentStatus);
            }
        });
    }, [activeShipsSignal.value]);

    /* ── Bobbing & sway animation ────────────────────────────────── */
    const shipIdLineup = useMemo(() => activeShipsSignal.value.map(s => s.key).join(","), [activeShipsSignal.value]);
    useEffect(() => {
        const group = shipsGroupRef.current;
        if (!group || activeShipsSignal.value.length === 0) return;

        bobTweensRef.current.forEach(t => t.kill());
        bobTweensRef.current = [];

        const els = Array.from(group.querySelectorAll<SVGGElement>(".race-ship"));
        els.forEach((el, i) => {
            const ship = activeShipsSignal.value[i];
            if (!ship) return;
            const isMoving = !ship.progress.stopped;
            const bobAmp = isMoving ? 2.5 + stableRand(ship.key, 2) * 2 : 1 + stableRand(ship.key, 2) * 0.8;
            const bobDur = 3 + stableRand(ship.key, 3) * 2;

            bobTweensRef.current.push(
                gsap.to(el, {
                    y: `+=${bobAmp}`,
                    rotation: (stableRand(ship.key, 4) - 0.5) * (isMoving ? 3 : 1),
                    duration: bobDur,
                    ease: "sine.inOut",
                    repeat: -1,
                    yoyo: true,
                    delay: stableRand(ship.key, 1) * 4,
                }),
                gsap.to(el, {
                    x: `+=${isMoving ? 3 + stableRand(ship.key, 5) * 4 : 1}`,
                    duration: 5 + stableRand(ship.key, 6) * 3,
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
        { progress: CP.CODING_COMPLETED, label: "CODE DONE", color: "#0F9FA8" },
        { progress: CP.CI, label: "CI", color: "#5dade2" },
        { progress: CP.AUTOMERGE, label: "MERGE", color: "#FFB800" },
        { progress: CP.COMPLETED, label: "COMPLETED", color: "#00AB84" },
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
                            {activeShipsSignal.value.length + harbourCountSignal.value} vessel{(activeShipsSignal.value.length + harbourCountSignal.value) !== 1 ? "s" : ""}
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
                    <BoatRaceBackground isDark={isDark} ripplesSignal={ripplesSignal} />
                    <BoatRaceHarbourLayer isDark={isDark} harbourCountSignal={harbourCountSignal} />
                    <BoatRaceCourseLayer isDark={isDark} activeShipsSignal={activeShipsSignal} />
                    <BoatRaceShipsLayer
                        activeShipsSignal={activeShipsSignal}
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
