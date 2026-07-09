import { useState, useCallback, useEffect, useRef } from "preact/hooks";
import { listMemories, listEmbeddingModels, getMemoryStats, getEmbeddingMap, type EmbeddingModelWithStatus, type MemoryStats, type EmbeddingMapResult } from "../lib/memory-api.js";
import type { MemoryRecord, MemoryScope } from "../memory-types.js";
import { prepareMemoryGraph, type GraphMetadata } from "../lib/memory-graph.js";
import { useActionFeedback } from "./use-action-feedback.js";
import { createMemory, deleteMemory, deleteMemories, type CreateMemoryInput, type MemoryDeleteResult } from "../lib/memory-api.js";

import { clearSelectedMemoryIds, memoryMutationsSignal, setSelectedMemoryIds } from "../components/memory/memoryState.js";

export function buildMemoryDataContextKey(
    activeScope: MemoryScope,
    activeTier: string,
    selectedSprintId?: string,
    selectedAgentPresetId?: string,
): string {
    return JSON.stringify({
        scope: activeScope,
        tier: activeTier,
        sprintId: selectedSprintId ?? null,
        agentPresetId: selectedAgentPresetId ?? null,
    });
}

export function useMemoryPageData(
    pid: string,
    activeScope: MemoryScope,
    activeTier: string,
    selectedSprintId?: string,
    selectedAgentPresetId?: string,
    enabled = true
) {
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);
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
    const [graphDataContextKey, setGraphDataContextKey] = useState<string | null>(null);
    const requestedContextKey = buildMemoryDataContextKey(activeScope, activeTier, selectedSprintId, selectedAgentPresetId);

    const { feedback, setWarning, setSuccess, setError, clearFeedback, clearError, setPending } = useActionFeedback(5000);
    const removeTimers = useRef<Record<string, number>>({});
    const latestLoadRequestId = useRef(0);

    const syncRecordsAndGraph = useCallback((next: MemoryRecord[]) => {
        setRecords(next);
        setMemoryCount(next.length);
        const graph = prepareMemoryGraph(next, graphData?.map || null);
        setGraphData({ graph, map: graphData?.map || null });
    }, [graphData?.map]);

    const updateRecordsAndGraph = useCallback((updater: (current: MemoryRecord[]) => MemoryRecord[]) => {
        setRecords((current) => {
            const next = updater(current);
            setMemoryCount(next.length);
            const graph = prepareMemoryGraph(next, graphData?.map || null);
            setGraphData({ graph, map: graphData?.map || null });
            return next;
        });
    }, [graphData?.map]);

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
        updateRecordsAndGraph((current) => [tempRecord, ...current]);

        try {
            const created = await createMemory(pid, input);
            updateRecordsAndGraph((current) => current.map(r => r.id === tempId ? created : r));
            setSuccess("Memory added successfully");
        } catch (e: any) {
            updateRecordsAndGraph((current) => current.filter(r => r.id !== tempId));
            setError(e.message || "Failed to add memory");
        }
    }, [updateRecordsAndGraph, setSuccess, setError]);

    const removeMemory = useCallback((id: string) => {
        const recordToRestore = records.find(r => r.id === id);
        if (!recordToRestore) return;

        updateRecordsAndGraph((current) => current.filter(r => r.id !== id));

        let executed = false;

        const executeDelete = async () => {
            if (executed) return;
            executed = true;
            try {
                await deleteMemory(id);
            } catch (e: any) {
                updateRecordsAndGraph((current) => {
                    const next = [...current];
                    const restoreIdx = records.findIndex(r => r.id === id);
                    if (restoreIdx >= 0) {
                        next.splice(restoreIdx, 0, recordToRestore);
                    } else {
                        next.push(recordToRestore);
                    }
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
                updateRecordsAndGraph((current) => {
                    const next = [...current];
                    const restoreIdx = current.findIndex(r => r.id === id);
                    if (restoreIdx >= 0) {
                        next.splice(restoreIdx, 0, recordToRestore);
                    } else {
                        next.push(recordToRestore);
                    }
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

    }, [records, updateRecordsAndGraph, setWarning, setError, clearFeedback, addMemory]);

    const removeMemories = useCallback(async (ids: string[]) => {
        const uniqueIds = Array.from(new Set(ids));
        if (uniqueIds.length === 0) {
            return [] as MemoryDeleteResult[];
        }

        uniqueIds.forEach((memoryId) => {
            if (removeTimers.current[memoryId]) {
                window.clearTimeout(removeTimers.current[memoryId]);
                delete removeTimers.current[memoryId];
            }
        });

        const snapshot = records;
        const selectedRecords = snapshot.filter((record) => uniqueIds.includes(record.id));
        if (selectedRecords.length === 0) {
            clearSelectedMemoryIds();
            return [] as MemoryDeleteResult[];
        }

        setPending(`Deleting ${selectedRecords.length} ${selectedRecords.length === 1 ? "memory" : "memories"}...`);
        const optimistic = snapshot.filter((record) => !uniqueIds.includes(record.id));
        updateRecordsAndGraph((current) => current.filter((record) => !uniqueIds.includes(record.id)));
        clearSelectedMemoryIds();

        const results = await deleteMemories(uniqueIds);
        const failedIds = results.filter((result) => !result.ok).map((result) => result.memoryId);

        if (failedIds.length > 0) {
            const failedSet = new Set(failedIds);
            const restored = snapshot.filter((record) => !uniqueIds.includes(record.id) || failedSet.has(record.id));
            syncRecordsAndGraph(restored);
            setSelectedMemoryIds(failedIds);

            const failureMessages = results
                .filter((result) => !result.ok)
                .map((result) => result.error)
                .filter((error): error is string => Boolean(error));
            const failureLabel = failedIds.length === 1 ? "memory" : "memories";
            const deletedCount = selectedRecords.length - failedIds.length;
            setError(`Deleted ${deletedCount} ${deletedCount === 1 ? "memory" : "memories"}, but ${failedIds.length} ${failureLabel} failed to delete.${failureMessages.length > 0 ? ` ${failureMessages[0]}` : ""}`, {
                retryAction: () => {
                    void removeMemories(failedIds);
                },
                retryLabel: "Retry delete",
            });
        } else {
            setSuccess(`Deleted ${selectedRecords.length} ${selectedRecords.length === 1 ? "memory" : "memories"}`);
        }

        return results;
    }, [records, syncRecordsAndGraph, updateRecordsAndGraph, setPending, setError, setSuccess]);

    useEffect(() => {
        memoryMutationsSignal.value = {
            addMemory,
            removeMemory,
            removeMemories,
            feedback,
            clearFeedback,
            clearError
        };
    }, [addMemory, removeMemory, removeMemories, feedback, clearFeedback, clearError]);

    const loadData = useCallback(async () => {
        if (!pid || !enabled) return;
        const requestId = latestLoadRequestId.current + 1;
        latestLoadRequestId.current = requestId;
        setLoading(true);
        setLoadError(null);
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

            if (requestId !== latestLoadRequestId.current) {
                return;
            }

            setRecords(memoriesData);
            setInitialModels(modelsData);
            setInitialStats(statsData);
            setMemoryCount(memoriesData.length);

            const graph = prepareMemoryGraph(memoriesData, mapData);
            setGraphData({ graph, map: mapData });
            setGraphDataContextKey(requestedContextKey);
        } catch (error) {
            if (requestId !== latestLoadRequestId.current) {
                return;
            }
            setLoadError(error instanceof Error ? error.message : "Failed to load memories");
        } finally {
            if (requestId === latestLoadRequestId.current) {
                setLoading(false);
            }
        }
    }, [pid, activeScope, activeTier, selectedSprintId, selectedAgentPresetId, enabled, requestedContextKey]);

    useEffect(() => { loadData(); }, [loadData]);

    return {
        loading,
        loadError,
        records,
        memoryCount,
        setMemoryCount,
        initialModels,
        initialStats,
        graphData,
        graphDataContextKey,
        requestedContextKey,
        loadData
    };
}
