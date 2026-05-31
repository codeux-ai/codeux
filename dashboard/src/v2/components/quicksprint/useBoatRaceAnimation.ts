import { useRef, useEffect, useCallback, useMemo } from "preact/hooks";
import { useSignal, signal, type Signal } from "@preact/signals";
import gsap from "gsap";
import type { Subtask, ExecutionTaskDispatchSummary } from "../../../types.js";
import { getTaskProgressPhase } from "../../../lib/task-progress.js";
import {
    getBoatRaceTaskKey,
    buildBoatRaceDispatchIndex,
    getShipType,
    isBoatRaceActiveTask,
    isBoatRaceHarbourTask,
} from "../../lib/boat-race.js";
import { SPAWN_Y, HARBOUR_X, RACE_LEN, LANE_TOP, LANE_BOT } from "../../lib/boat-race-config.js";
import { stableRand, getStyle, type StatusStyle } from "../boat-race/utils.js";

export const CP = {
    HARBOUR:    0.00,
    DEPARTURE:  0.04,
    RUNNING:    0.25,
    CODING_COMPLETED:  0.48,
    COMP_TARGET: 0.56,
    CI:         0.62,
    CI_TARGET:  0.72,
    AUTOMERGE:  0.78,
    AM_TARGET:  0.90,
    COMPLETED:  0.96,
    FINISH:     1.06,
} as const;

export const HALF_LIFE_MS = 40_000;

export interface ProgressTarget {
    confirmed: number;
    target: number;
    stopped: boolean;
}

export interface ShipDatum {
    key: string;
    task: Subtask;
    shipType: "container" | "wooden";
    progress: ProgressTarget;
    laneY: number;
    style: StatusStyle;
}

export const getProgressTarget = (task: Subtask): ProgressTarget => {
    const raceKey = getBoatRaceTaskKey(task);
    switch (getTaskProgressPhase(task)) {
        case "PENDING":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "BLOCKED":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "QUOTA":    return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "FAILED":   return { confirmed: CP.DEPARTURE + stableRand(raceKey, 30) * 0.12, target: CP.DEPARTURE + stableRand(raceKey, 30) * 0.12, stopped: true };
        case "RUNNING":  return { confirmed: CP.DEPARTURE, target: CP.RUNNING, stopped: false };
        case "CODING_COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "AUTOMERGE")      return { confirmed: CP.AUTOMERGE, target: CP.AM_TARGET, stopped: false };
            if (mi === "CI")             return { confirmed: CP.CI, target: CP.CI_TARGET, stopped: false };
            if (mi === "MERGE_BLOCKED")  return { confirmed: CP.CODING_COMPLETED, target: CP.CODING_COMPLETED, stopped: true };
            if (mi === "MERGE_CONFLICT") return { confirmed: CP.CODING_COMPLETED, target: CP.CODING_COMPLETED, stopped: true };
            return { confirmed: CP.CODING_COMPLETED, target: CP.COMP_TARGET, stopped: false };
        }
        case "COMPLETED":
            return { confirmed: CP.COMPLETED, target: CP.FINISH, stopped: false };
        default: return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
    }
};

export const createInitialShipAnimationState = (shipKey: string, now: number, progress?: ProgressTarget) => {
    const spawnXOffset = (stableRand(shipKey, 40) - 0.5) * 0.02;
    const confirmed = progress?.confirmed ?? CP.HARBOUR;
    const initial = confirmed > CP.DEPARTURE
        ? Math.min(confirmed, CP.FINISH)
        : CP.DEPARTURE * 0.5 + spawnXOffset;
    return {
        currentProgress: initial,
        currentY: SPAWN_Y + (stableRand(shipKey, 41) - 0.5) * 20,
        lastTime: now,
        yWobbleOffset: (stableRand(shipKey, 42) - 0.5) * 6,
        yWobblePhase: stableRand(shipKey, 43) * Math.PI * 2,
        pingedCheckpoints: new Set<number>(),
        opacity: 0,
        scale: 0.6
    };
};

