import { useRef, useEffect, useCallback, useMemo } from "preact/hooks";
import { useSignal, type Signal } from "@preact/signals";
import gsap from "gsap";
import type { Subtask, ExecutionTaskDispatchSummary } from "../../types.js";
import { getTaskProgressPhase } from "../../lib/task-progress.js";
import {
    getBoatRaceTaskKey,
    buildBoatRaceDispatchIndex,
    getShipType,
    isBoatRaceActiveTask,
    isBoatRaceHarbourTask,
} from "../lib/boat-race.js";
import { SPAWN_Y, HARBOUR_X, RACE_LEN, LANE_TOP, LANE_BOT } from "../components/boat-race/constants.js";
import { stableRand, getStyle, type StatusStyle } from "../components/boat-race/utils.js";

export const CP = {
    HARBOUR:    0.00,
    DEPARTURE:  0.04,
    RUNNING:    0.25,
    CODING_COMPLETED:  0.48,
    COMP_TARGET: 0.56,
    CI:         0.62,
    CI_TARGET:  0.68,
    QA:         0.72,
    QA_TARGET:  0.76,
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
            if (mi === "QA_PENDING")     return { confirmed: CP.QA, target: CP.QA_TARGET, stopped: false };
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
    const animatedPositionsSignal = useSignal<Record<string, AnimatedShipPosition>>({});

    useEffect(() => {
        if (!hasSprintContext || activeShips.length === 0) {
            animStateRef.current.clear();
            animatedPositionsSignal.value = {};
        }
    }, [activeShips.length, hasSprintContext]);

    const updatePositions = useCallback(() => {
        if (activeShips.length === 0) return;

        const now = performance.now();
        const nextPositions: Record<string, AnimatedShipPosition> = {};
        let needsUpdate = false;

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
            nextPositions[ship.key] = {
                x,
                y: state.currentY,
                scale: state.scale,
                opacity: state.opacity,
                pingedCheckpoints: state.pingedCheckpoints
            };
            needsUpdate = true;
        });

        if (needsUpdate) {
            animatedPositionsSignal.value = nextPositions;
        }
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
        animatedPositionsSignal
    };
};
