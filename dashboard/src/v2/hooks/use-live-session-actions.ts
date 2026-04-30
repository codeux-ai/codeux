import { useState, useCallback } from "preact/hooks";
import { InteractionMessages, getErrorMessage } from "../lib/copy/interaction-messages.js";
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

import type { ActionFeedbackOptions } from "./use-action-feedback.js";

export function useLiveSessionActions(
    refreshRuntimeStatus: () => Promise<void>,
    refreshGitStatus: () => Promise<void>,
    requestConfirm: (opts: ConfirmDialogOptions) => Promise<boolean>,
    feedbackHandlers: {
        setPending: (msg: string, opts?: ActionFeedbackOptions) => void;
        setSuccess: (msg: string, opts?: ActionFeedbackOptions) => void;
        setError: (msg: string, opts?: ActionFeedbackOptions) => void;
    },
) {
    const [rerunningIds, setRerunningIds] = useState<Set<string>>(new Set());
    const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(new Set());

    const handleRerun = useCallback(async (taskId: string, options?: RerunTaskOptions) => {
        setRerunningIds(prev => new Set(prev).add(taskId));
        feedbackHandlers.setPending(InteractionMessages.rerunPending);
        try {
            await rerunTask(taskId, options);
            await refreshRuntimeStatus();
            await refreshGitStatus();
            feedbackHandlers.setSuccess(InteractionMessages.rerunSuccess);
        } catch (err) {
            feedbackHandlers.setError(InteractionMessages.rerunError(getErrorMessage(err)), {
                retryAction: () => handleRerun(taskId, options),
                retryLabel: "Retry Rerun",
                autoDismiss: false
            });
        } finally {
            setRerunningIds(prev => { const next = new Set(prev); next.delete(taskId); return next; });
        }
    }, [refreshRuntimeStatus, refreshGitStatus, feedbackHandlers]);

    const runControlAction = useCallback(async (actionId: string, operation: () => Promise<void>) => {
        setPendingActionIds(prev => new Set(prev).add(actionId));
        feedbackHandlers.setPending(InteractionMessages.actionPending);
        try {
            await operation();
            await new Promise((resolve) => setTimeout(resolve, 150));
            await refreshRuntimeStatus();
            await refreshGitStatus();
            feedbackHandlers.setSuccess(InteractionMessages.actionSuccess);
        } catch (err) {
            feedbackHandlers.setError(InteractionMessages.actionError(getErrorMessage(err)), {
                retryAction: () => runControlAction(actionId, operation),
                retryLabel: "Retry",
                autoDismiss: false
            });
        } finally {
            setPendingActionIds(prev => { const next = new Set(prev); next.delete(actionId); return next; });
        }
    }, [refreshRuntimeStatus, refreshGitStatus, feedbackHandlers]);

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
        const confirmed = await requestConfirm({
            title: "Claim Attention Item",
            body: "Claim this attention item for the assigned project worker?",
            confirmLabel: "Claim",
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
