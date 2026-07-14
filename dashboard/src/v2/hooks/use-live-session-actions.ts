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
import { useLiveI18n } from "../i18n/messages/live.js";

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
    const { t } = useLiveI18n();

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
                message: t("rerunSuccess"),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : t("rerunFailed");
            addToast({
                type: "error",
                message,
                action: {
                    label: t("retryRerun"),
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
    }, [refreshRuntimeStatus, refreshGitStatus, addToast, t]);

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
                message: t("actionSuccess"),
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : t("actionFailed");
            addToast({
                type: "error",
                message,
                action: {
                    label: t("retry"),
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
    }, [refreshRuntimeStatus, refreshGitStatus, addToast, t]);

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
            title: t("cancelSprintRun"),
            body: t("cancelSprintConfirm", { target: targetLabel }),
            confirmLabel: t("cancelRun"),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`sprint-cancel:${sprintRunId}`, async () => {
            await cancelSprintRun(sprintRunId);
        });
    }, [requestConfirm, runControlAction, t]);

    const handleCancelTaskDispatch = useCallback(async (dispatchId: string, targetLabel = dispatchId) => {
        if (pendingActionIdsRef.current.has(`dispatch-cancel:${dispatchId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: t("cancelDispatch"),
            body: t("cancelDispatchConfirm", { target: targetLabel }),
            confirmLabel: t("cancelDispatch"),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`dispatch-cancel:${dispatchId}`, async () => {
            await cancelTaskDispatch(dispatchId);
        });
    }, [requestConfirm, runControlAction, t]);

    const handleForceCancelSprintRun = useCallback(async (sprintRunId: string, targetLabel = sprintRunId) => {
        if (pendingActionIdsRef.current.has(`sprint-force-cancel:${sprintRunId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: t("forceCancelSprintRun"),
            body: t("forceCancelSprintConfirm", { target: targetLabel }),
            confirmLabel: t("forceCancelRun"),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`sprint-force-cancel:${sprintRunId}`, async () => {
            await forceCancelSprintRun(sprintRunId);
        });
    }, [requestConfirm, runControlAction, t]);

    const handleForceCancelTaskDispatch = useCallback(async (dispatchId: string, targetLabel = dispatchId) => {
        if (pendingActionIdsRef.current.has(`dispatch-force-cancel:${dispatchId}`)) {
            return;
        }
        const confirmed = await requestConfirm({
            title: t("forceCancelDispatch"),
            body: t("forceCancelDispatchConfirm", { target: targetLabel }),
            confirmLabel: t("forceCancelDispatch"),
            destructive: true,
        });
        if (!confirmed) {
            return;
        }
        await runControlAction(`dispatch-force-cancel:${dispatchId}`, async () => {
            await forceCancelTaskDispatch(dispatchId);
        });
    }, [requestConfirm, runControlAction, t]);

    const handleRetryTaskDispatch = useCallback(async (dispatchId: string) => {
        await runControlAction(`dispatch-retry:${dispatchId}`, async () => {
            await retryTaskDispatch(dispatchId);
        });
    }, [runControlAction]);

    const handleClaimAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: t("claimAttentionItem"),
            body: t("claimAttentionConfirm"),
            confirmLabel: t("claim"),
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
    }, [runControlAction, requestConfirm, t]);

    const handleResolveAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: t("resolveAttentionItem"),
            body: t("resolveAttentionConfirm"),
            confirmLabel: t("resolve"),
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
    }, [runControlAction, requestConfirm, t]);

    const handleDismissAttentionItem = useCallback(async (projectId: string, attentionItemId: string) => {
        const confirmed = await requestConfirm({
            title: t("dismissAttentionItem"),
            body: t("dismissAttentionConfirm"),
            confirmLabel: t("dismiss"),
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
    }, [runControlAction, requestConfirm, t]);

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
