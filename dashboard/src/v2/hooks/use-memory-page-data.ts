import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { listMemories, listEmbeddingModels, getMemoryStats, getEmbeddingMap, type EmbeddingModelWithStatus, type MemoryStats, type EmbeddingMapResult } from "../lib/memory-api.js";
import type { MemoryRecord, MemoryScope } from "../memory-types.js";
import { prepareMemoryGraph, type GraphMetadata } from "../lib/memory-graph.js";

export function useMemoryPageData(
    pid: string,
    activeScope: MemoryScope,
    activeTier: string,
    selectedSprintId?: string,
    selectedAgentPresetId?: string,
    enabled = true
) {
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState<MemoryRecord[]>([]);
    const [memoryCount, setMemoryCount] = useState(0);
    const [initialModels, setInitialModels] = useState<EmbeddingModelWithStatus[]>([]);
    const [initialStats, setInitialStats] = useState<MemoryStats>({
        sprint: 0,
        agent: 0,
        project: 0,
        activeModel: null,
        staleEmbeddings: 0
    });
    const [graphData, setGraphData] = useState<{ graph: GraphMetadata; map: EmbeddingMapResult | null } | null>(null);

    const loadData = useCallback(async () => {
        if (!pid || !enabled) return;
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
            setInitialModels(modelsData);
            setInitialStats(statsData);
            setMemoryCount(memoriesData.length);

            const graph = prepareMemoryGraph(memoriesData, mapData);
            setGraphData({ graph, map: mapData });
        } catch { /* ignore */ }
        setLoading(false);
    }, [pid, activeScope, activeTier, selectedSprintId, selectedAgentPresetId, enabled]);

    useEffect(() => { loadData(); }, [loadData]);

    return {
        loading,
        records,
        memoryCount,
        setMemoryCount,
        initialModels,
        initialStats,
        graphData,
        loadData
    };
}
