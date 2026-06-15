import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { listMemories, listEmbeddingModels, getMemoryStats, getEmbeddingMap, type EmbeddingModelWithStatus, type MemoryStats, type EmbeddingMapResult } from "../lib/memory-api.js";
import type { MemoryRecord, MemoryScope } from "../memory-types.js";
import { prepareMemoryGraph, type GraphMetadata } from "../lib/memory-graph.js";
import { useActionFeedback } from "./use-action-feedback.js";
import { createMemory, deleteMemory, type CreateMemoryInput } from "../lib/memory-api.js";
import type { ActionFeedbackState } from "./use-action-feedback.js";

import { memoryMutationsSignal } from "../components/memory/memoryState.js";

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

    const { feedback, setWarning, setSuccess, setError, clearFeedback, setPending } = useActionFeedback(5000);
    const removeTimers = useRef<Record<string, number>>({});

    const addMemory = useCallback(async (input: CreateMemoryInput, pid: string) => {
        const tempId = `temp-${Date.now()}`;
        const tempRecord: MemoryRecord = {
            id: tempId,
            projectId: pid,
            scope: input.scope,
            content: input.content,
            category: input.category,
            strength: input.strength || 0.7,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            sprintId: input.sprintId || null,
            agentPresetId: input.agentPresetId || null,
            source: 'user' as any,
            embeddingModel: null,
            embeddingDimension: 0,
            embeddingBlob: null,
            promotedFromId: null,
            promotionReason: null,
        };

        setPending("Adding memory...");
        setRecords(prev => {
            const next = [tempRecord, ...prev];
            setMemoryCount(next.length);
            const graph = prepareMemoryGraph(next, graphData?.map || null);
            setGraphData({ graph, map: graphData?.map || null });
            return next;
        });

        try {
            const created = await createMemory(pid, input);
            setRecords(prev => {
                const next = prev.map(r => r.id === tempId ? created : r);
                const graph = prepareMemoryGraph(next, graphData?.map || null);
                setGraphData({ graph, map: graphData?.map || null });
                return next;
            });
            setSuccess("Memory added successfully");
        } catch (e: any) {
            setRecords(prev => {
                const next = prev.filter(r => r.id !== tempId);
                setMemoryCount(next.length);
                const graph = prepareMemoryGraph(next, graphData?.map || null);
                setGraphData({ graph, map: graphData?.map || null });
                return next;
            });
            setError(e.message || "Failed to add memory");
        }
    }, [graphData?.map, setSuccess, setError]);

    const removeMemory = useCallback((id: string) => {
        const recordToRestore = records.find(r => r.id === id);
        if (!recordToRestore) return;

        setRecords(prev => {
            const next = prev.filter(r => r.id !== id);
            setMemoryCount(next.length);
            const graph = prepareMemoryGraph(next, graphData?.map || null);
            setGraphData({ graph, map: graphData?.map || null });
            return next;
        });

        let executed = false;

        const executeDelete = async () => {
            if (executed) return;
            executed = true;
            try {
                await deleteMemory(id);
            } catch (e: any) {
                setRecords(prev => {
                    const next = [...prev];
                    const restoreIdx = records.findIndex(r => r.id === id);
                    if (restoreIdx >= 0) {
                        next.splice(restoreIdx, 0, recordToRestore);
                    } else {
                        next.push(recordToRestore);
                    }
                    setMemoryCount(next.length);
                    const graph = prepareMemoryGraph(next, graphData?.map || null);
                    setGraphData({ graph, map: graphData?.map || null });
                    return next;
                });
                setError(e.message || "Failed to delete memory");
            }
        };

        const undo = async () => {
            if (removeTimers.current[id]) {
                window.clearTimeout(removeTimers.current[id]);
                delete removeTimers.current[id];
            }
            if (!executed) {
                executed = true;
                setRecords(prev => {
                    const next = [...prev];
                    const restoreIdx = records.findIndex(r => r.id === id);
                    if (restoreIdx >= 0) {
                        next.splice(restoreIdx, 0, recordToRestore);
                    } else {
                        next.push(recordToRestore);
                    }
                    setMemoryCount(next.length);
                    const graph = prepareMemoryGraph(next, graphData?.map || null);
                    setGraphData({ graph, map: graphData?.map || null });
                    return next;
                });
                clearFeedback();
            } else {
                // If already finalized (executed), we must recreate it
                const input: CreateMemoryInput = {
                    scope: recordToRestore.scope,
                    content: recordToRestore.content,
                    category: recordToRestore.category,
                    sprintId: recordToRestore.sprintId || undefined,
                    agentPresetId: recordToRestore.agentPresetId || undefined,
                    strength: recordToRestore.strength,
                };
                addMemory(input, recordToRestore.projectId);
                clearFeedback();
            }
        };

        setWarning("Memory removed", { retryAction: undo, retryLabel: "Undo" });
        removeTimers.current[id] = window.setTimeout(() => {
            executeDelete();
            delete removeTimers.current[id];
        }, 5000);

    }, [records, graphData?.map, setWarning, setError, clearFeedback, addMemory]);

    useEffect(() => {
        memoryMutationsSignal.value = {
            addMemory,
            removeMemory,
            feedback,
            clearFeedback
        };
    }, [addMemory, removeMemory, feedback, clearFeedback]);

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
