import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { Bot, CheckCircle2, XCircle, ChevronDown, ChevronUp } from "lucide-preact";
import { renderMarkdown } from "../../lib/markdown.js";
import { formatTime } from "../../lib/time.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import { ATTENTION_OWNER_LABELS, ATTENTION_SEVERITY_TONE, ATTENTION_TYPE_LABELS, ATTENTION_STATUS_TONE, shortenRuntimeId } from "./live-session/ExecutionRuntimePanel.js";

gsap.registerPlugin(Flip);

export const AttentionLedger: FunctionComponent = memo(() => {
    const {
        execution: snapshot,
        onClaimAttentionItem,
        onResolveAttentionItem,
        onDismissAttentionItem,
        pendingActionIds,
    } = useExecutionTimeline();

    const [expandedId, setExpandedId] = useState<string | null>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const lastFlipState = useRef<any>(null);
    const reducedMotion = useReducedMotion();

    if (!snapshot) return null;

    const workersByEndpointId = useMemo(() => {
        const pairs = [
            snapshot.primaryAssignedWorker,
            ...snapshot.overflowAssignedWorkers,
        ].filter(Boolean).map((worker) => [worker!.workerEndpointId || "", worker!.workerDisplayName] as const);
        return new Map(pairs);
    }, [snapshot.overflowAssignedWorkers, snapshot.primaryAssignedWorker]);

    // Snapshot items for FLIP comparison
    const itemsToRender = useMemo(() => {
        if (listRef.current && !reducedMotion) {
            lastFlipState.current = Flip.getState(listRef.current.children);
        }
        return snapshot.attentionItems.slice(0, 8);
    }, [snapshot.attentionItems, reducedMotion, expandedId]);

    useLayoutEffect(() => {
        if (!listRef.current || reducedMotion) return;

        if (lastFlipState.current) {
            Flip.from(lastFlipState.current, {
                duration: 0.4,
                ease: "power2.inOut",
                absolute: false, // Keep layout natural for height:auto
                onEnter: elements => gsap.fromTo(elements, { opacity: 0, x: -20 }, { opacity: 1, x: 0, duration: 0.3 }),
                onLeave: elements => gsap.to(elements, { opacity: 0, scale: 0.9, duration: 0.2 }),
                onComplete: () => {
                    lastFlipState.current = null;
                }
            });
        }
    }, [itemsToRender, reducedMotion]);

    const openCount = snapshot.attentionItems.filter((item) => item.status === "open").length;
    const claimedCount = snapshot.attentionItems.filter((item) => item.status === "claimed").length;
    const canAutoClaim = Boolean(snapshot.primaryAssignedWorker || snapshot.overflowAssignedWorkers.length > 0);

    const toggleExpand = (id: string) => {
        if (listRef.current && !reducedMotion) {
            lastFlipState.current = Flip.getState(listRef.current.children);
        }
        setExpandedId(prev => prev === id ? null : id);
    };

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

            {snapshot.attentionItems.length === 0 ? (
                <p className="text-[11px] text-slate-400 dark:text-slate-600 font-mono">
                    No active blockers are waiting in the project attention queue.
                </p>
            ) : (
                <div ref={listRef} className="space-y-2 max-h-80 overflow-y-auto dashboard-scrollbar pr-1">
                    {itemsToRender.map((item) => {
                        const isExpanded = expandedId === item.id;
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
                                data-flip-id={item.id}
                                className="rounded-xl border border-black/[0.04] dark:border-white/[0.04] bg-black/[0.015] dark:bg-white/[0.015] p-3 overflow-hidden cursor-pointer hover:bg-black/[0.03] dark:hover:bg-white/[0.03] transition-colors group"
                                onClick={() => toggleExpand(item.id)}
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
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <div className="text-[10px] font-mono text-slate-400">
                                            {formatTime(item.updatedAt)}
                                        </div>
                                        {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400 group-hover:text-slate-600" />}
                                    </div>
                                </div>

                                {/* Summary & Actions (Liquid Height via FLIP) */}
                                {isExpanded && (
                                    <div className="mt-3 pt-3 border-t border-black/[0.04] dark:border-white/[0.04]">
                                        <div
                                            className="prose prose-sm max-w-none text-[11px] leading-relaxed text-slate-500 dark:text-slate-400
                                                       prose-p:my-0 prose-code:text-signal-600 dark:prose-code:text-signal-400
                                                       prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md"
                                            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summaryMarkdown || "No summary provided.") }}
                                        />

                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400 mb-3">
                                            {shortenRuntimeId(item.taskId) && (
                                                <>
                                                    <span>task {shortenRuntimeId(item.taskId)}</span>
                                                    <span>·</span>
                                                </>
                                            )}
                                            {shortenRuntimeId(item.dispatchId) && (
                                                <span>dispatch {shortenRuntimeId(item.dispatchId)}</span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap gap-2" onClick={e => e.stopPropagation()}>
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
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
});
