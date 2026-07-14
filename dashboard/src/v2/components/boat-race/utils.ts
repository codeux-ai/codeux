import { useState, useEffect } from "preact/hooks";
import type { Subtask } from "../../../types.js";
import { getTaskProgressPhase } from "../../../lib/task-progress.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateLiveMessage, type LiveMessageKey } from "../../i18n/messages/live.js";

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

const statusLabel = (locale: DashboardLocale, key: LiveMessageKey): string => translateLiveMessage(locale, key);

export const getStyle = (task: Subtask, locale: DashboardLocale = "en"): StatusStyle => {
    switch (getTaskProgressPhase(task)) {
        case "RUNNING":   return { color: "#00E0A0", label: statusLabel(locale, "coding"), dim: false };
        case "CODING_COMPLETED": {
            const mi = task.merge_indicator;
            if (mi === "AUTOMERGE")      return { color: "#FFB800", label: statusLabel(locale, "automerge"), dim: false };
            if (mi === "CI")             return { color: "#5dade2", label: "CI",         dim: false };
            if (mi === "QA_PENDING")     return { color: "#D97706", label: statusLabel(locale, "qaPending"), dim: false };
            if (mi === "MERGE_BLOCKED")  return { color: "#F59E0B", label: statusLabel(locale, "blocked"), dim: false };
            if (mi === "MERGE_CONFLICT") return { color: "#E3000F", label: statusLabel(locale, "conflict"), dim: false };
            return { color: "#0F9FA8", label: statusLabel(locale, "codingDone"), dim: false };
        }
        case "COMPLETED": return { color: "#00AB84", label: statusLabel(locale, "completed"), dim: false };
        case "FAILED":  return { color: "#E3000F", label: statusLabel(locale, "failed"), dim: true };
        case "BLOCKED": return { color: "#F59E0B", label: statusLabel(locale, "blocked"), dim: true };
        case "PENDING": return { color: "#475569", label: statusLabel(locale, "queued"), dim: true };
        default:        return { color: "#475569", label: "—",       dim: true };
    }
};
