import { useState, useCallback } from "preact/hooks";
import {
    cancelSprintRun,
    cancelTaskDispatch,
    claimAttentionItem,
    forceCancelSprintRun,
    forceCancelTaskDispatch,
    orchestrateSprint,
    pauseSprintRun,
    resolveAttentionItem,
    rerunTask,
    retryTaskDispatch,
} from "../../lib/api/dashboard-api.js";

export function useLiveSessionActions(
    refreshRuntimeStatus: () => Promise<void>,
    refreshGitStatus: () => Promise<void>
) {
    const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set());
    const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());

    const handleRerun = useCallback(async (taskId: string) => {
        setRerunningIds(prev => new Set(prev).add(taskId));
        try {
            await rerunTask(taskId);
            await refreshRuntimeStatus();
            await refreshGitStatus();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to rerun task.";
            window.alert(message);
        } finally {
            setRerunningIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
        }
    }, [refreshRuntimeStatus, refreshGitStatus]);

    const runControlAction = useCallback(async (actionId: string, operation: () => Promise<void>) => {
        setPendingActionIds(prev => new Set(prev).add(actionId));
        try {
            await operation();
            await new Promise((resolve) => setTimeout(resolve, 150));
            await refreshRuntimeStatus();
            await refreshGitStatus();
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to execute runtime control.";
            window.alert(message);
        } finally {
            setPendingActionIds(prev => { const next = new Set(prev); next.delete(actionId); return next; });
        }
    }, [refreshRuntimeStatus, refreshGitStatus]);

    const handleOrchestrateSprint = useCallback(async (projectId: string, sprintId: string) => {
        await runControlAction(`sprint-start:${sprintId}`, async () => {
            await orchestrateSprint(projectId, sprintId);
        });
    }, [runControlAction]);

    const handlePauseSprintRun = useCallback(async (sprintRunId: string) => {
        await runControlAction(`sprint-pause:${sprintRunId}`, async () => {
            await pauseSprintRun(sprintRunId);
        });
    }, [runControlAction]);

    const handleCancelSprintRun = useCallback(async (sprintRunId: string) => {
        await runControlAction(`sprint-cancel:${sprintRunId}`, async () => {
            await cancelSprintRun(sprintRunId);
        });
    }, [runControlAction]);

    const handleCancelTaskDispatch = useCallback(async (dispatchId: string) => {
        await runControlAction(`dispatch-cancel:${dispatchId}`, async () => {
            await cancelTaskDispatch(dispatchId);
        });
    }, [runControlAction]);

    const handleForceCancelSprintRun = useCallback(async (sprintRunId: string) => {
        await runControlAction(`sprint-force-cancel:${sprintRunId}`, async () => {
            await forceCancelSprintRun(sprintRunId);
        });
    }, [runControlAction]);

    const handleForceCancelTaskDispatch = useCallback(async (dispatchId: string) => {
        await runControlAction(`dispatch-force-cancel:${dispatchId}`, async () => {
            await forceCancelTaskDispatch(dispatchId);
        });
    }, [runControlAction]);

    const handleRetryTaskDispatch = useCallback(async (dispatchId: string) => {
        await runControlAction(`dispatch-retry:${dispatchId}`, async () => {
            await retryTaskDispatch(dispatchId);
        });
    }, [runControlAction]);

    const handleClaimAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = window.confirm("Claim this attention item for the assigned project worker?");
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-claim:${attentionItemId}`, async () => {
            await claimAttentionItem(projectId, attentionItemId, {
                claimReason: "dashboard_claimed",
            });
        });
    }, [runControlAction]);

    const handleResolveAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = window.confirm("Resolve this attention item and remove it from the active queue?");
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-resolve:${attentionItemId}`, async () => {
            await resolveAttentionItem(projectId, attentionItemId, {
                status: "resolved",
                reason: "dashboard_resolved",
            });
        });
    }, [runControlAction]);

    const handleDismissAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = window.confirm("Dismiss this attention item from the active queue?");
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-dismiss:${attentionItemId}`, async () => {
            await resolveAttentionItem(projectId, attentionItemId, {
                status: "dismissed",
                reason: "dashboard_dismissed",
            });
        });
    }, [runControlAction]);

    return {
        rerunningIds,
        pendingActionIds,
        handleRerun,
        runControlAction,
        handleOrchestrateSprint,
        handlePauseSprintRun,
        handleCancelSprintRun,
        handleForceCancelSprintRun,
        handleCancelTaskDispatch,
        handleForceCancelTaskDispatch,
        handleRetryTaskDispatch,
        handleClaimAttentionItem,
        handleResolveAttentionItem,
        handleDismissAttentionItem,
    };
}
