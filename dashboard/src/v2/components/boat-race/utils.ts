import { useState, useEffect } from "preact/hooks";
import type { Subtask } from "../../../types.js";
import { getTaskProgressPhase } from "../../../lib/task-progress.js";

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

export interface StatusStyle { color: string; label: string; dim: boolean }

export const getStyle = (task: Subtask): StatusStyle => {
    switch (getTaskProgressPhase(task)) {
        case "RUNNING":   return { color: "#00E0A0", label: "Coding",    dim: false };
        case "CODING_COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "AUTOMERGE")      return { color: "#FFB800", label: "Automerge",  dim: false };
            if (mi === "CI")             return { color: "#5dade2", label: "CI",         dim: false };
            if (mi === "QA_PENDING")     return { color: "#D97706", label: "QA Pending", dim: false };
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