export interface AnimatedShipPosition {
    x: number;
    y: number;
    scale: number;
    opacity: number;
    pingedCheckpoints: Set<number>;
}

export const useBoatRaceAnimation = (
    tasks: Subtask[],
    dispatches: ExecutionTaskDispatchSummary[],
    hasSprintContext: boolean
) => {
    const activeShips = useMemo(() => {
        if (!hasSprintContext || tasks.length === 0) return [];
        const active = tasks.filter(isBoatRaceActiveTask);
        const count = active.length;
        const usable = LANE_BOT - LANE_TOP;
        const laneH = Math.min(60, usable / Math.max(1, count));
        const totalH = laneH * count;
        const offsetY = LANE_TOP + (usable - totalH) / 2;
        const dispatchIndex = buildBoatRaceDispatchIndex(dispatches);
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
    }, [dispatches, hasSprintContext, tasks]);

    const harbourCount = useMemo(() => {
        if (!hasSprintContext || tasks.length === 0) return 0;
        return tasks.filter(isBoatRaceHarbourTask).length;
    }, [hasSprintContext, tasks]);

    const animStateRef = useRef<Map<string, ReturnType<typeof createInitialShipAnimationState>>>(new Map());
    const tickerRef = useRef<(() => void) | null>(null);
    const animatedPositionsSignals = useRef<Record<string, Signal<AnimatedShipPosition>>>({});

    if (hasSprintContext && activeShips.length > 0) {
        activeShips.forEach(ship => {
            if (!animatedPositionsSignals.current[ship.key]) {
                animatedPositionsSignals.current[ship.key] = signal({
                    x: -100, y: ship.laneY, scale: 0.6, opacity: 0, pingedCheckpoints: new Set()
                });
            }
        });
    }

    useEffect(() => {
        if (!hasSprintContext || activeShips.length === 0) {
            animStateRef.current.clear();
            animatedPositionsSignals.current = {};
        }
    }, [activeShips.length, hasSprintContext]);

    const updatePositions = useCallback(() => {
        if (activeShips.length === 0) return;

        const now = performance.now();


        activeShips.forEach((ship, i) => {
            let state = animStateRef.current.get(ship.key);
            const target = ship.progress.target;
            const confirmed = ship.progress.confirmed;

            if (!state) {
                state = createInitialShipAnimationState(ship.key, now, ship.progress);
                animStateRef.current.set(ship.key, state);

                // Spawn tweening via GSAP on the state object
                gsap.to(state, {
                    opacity: 1,
                    scale: 1,
                    duration: 1.6,
                    ease: "power2.out",
                    delay: i * 0.12,
                });
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

            // X: Ensure current is at least at confirmed checkpoint
            if (state.currentProgress < confirmed) {
                state.currentProgress = state.currentProgress + (confirmed - state.currentProgress) * 0.12;
                if (confirmed - state.currentProgress < 0.002) {
                    state.currentProgress = confirmed;
                }
            }

            // X: Zeno's paradox drift toward target
            if (!ship.progress.stopped && Math.abs(target - state.currentProgress) > 0.0005) {
                const decay = 1 - Math.pow(0.5, dt / HALF_LIFE_MS);
                state.currentProgress += (target - state.currentProgress) * decay;
            }

            // Y: Smoothly drift from current Y toward target lane
            const targetY = ship.laneY;
            const yDiff = targetY - state.currentY;
            if (Math.abs(yDiff) > 0.5) {
                const yDecay = 1 - Math.pow(0.5, dt / 3000); // ~3s half-life for lane spreading
                state.currentY += yDiff * yDecay;
                state.yWobblePhase += dt * 0.0008;
                const wobble = Math.sin(state.yWobblePhase) * state.yWobbleOffset * Math.min(1, Math.abs(yDiff) / 30);
                state.currentY += wobble * yDecay * 0.3;
            } else {
                state.currentY = targetY;
            }

            const checkPing = (cp: number) => {
                if (state.currentProgress >= cp && !state!.pingedCheckpoints.has(cp)) {
                    state!.pingedCheckpoints.add(cp);
                    // trigger copy
                    state!.pingedCheckpoints = new Set(state!.pingedCheckpoints);
                }
            };

            checkPing(CP.CI);
            checkPing(CP.AUTOMERGE);
            checkPing(CP.COMPLETED);

            const x = HARBOUR_X + 20 + state.currentProgress * RACE_LEN;
            if (animatedPositionsSignals.current[ship.key]) {
                animatedPositionsSignals.current[ship.key].value = {
                    x,
                    y: state.currentY,
                    scale: state.scale,
                    opacity: state.opacity,
                    pingedCheckpoints: state.pingedCheckpoints
                };
            }
        });
    }, [activeShips]);

    useEffect(() => {
        if (activeShips.length === 0) return;

        const currentIds = new Set(activeShips.map(s => s.key));
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

    return {
        activeShips,
        harbourCount,
        animatedPositionsSignals: animatedPositionsSignals.current
    };
};


export function useShipAnimation(s: ShipDatum, pingsCount: import('@preact/signals').ReadonlySignal<number>) {
    const isMoving = !s.progress.stopped;
    const currentStatus = s.task.status;
    const prevStatusRef = useRef(currentStatus);
    const pingRef = useRef<SVGCircleElement>(null);
    const bobRef = useRef<SVGGElement>(null);
    const wrapperRef = useRef<SVGGElement>(null);

    useEffect(() => {
        const el = bobRef.current;
        const bobAmp = isMoving ? 2.5 + stableRand(s.key, 2) * 2 : 1 + stableRand(s.key, 2) * 0.8;
        const bobDur = 3 + stableRand(s.key, 3) * 2;

        const tweens = [
            gsap.to(el, {
                y: bobAmp,
                rotation: (stableRand(s.key, 4) - 0.5) * (isMoving ? 3 : 1),
                duration: bobDur,
                ease: "sine.inOut",
                repeat: -1,
                yoyo: true,
                delay: stableRand(s.key, 1) * 4,
            }),
            gsap.to(el, {
                x: isMoving ? 3 + stableRand(s.key, 5) * 4 : 1,
                duration: 5 + stableRand(s.key, 6) * 3,
                ease: "sine.inOut",
                repeat: -1,
                yoyo: true,
            })
        ];

        return () => {
            tweens.forEach(t => t.kill());
        };
    }, [isMoving, s.key]);

    useEffect(() => {
        const prevStatus = prevStatusRef.current;
        if (prevStatus !== currentStatus && (currentStatus === "FAILED" || currentStatus === "BLOCKED") && wrapperRef.current) {
            gsap.timeline()
                .to(wrapperRef.current, { rotation: -15, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                .to(wrapperRef.current, { rotation: 10, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                .to(wrapperRef.current, { rotation: -5, duration: 0.15, ease: "power1.inOut", transformOrigin: "center center" })
                .to(wrapperRef.current, { rotation: 0, duration: 0.3, ease: "power2.out", transformOrigin: "center center" });
        }
        prevStatusRef.current = currentStatus;
    }, [currentStatus]);

    const lastPingsCountRef = useRef(pingsCount.value);

    useEffect(() => {
        const unsubscribe = pingsCount.subscribe(count => {
            if (count > lastPingsCountRef.current && pingRef.current) {
                gsap.fromTo(pingRef.current,
                    { opacity: 0.8, r: 0 },
                    { opacity: 0, r: 60, duration: 1.5, ease: "power2.out" }
                );
            }
            lastPingsCountRef.current = count;
        });
        return unsubscribe;
    }, [pingsCount]);

    return { pingRef, bobRef, wrapperRef };
}
