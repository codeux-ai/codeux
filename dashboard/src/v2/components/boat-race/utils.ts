import { useState, useEffect } from "preact/hooks";
import type { Subtask } from "../../../types.js";
import { getTaskProgressPhase } from "../../../lib/task-progress.js";
import { getBoatRaceTaskKey } from "../../lib/boat-race.js";
import { SPAWN_Y } from "./constants.js";

export const hashStr = (s: string): number => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h);
};

export const stableRand = (id: string, salt = 0): number =>
    (hashStr(`${id}:${salt}`) % 10000) / 10000;

export const useIsDark = (): boolean => {
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

export const getProgressTarget = (task: Subtask): ProgressTarget => {
    const raceKey = getBoatRaceTaskKey(task);
    switch (getTaskProgressPhase(task)) {
        case "PENDING":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
        case "BLOCKED":  return { confirmed: CP.HARBOUR, target: CP.HARBOUR, stopped: true };
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

export interface StatusStyle { color: string; label: string; dim: boolean }

export const getStyle = (task: Subtask): StatusStyle => {
    switch (getTaskProgressPhase(task)) {
        case "RUNNING":   return { color: "#00E0A0", label: "Racing",    dim: false };
        case "CODING_COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "AUTOMERGE")      return { color: "#FFB800", label: "Automerge",  dim: false };
            if (mi === "CI")             return { color: "#5dade2", label: "CI",         dim: false };
            if (mi === "MERGE_BLOCKED")  return { color: "#F59E0B", label: "Blocked",    dim: false };
            if (mi === "MERGE_CONFLICT") return { color: "#E3000F", label: "Conflict",   dim: false };
            return { color: "#0F9FA8", label: "Coding Done", dim: false };
        }
        case "COMPLETED": return { color: "#00AB84", label: "Completed", dim: false };
        case "FAILED":  return { color: "#E3000F", label: "Failed",  dim: true };
        case "BLOCKED": return { color: "#F59E0B", label: "Blocked", dim: true };
        case "PENDING": return { color: "#475569", label: "Queued",  dim: true };
        default:        return { color: "#475569", label: "—",       dim: true };
    }
};

export interface ShipDatum {
    key: string;
    task: Subtask;
    shipType: "container" | "wooden";
    progress: ProgressTarget;
    laneY: number;
    style: StatusStyle;
}

export const createInitialShipAnimationState = (shipKey: string, now: number) => {
    const initial = CP.DEPARTURE * 0.5;
    const spawnXOffset = (stableRand(shipKey, 40) - 0.5) * 0.02;
    return {
        currentProgress: initial + spawnXOffset,
        currentY: SPAWN_Y + (stableRand(shipKey, 41) - 0.5) * 20,
        lastTime: now,
        yWobbleOffset: (stableRand(shipKey, 42) - 0.5) * 6,
        yWobblePhase: stableRand(shipKey, 43) * Math.PI * 2,
        pingedCheckpoints: new Set<number>()
    };
};
