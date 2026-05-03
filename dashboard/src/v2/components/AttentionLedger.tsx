import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { Bot, CheckCircle2, XCircle } from "lucide-preact";
import { renderMarkdown } from "../../lib/markdown.js";
import { formatTime } from "../../lib/time.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import { ATTENTION_OWNER_LABELS, ATTENTION_SEVERITY_TONE, ATTENTION_TYPE_LABELS, ATTENTION_STATUS_TONE, shortenRuntimeId } from "./live-session/ExecutionRuntimePanel.js";
import type { ExecutionDashboardSnapshot } from "../../types.js";

export const AttentionLedger: FunctionComponent = memo(() => {
    const {
        execution: snapshot,
        onClaimAttentionItem,
        onResolveAttentionItem,
        onDismissAttentionItem,
        pendingActionIds,
    } = useExecutionTimeline();

    if (!snapshot) return null;
    const workersByEndpointId = useMemo(() => {
        const overflow = snapshot.overflowAssignedWorkers || [];
        const pairs = [
            snapshot.primaryAssignedWorker,
            ...overflow,
        ].filter(Boolean).map((worker) => [worker!.workerEndpointId || "", worker!.workerDisplayName] as const);
        return new Map(pairs);
    }, [snapshot.overflowAssignedWorkers, snapshot.primaryAssignedWorker]);

    const listRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const reducedMotion = useReducedMotion();

    const { openCount, claimedCount } = useMemo(() => {
        const items = snapshot.attentionItems || [];
        return {
            openCount: items.filter((item) => item.status === "open").length,
            claimedCount: items.filter((item) => item.status === "claimed").length,
        };
    }, [snapshot.attentionItems]);

    const visibleAttentionItems = useMemo(() => {
        const items = snapshot.attentionItems || [];
        return items.slice(0, 8);
    }, [snapshot.attentionItems]);

    useLayoutEffect(() => {
        const items = snapshot.attentionItems || [];
        if (!listRef.current || reducedMotion) {
            prevCountRef.current = items.length;
            return;
        }

        const currentCount = items.length;
        if (currentCount > prevCountRef.current) {
            // New items were added, animate them
            const newElements = Array.from(listRef.current.children).filter(el => !el.hasAttribute('data-entered'));

            if (newElements.length > 0) {
                gsap.fromTo(newElements,
                    { opacity: 0, x: -10 },
                    { opacity: 1, x: 0, duration: 0.25, stagger: 0.04, ease: "power2.out" }
                );
                newElements.forEach(el => el.setAttribute('data-entered', 'true'));
            }
        }
        prevCountRef.current = currentCount;
    }, [snapshot.attentionItems, reducedMotion]);

    const canAutoClaim = Boolean(snapshot.primaryAssignedWorker || (snapshot.overflowAssignedWorkers && snapshot.overflowAssignedWorkers.length > 0));

    return (
        <div>
            <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-400 block">Attention Queue</span>
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                    <span className="rounded-full border border-status-amber/20 bg-status-amber/10 px-2 py-1 text-status-amber">
                        open {openCount}
                    </span>
                    <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-signal-500">
                        claimed {claimedCount}
                    </span>
                </div>
            </div>

            {(!snapshot.attentionItems || snapshot.attentionItems.length === 0) ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">
                    No active blockers are waiting in the project attention queue.
                </p>
            ) : (
                <div ref={listRef} className="space-y-2 max-h-80 overflow-y-auto dashboard-scrollbar pr-1">
                    {visibleAttentionItems.map((item) => {
                        const assignedWorkerLabel = item.assignedWorkerEndpointId
                            ? workersByEndpointId.get(item.assignedWorkerEndpointId) || item.assignedWorkerEndpointId
                            : item.ownerType === "worker"
                                ? "Unassigned"
                                : ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType;
                        const canClaim = (
                            Boolean(snapshot.projectId)
                            && item.ownerType === "worker"
                            && item.status === "open"
                            && (Boolean(item.assignedWorkerEndpointId) || canAutoClaim)
                        );
                        const claimActionId = `attention-claim:${item.id}`;
                        const resolveActionId = `attention-resolve:${item.id}`;
                        const dismissActionId = `attention-dismiss:${item.id}`;

                        return (
                            <div
                                key={item.id}
                                className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.015] dark:bg-white/[0.015] p-3"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                {item.title}
                                            </span>
                                            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                                ATTENTION_SEVERITY_TONE[item.severity] || ATTENTION_SEVERITY_TONE.medium
                                            }`}>
                                                {item.severity}
                                            </span>
                                            <span className="rounded-full border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                                {ATTENTION_TYPE_LABELS[item.attentionType] || item.attentionType.replace(/_/g, " ")}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
                                            <span className={ATTENTION_STATUS_TONE[item.status] || "text-slate-400"}>
                                                {item.status}
                                            </span>
                                            <span>·</span>
                                            <span>{ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType}</span>
                                            <span>·</span>
                                            <span>{assignedWorkerLabel}</span>
                                            {shortenRuntimeId(item.taskId) && (
                                                <>
                                                    <span>·</span>
                                                    <span>task {shortenRuntimeId(item.taskId)}</span>
                                                </>
                                            )}
                                            {shortenRuntimeId(item.dispatchId) && (
                                                <>
                                                    <span>·</span>
                                                    <span>dispatch {shortenRuntimeId(item.dispatchId)}</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-right text-[10px] font-mono text-slate-400">
                                        {formatTime(item.updatedAt)}
                                    </div>
                                </div>

                                <div
                                    className="mt-3 prose prose-sm max-w-none text-[11px] leading-relaxed text-slate-500 dark:text-slate-400
                                               prose-p:my-0 prose-code:text-signal-600 dark:prose-code:text-signal-400
                                               prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md line-clamp-3"
                                    dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summaryMarkdown || "No summary provided.") }}
                                />

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {canClaim && snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onClaimAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(claimActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500 transition-colors hover:bg-signal-500/15 disabled:opacity-50"
                                        >
                                            <Bot className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(claimActionId) ? "Claiming" : "Claim"}
                                        </button>
                                    )}
                                    {snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onResolveAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(resolveActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-status-green/20 bg-status-green/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-status-green transition-colors hover:bg-status-green/15 disabled:opacity-50"
                                        >
                                            <CheckCircle2 className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(resolveActionId) ? "Resolving" : "Resolve"}
                                        </button>
                                    )}
                                    {snapshot.projectId && (
                                        <button
                                            type="button"
                                            onClick={() => onDismissAttentionItem(snapshot.projectId!, item.id)}
                                            disabled={pendingActionIds.has(dismissActionId)}
                                            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.05] dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.05] disabled:opacity-50"
                                        >
                                            <XCircle className="w-3 h-3" strokeWidth={2} />
                                            {pendingActionIds.has(dismissActionId) ? "Dismissing" : "Dismiss"}
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
