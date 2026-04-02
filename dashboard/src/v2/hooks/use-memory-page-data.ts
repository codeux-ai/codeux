import { useState, useRef, useEffect, useCallback } from "preact/hooks";
import {
    listMemories,
    listEmbeddingModels,
    getMemoryStats,
    getEmbeddingMap,
    getReembedProgress,
    startReembed,
    deleteMemory as apiDeleteMemory,
    type EmbeddingModelWithStatus,
    type ReembedProgress,
    type EmbeddingMapResult
} from "../lib/memory-api.js";
import type { MemoryRecord, MemoryScope } from "../memory-types.js";
import { fetchSprints } from "../lib/project-api.js";
import { fetchAgentPresets } from "../lib/agent-preset-api.js";
import type { SprintRecord, AgentPreset } from "../types.js";

export type MemTier = "short_term" | "long_term";

export interface MemoryPageDataState {
    loading: boolean;
    records: MemoryRecord[];
    models: EmbeddingModelWithStatus[];
    stats: { sprint: number; agent: number; project: number; activeModel: string | null; staleEmbeddings: number };
    reembed: ReembedProgress | null;
    embeddingMap: EmbeddingMapResult | null;

    sprints: SprintRecord[];
    agentPresets: AgentPreset[];

    activeTier: MemTier;
    activeScope: MemoryScope;
    selectedSprintId: string | undefined;
    selectedAgentPresetId: string | undefined;
}

export interface MemoryPageDataActions {
    setActiveTier: (tier: MemTier) => void;
    setSelectedSprintId: (id: string | undefined) => void;
    setSelectedAgentPresetId: (id: string | undefined) => void;
    loadData: () => Promise<void>;
    handleReembed: () => Promise<void>;
    handleDeleteRecord: (id: string) => Promise<void>;
    setModels: (models: EmbeddingModelWithStatus[]) => void;
    setStats: (stats: any) => void;
}

export function useMemoryPageData(pid: string) {
    const [activeTier, setActiveTier] = useState<MemTier>("short_term");
    const activeScope: MemoryScope = activeTier === "short_term" ? "sprint" : "project";

    const [models, setModels] = useState<EmbeddingModelWithStatus[]>([]);
    const [records, setRecords] = useState<MemoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ sprint: 0, agent: 0, project: 0, activeModel: null as string | null, staleEmbeddings: 0 });
    const [reembed, setReembed] = useState<ReembedProgress | null>(null);
    const [embeddingMap, setEmbeddingMap] = useState<EmbeddingMapResult | null>(null);

    const [sprints, setSprints] = useState<SprintRecord[]>([]);
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
    const [selectedSprintId, setSelectedSprintId] = useState<string | undefined>(undefined);
    const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | undefined>(undefined);
    const sprintsLoaded = useRef(false);

    // Fetch sprints & agent presets on project change
    useEffect(() => {
        if (!pid) return;
        sprintsLoaded.current = false;
        Promise.all([
            fetchSprints(pid).then((res) => res.sprints).catch(() => [] as SprintRecord[]),
            fetchAgentPresets(pid).catch(() => [] as AgentPreset[]),
        ]).then(([sprintsData, presetsData]) => {
            const sorted = [...sprintsData].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
            setSprints(sorted);
            setAgentPresets(presetsData);
            if (sorted.length > 0 && !sprintsLoaded.current) {
                setSelectedSprintId(sorted[0].id);
            }
            sprintsLoaded.current = true;
        });
    }, [pid]);

    const loadData = useCallback(async () => {
        if (!pid) return;
        setLoading(true);
        try {
            const memoryParams: { projectId: string; scope: MemoryScope; sprintId?: string; agentPresetId?: string; limit: number } = {
                projectId: pid, scope: activeScope, limit: 200,
            };
            if (activeTier === "short_term" && selectedSprintId) {
                memoryParams.sprintId = selectedSprintId;
            }
            if (selectedAgentPresetId) {
                memoryParams.agentPresetId = selectedAgentPresetId;
            }

            const [memoriesData, modelsData, statsData, mapData] = await Promise.all([
                listMemories(memoryParams),
                listEmbeddingModels(),
                getMemoryStats(pid),
                getEmbeddingMap(
                    pid,
                    activeScope,
                    activeTier === "short_term" ? selectedSprintId : undefined,
                    selectedAgentPresetId,
                ).catch(() => null),
            ]);

            setRecords(memoriesData);
            setModels(modelsData);
            setStats(statsData);
            setEmbeddingMap(mapData);
        } catch { /* ignore */ }
        setLoading(false);
    }, [pid, activeScope, activeTier, selectedSprintId, selectedAgentPresetId]);

    // Re-load when filter changes
    useEffect(() => {
        loadData();
    }, [loadData]);

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

    const reembedStateRef = useRef({ active: reembed?.active, pid, loadData });
    useEffect(() => {
        reembedStateRef.current = { active: reembed?.active, pid, loadData };
    }, [reembed?.active, pid, loadData]);

    useEffect(() => {
        const interval = setInterval(async () => {
            const state = reembedStateRef.current;
            if (!state.active || !state.pid) return;
            try {
                const progress = await getReembedProgress(state.pid);
                setReembed(progress);
                if (!progress.active) {
                    state.loadData();
                }
            } catch { /* ignore */ }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleReembed = useCallback(async () => {
        if (!pid) return;
        try {
            await startReembed(pid);
            setReembed({ active: true, completed: 0, total: 0 });
            const progress = await getReembedProgress(pid);
            setReembed(progress);
            if (!progress.active) {
                loadData();
            }
        } catch { /* ignore */ }
    }, [pid, loadData]);

    const handleDeleteRecord = useCallback(async (id: string) => {
        try {
            await apiDeleteMemory(id);
        } catch { /* ignore */ }
    }, []);

    return {
        state: {
            loading,
            records,
            models,
            stats,
            reembed,
            embeddingMap,
            sprints,
            agentPresets,
            activeTier,
            activeScope,
            selectedSprintId,
            selectedAgentPresetId
        },
        actions: {
            setActiveTier,
            setSelectedSprintId,
            setSelectedAgentPresetId,
            loadData,
            handleReembed,
            handleDeleteRecord,
            setModels,
            setStats,
        }
    };
}
