import { useRef, useState, useCallback } from "preact/hooks";
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
import type { RerunTaskOptions } from "../../lib/api/dashboard-api.js";
import type { ConfirmDialogOptions } from "./use-confirm-dialog.js";
import { useToast } from "../components/feedback/ToastProvider.js";

export function useLiveSessionActions(
    refreshRuntimeStatus: () => Promise<void>,
    refreshGitStatus: () => Promise<void>,
    requestConfirm: (opts: ConfirmDialogOptions) => Promise<boolean>,
) {
    const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set());
    const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());
    const rerunningIdsRef = useRef(rerunningIds);
    const pendingActionIdsRef = useRef(pendingActionIds);
    const { addToast } = useToast();

    const handleRerun = useCallback(async (taskId: string, options?: RerunTaskOptions) => {
        if (rerunningIdsRef.current.has(taskId)) {
            return;
        }
        const nextRerunningIds = new Set(rerunningIdsRef.current).add(taskId);
        rerunningIdsRef.current = nextRerunningIds;
        setRerunningIds(nextRerunningIds);
        try {
            await rerunTask(taskId, options);
            await refreshRuntimeStatus();
            await refreshGitStatus();
            addToast({
                type: "success",
                message: "Task rerun dispatched successfully.",
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to rerun task.";
            addToast({
                type: "error",
                message,
                action: {
                    label: "Retry Rerun",
                    onClick: () => handleRerun(taskId, options),
                },
                autoDismissMs: 0,
            });
        } finally {
            const next = new Set(rerunningIdsRef.current);
            next.delete(taskId);
            rerunningIdsRef.current = next;
            setRerunningIds(next);
        }
    }, [refreshRuntimeStatus, refreshGitStatus, addToast]);

    const runControlAction = useCallback(async (actionId: string, operation: () => Promise<void>) => {
        if (pendingActionIdsRef.current.has(actionId)) {
            return;
        }
        const nextPendingActionIds = new Set(pendingActionIdsRef.current).add(actionId);
        pendingActionIdsRef.current = nextPendingActionIds;
        setPendingActionIds(nextPendingActionIds);
        try {
            await operation();
            await new Promise((resolve) => setTimeout(resolve, 150));
            await refreshRuntimeStatus();
            await refreshGitStatus();
            addToast({
                type: "success",
                message: "Action executed successfully.",
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to execute runtime control.";
            addToast({
                type: "error",
                message,
                action: {
                    label: "Retry",
                    onClick: () => runControlAction(actionId, operation),
                },
                autoDismissMs: 0,
            });
        } finally {
            const next = new Set(pendingActionIdsRef.current);
            next.delete(actionId);
            pendingActionIdsRef.current = next;
            setPendingActionIds(next);
        }
    }, [refreshRuntimeStatus, refreshGitStatus, addToast]);

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

    const handleCancelSprintRun = useCallback(async (sprintRunId: string, targetLabel = sprintRunId) => {
        if (pendingActionIdsRef.current.has(`sprint-cancel:${sprintRunId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: "Cancel Sprint Run",
            body: `Request cancellation for sprint run "${targetLabel}"? Running work will be asked to stop and cached runtime rows will remain visible while the request is confirmed.`,
            confirmLabel: "Cancel Run",
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`sprint-cancel:${sprintRunId}`, async () => {
            await cancelSprintRun(sprintRunId);
        });
    }, [requestConfirm, runControlAction]);

    const handleCancelTaskDispatch = useCallback(async (dispatchId: string, targetLabel = dispatchId) => {
        if (pendingActionIdsRef.current.has(`dispatch-cancel:${dispatchId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: "Cancel Dispatch",
            body: `Request cancellation for dispatch "${targetLabel}"? The runtime will keep the current dispatch row visible while the stop request is confirmed.`,
            confirmLabel: "Cancel Dispatch",
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`dispatch-cancel:${dispatchId}`, async () => {
            await cancelTaskDispatch(dispatchId);
        });
    }, [requestConfirm, runControlAction]);

    const handleForceCancelSprintRun = useCallback(async (sprintRunId: string, targetLabel = sprintRunId) => {
        if (pendingActionIdsRef.current.has(`sprint-force-cancel:${sprintRunId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: "Force Cancel Sprint Run",
            body: `Force cancel sprint run "${targetLabel}" now? Use this only when the normal stop request is already pending or stalled.`,
            confirmLabel: "Force Cancel Run",
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`sprint-force-cancel:${sprintRunId}`, async () => {
            await forceCancelSprintRun(sprintRunId);
        });
    }, [requestConfirm, runControlAction]);

    const handleForceCancelTaskDispatch = useCallback(async (dispatchId: string, targetLabel = dispatchId) => {
        if (pendingActionIdsRef.current.has(`dispatch-force-cancel:${dispatchId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: "Force Cancel Dispatch",
            body: `Force cancel dispatch "${targetLabel}" now? Use this only when the normal stop request is already pending or stalled.`,
            confirmLabel: "Force Cancel Dispatch",
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`dispatch-force-cancel:${dispatchId}`, async () => {
            await forceCancelTaskDispatch(dispatchId);
        });
    }, [requestConfirm, runControlAction]);

    const handleRetryTaskDispatch = useCallback(async (dispatchId: string) => {
        await runControlAction(`dispatch-retry:${dispatchId}`, async () => {
            await retryTaskDispatch(dispatchId);
        });
    }, [runControlAction]);

    const handleClaimAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: "Claim Attention Item",
            body: "Claim this attention item for the assigned project worker?",
            confirmLabel: "Claim",
            tone: "default",
        });
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-claim:${attentionItemId}`, async () => {
            await claimAttentionItem(projectId, attentionItemId, {
                claimReason: "dashboard_claimed",
            });
        });
    }, [runControlAction, requestConfirm]);

    const handleResolveAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: "Resolve Attention Item",
            body: "Resolve this attention item and remove it from the active queue?",
            confirmLabel: "Resolve",
            tone: "success",
        });
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-resolve:${attentionItemId}`, async () => {
            await resolveAttentionItem(projectId, attentionItemId, {
                status: "resolved",
                reason: "dashboard_resolved",
            });
        });
    }, [runControlAction, requestConfirm]);

    const handleDismissAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: "Dismiss Attention Item",
            body: "Dismiss this attention item from the active queue?",
            confirmLabel: "Dismiss",
            tone: "neutral",
        });
        if (!confirmed) {
            return;
        }

        await runControlAction(`attention-dismiss:${attentionItemId}`, async () => {
            await resolveAttentionItem(projectId, attentionItemId, {
                status: "dismissed",
                reason: "dashboard_dismissed",
            });
        });
    }, [runControlAction, requestConfirm]);

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
