import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import {
    listEmbeddingModels,
    getReembedProgress,
    getMemoryStats,
    type ReembedProgress,
    type EmbeddingModelWithStatus,
    type MemoryStats
} from "../lib/memory-api.js";

export function useEmbeddingModelStatus(
    pid: string,
    initialModels: EmbeddingModelWithStatus[],
    initialStats: MemoryStats,
    onReembedComplete: () => void
) {
    const [models, setModels] = useState<EmbeddingModelWithStatus[]>(initialModels);
    const [stats, setStats] = useState<MemoryStats>(initialStats);
    const [reembed, setReembed] = useState<ReembedProgress | null>(null);

    // Sync state when props change
    useEffect(() => setModels(initialModels), [initialModels]);
    useEffect(() => setStats(initialStats), [initialStats]);

    /* ── Polling for model download progress ───────────────────────────── */
    const isDownloadingRef = useRef(false);
    useEffect(() => {
        isDownloadingRef.current = models.some(m => m.downloading);
    }, [models]);

    useEffect(() => {
        const interval = setInterval(async () => {
            if (!isDownloadingRef.current) return;
            try {
                const updated = await listEmbeddingModels();
                setModels(updated);
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, []);

    /* ── Polling for re-embed progress ────────────────────────────────── */
    const reembedStateRef = useRef({ active: reembed?.active, pid, onReembedComplete });
    useEffect(() => {
        reembedStateRef.current = { active: reembed?.active, pid, onReembedComplete };
    }, [reembed?.active, pid, onReembedComplete]);

    useEffect(() => {
        const interval = setInterval(async () => {
            const state = reembedStateRef.current;
            if (!state.active || !state.pid) return;
            try {
                const progress = await getReembedProgress(state.pid);
                setReembed(progress);

                // Also update stats so stale count changes without a full loadData
                if (progress.active) {
                    const latestStats = await getMemoryStats(state.pid);
                    setStats(latestStats);
                }

                if (!progress.active) {
                    state.onReembedComplete();
                }
            } catch { /* ignore */ }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    return {
        models,
        setModels,
        stats,
        setStats,
        reembed,
        setReembed
    };
}
