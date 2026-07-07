import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo, useLayoutEffect, useRef, useId, useState } from "preact/hooks";
import type { ExecutionAttentionItemSummary, ExecutionDashboardSnapshot } from "../../types.js";
import { getLiveActionDisplayProps, getPendingActionState } from "../lib/live-session-runtime.js";
import gsap from "gsap";
import { useReducedMotion, useResolvedMotionDuration } from "../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../lib/motion/tokens.js";
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, XCircle } from "lucide-preact";
import { renderMarkdown } from "../../lib/markdown.js";
import { formatTime } from "../../lib/time.js";
import { MARKDOWN_PROSE_CLASS } from "./ui/MarkdownEditorField.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import { ATTENTION_OWNER_LABELS, ATTENTION_SEVERITY_TONE, ATTENTION_TYPE_LABELS, ATTENTION_STATUS_TONE, shortenRuntimeId } from "./live-session/ExecutionRuntimePanel.js";



type AttentionLedgerProps = {
    collapsible?: boolean;
    defaultOpen?: boolean;
};

type AttentionQueueSnapshot = Pick<
    ExecutionDashboardSnapshot,
    "projectId" | "primaryAssignedWorker" | "overflowAssignedWorkers"
>;

export const AttentionQueueItemsList: FunctionComponent<{
    attentionItems: ExecutionAttentionItemSummary[];
    snapshot: AttentionQueueSnapshot | null;
    onClaimAttentionItem?: (projectId: string, attentionItemId: string) => void;
    onResolveAttentionItem?: (projectId: string, attentionItemId: string) => void;
    onDismissAttentionItem?: (projectId: string, attentionItemId: string) => void;
    pendingActionIds?: Set<string>;
    showActions?: boolean;
    maxItems?: number;
    emptyTitle?: string;
    emptyDescription?: string;
    listLabel?: string;
    listClassName?: string;
}> = memo(({
    attentionItems,
    snapshot,
    onClaimAttentionItem,
    onResolveAttentionItem,
    onDismissAttentionItem,
    pendingActionIds = new Set<string>(),
    showActions = true,
    maxItems = 8,
    emptyTitle = "Queue clear",
    emptyDescription = "No active blockers are waiting in the project attention queue.",
    listLabel = "Active attention items",
    listClassName = "max-h-[50dvh] sm:max-h-96 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar",
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const reducedMotion = useReducedMotion();
    const duration = useResolvedMotionDuration(parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000);

    const workersByEndpointId = useMemo(() => {
        if (!snapshot) return new Map<string, string>();
        const overflow = snapshot.overflowAssignedWorkers || [];
        const pairs = [
            snapshot.primaryAssignedWorker,
            ...overflow,
        ].filter(Boolean).map((worker) => [worker!.workerEndpointId || "", worker!.workerDisplayName] as const);
        return new Map(pairs);
    }, [snapshot?.overflowAssignedWorkers, snapshot?.primaryAssignedWorker, snapshot]);

    const visibleAttentionItems = useMemo(() => {
        return attentionItems.slice(0, maxItems);
    }, [attentionItems, attentionItems.length, maxItems]);

    useLayoutEffect(() => {
        if (!listRef.current || reducedMotion) {
            prevCountRef.current = attentionItems.length;
            return;
        }

        const currentCount = attentionItems.length;
        let ctx: { revert: () => void } | undefined;
        if (currentCount > prevCountRef.current) {
            const newElements = Array.from(listRef.current.children).filter(el => !el.hasAttribute("data-entered"));

            if (newElements.length > 0) {
                ctx = gsap.context(() => {
                    gsap.fromTo(newElements, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: duration, stagger: 0.04, ease: INTERACTION_TOKENS.enterExit.ease, overwrite: "auto" });
                });
                newElements.forEach(el => el.setAttribute("data-entered", "true"));
            }
        }
        prevCountRef.current = currentCount;
        return () => {
            if (ctx) ctx.revert();
        };
    }, [attentionItems, attentionItems.length, duration, reducedMotion]);

    if (attentionItems.length === 0) {
        return (
            <div role="status" aria-live="polite" className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                <div className="flex items-start gap-3">
                    <span className="mt-0.5 h-2 w-2 rounded-full bg-status-green shadow-[0_0_0_4px_rgba(0,171,132,0.10)]" aria-hidden="true" />
                    <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{emptyTitle}</p>
                        <p className="mt-1 text-[11px] font-mono leading-relaxed text-slate-400 dark:text-slate-500">
                            {emptyDescription}
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div ref={listRef} className={listClassName} role="list" aria-live="polite" aria-label={listLabel}>
            {visibleAttentionItems.map((item) => {
                const assignedWorkerLabel = item.assignedWorkerEndpointId
                    ? workersByEndpointId.get(item.assignedWorkerEndpointId) || item.assignedWorkerEndpointId
                    : item.ownerType === "worker"
                        ? "Unassigned"
                        : ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType;
                const canClaim = (
                    showActions
                    && Boolean(snapshot?.projectId)
                    && item.ownerType === "worker"
                    && item.status === "open"
                    && (Boolean(item.assignedWorkerEndpointId) || Boolean(snapshot?.primaryAssignedWorker) || Boolean(snapshot?.overflowAssignedWorkers?.length))
                );
                const claimActionId = `attention-claim:${item.id}`;
                const resolveActionId = `attention-resolve:${item.id}`;
                const dismissActionId = `attention-dismiss:${item.id}`;
                const claimActionState = getPendingActionState(pendingActionIds, claimActionId);
                const resolveActionState = getPendingActionState(pendingActionIds, resolveActionId);
                const dismissActionState = getPendingActionState(pendingActionIds, dismissActionId);
                const claimPendingReason = `Claiming attention item ${item.title} is already in progress.`;
                const resolvePendingReason = `Resolving attention item ${item.title} is already in progress.`;
                const dismissPendingReason = `Dismissing attention item ${item.title} is already in progress.`;

                return (
                    <div
                        key={item.id}
                        role="listitem"
                        className="group/row relative overflow-hidden rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 transition-colors hover:border-status-amber/25 hover:bg-status-amber/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015]"
                    >
                        <div className={`absolute inset-y-0 left-0 w-0.5 ${
                            item.severity === "critical" || item.severity === "high"
                                ? "bg-status-red"
                                : item.severity === "medium"
                                    ? "bg-status-amber"
                                    : "bg-signal-500"
                        }`} />
                        <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 pl-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="min-w-0 max-w-full break-words text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        {item.title}
                                    </span>
                                    <span className={`rounded-md border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] ${
                                        ATTENTION_SEVERITY_TONE[item.severity] || ATTENTION_SEVERITY_TONE.medium
                                    }`}>
                                        {item.severity}
                                    </span>
                                    <span className="rounded-md border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:text-slate-400">
                                        {ATTENTION_TYPE_LABELS[item.attentionType] || item.attentionType.replace(/_/g, " ")}
                                    </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-mono text-slate-400">
                                    <span className={ATTENTION_STATUS_TONE[item.status] || "text-slate-400"}>
                                        {item.status}
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-700">/</span>
                                    <span>{ATTENTION_OWNER_LABELS[item.ownerType] || item.ownerType}</span>
                                    <span className="text-slate-300 dark:text-slate-700">/</span>
                                    <span className="break-all">{assignedWorkerLabel}</span>
                                    {shortenRuntimeId(item.taskId) && (
                                        <>
                                            <span className="text-slate-300 dark:text-slate-700">/</span>
                                            <span>task {shortenRuntimeId(item.taskId)}</span>
                                        </>
                                    )}
                                    {shortenRuntimeId(item.dispatchId) && (
                                        <>
                                            <span className="text-slate-300 dark:text-slate-700">/</span>
                                            <span>dispatch {shortenRuntimeId(item.dispatchId)}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                            <div className="shrink-0 text-right text-[10px] font-mono text-slate-400">
                                {formatTime(item.updatedAt)}
                            </div>
                        </div>

                        <div
                            className={`mt-2 line-clamp-2 text-[11px] leading-relaxed text-slate-500 prose-p:my-0 dark:text-slate-400 ${MARKDOWN_PROSE_CLASS}`}
                            dangerouslySetInnerHTML={{ __html: renderMarkdown(item.summaryMarkdown || "No summary provided.") }}
                        />

                        {showActions && snapshot?.projectId && (
                            <div className="mt-3 flex flex-wrap gap-2 border-t border-black/[0.04] pt-2 dark:border-white/[0.04]">
                                {canClaim && onClaimAttentionItem && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            if (claimActionState === "pending") {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                return;
                                            }
                                            onClaimAttentionItem(snapshot.projectId!, item.id);
                                        }}
                                        {...getLiveActionDisplayProps(claimActionState === "pending", false, claimActionState === "pending" ? claimPendingReason : null)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-signal-500/20 bg-signal-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:bg-signal-500/15 aria-disabled:opacity-50 dark:text-signal-400"
                                        aria-label={claimActionState === "pending" ? `Claim attention item: ${item.title}. ${claimPendingReason}` : `Claim attention item: ${item.title}`}
                                        title={claimActionState === "pending" ? claimPendingReason : `Claim attention item: ${item.title}`}
                                    >
                                        <Bot className={`h-3 w-3 ${claimActionState === "pending" ? "motion-safe:animate-pulse" : ""}`} strokeWidth={2} aria-hidden="true" />
                                        {claimActionState === "pending" ? "Claiming" : "Claim"}
                                        {claimActionState === "pending" && <span className="sr-only">Claiming attention item in progress.</span>}
                                    </button>
                                )}
                                {onResolveAttentionItem && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            if (resolveActionState === "pending") {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                return;
                                            }
                                            onResolveAttentionItem(snapshot.projectId!, item.id);
                                        }}
                                        {...getLiveActionDisplayProps(resolveActionState === "pending", false, resolveActionState === "pending" ? resolvePendingReason : null)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-status-green/20 bg-status-green/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-status-green transition-colors hover:bg-status-green/15 aria-disabled:opacity-50"
                                        aria-label={resolveActionState === "pending" ? `Resolve attention item: ${item.title}. ${resolvePendingReason}` : `Resolve attention item: ${item.title}`}
                                        title={resolveActionState === "pending" ? resolvePendingReason : `Resolve attention item: ${item.title}`}
                                    >
                                        <CheckCircle2 className={`h-3 w-3 ${resolveActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />
                                        {resolveActionState === "pending" ? "Resolving" : "Resolve"}
                                        {resolveActionState === "pending" && <span className="sr-only">Resolving attention item in progress.</span>}
                                    </button>
                                )}
                                {onDismissAttentionItem && (
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            if (dismissActionState === "pending") {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                return;
                                            }
                                            onDismissAttentionItem(snapshot.projectId!, item.id);
                                        }}
                                        {...getLiveActionDisplayProps(dismissActionState === "pending", false, dismissActionState === "pending" ? dismissPendingReason : null)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-black/[0.05] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors hover:bg-black/[0.035] aria-disabled:opacity-50 dark:border-white/[0.06] dark:text-slate-400 dark:hover:bg-white/[0.04]"
                                        aria-label={dismissActionState === "pending" ? `Dismiss attention item: ${item.title}. ${dismissPendingReason}` : `Dismiss attention item: ${item.title}`}
                                        title={dismissActionState === "pending" ? dismissPendingReason : `Dismiss attention item: ${item.title}`}
                                    >
                                        <XCircle className={`h-3 w-3 ${dismissActionState === "pending" ? "motion-safe:animate-spin" : ""}`} strokeWidth={2} aria-hidden="true" />
                                        {dismissActionState === "pending" ? "Dismissing" : "Dismiss"}
                                        {dismissActionState === "pending" && <span className="sr-only">Dismissing attention item in progress.</span>}
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
});
export const AttentionLedger: FunctionComponent<AttentionLedgerProps> = memo(({
    collapsible = false,
    defaultOpen = true,
}) => {
    const {
        execution: snapshot,
        onClaimAttentionItem,
        onResolveAttentionItem,
        onDismissAttentionItem,
        pendingActionIds,
    } = useExecutionTimeline();

    const [open, setOpen] = useState(defaultOpen);
    const contentId = useId();
    const attentionItems = snapshot?.attentionItems || [];
    const contentRef = useRef<HTMLDivElement>(null);
    const isReducedMotion = useReducedMotion();
    const enterDuration = useResolvedMotionDuration(parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000);

    const { openCount, claimedCount, urgentCount } = useMemo(() => {
        return {
            openCount: attentionItems.filter((item) => item.status === "open").length,
            claimedCount: attentionItems.filter((item) => item.status === "claimed").length,
            urgentCount: attentionItems.filter((item) => item.severity === "critical" || item.severity === "high").length,
        };
    }, [attentionItems, attentionItems.length]);

    useLayoutEffect(() => {
        if (!contentRef.current || !collapsible) return;
        if (isReducedMotion) {
            gsap.set(contentRef.current, { height: open ? "auto" : 0, overflow: "hidden" });
        } else {
            gsap.killTweensOf(contentRef.current);
            gsap.to(contentRef.current, {
                height: open ? "auto" : 0,
                duration: enterDuration,
                ease: INTERACTION_TOKENS.enterExit.ease,
                overwrite: "auto",
                onComplete: () => {
                    if (open && contentRef.current) gsap.set(contentRef.current, { height: "auto" });
                }
            });
        }
    }, [open, isReducedMotion, enterDuration, collapsible]);

    if (!snapshot) return null;

    const header = (
        <>
            <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <AlertTriangle className="h-4 w-4 text-status-amber" strokeWidth={1.5} aria-hidden="true" />
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Attention Queue</span>
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                    <span className="rounded-md bg-status-amber/10 px-2 py-0.5 font-mono text-status-amber">
                        open {openCount}
                    </span>
                    <span className="rounded-md bg-signal-500/10 px-2 py-0.5 font-mono text-signal-500">
                        claimed {claimedCount}
                    </span>
                    {urgentCount > 0 && (
                        <span className="rounded-md bg-status-red/10 px-2 py-0.5 font-mono text-status-red">
                            urgent {urgentCount}
                        </span>
                    )}
                </div>
            </div>
            {collapsible && (
                <ChevronDown
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
                    strokeWidth={2}
                    aria-hidden="true"
                />
            )}
        </>
    );

    return (
        <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-void-800">



            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={() => setOpen(!open)}
                    className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-200 hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
                >
                    {header}
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 p-5">
                    {header}
                </div>
            )}

            <div className={`${collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}`}>
                <div id={contentId} ref={contentRef} className={`${collapsible ? "collapsible-content overflow-hidden" : ""}`}>
                    <div className="relative z-10 px-5 pb-5 pt-0">
                        <AttentionQueueItemsList
                            attentionItems={attentionItems}
                            snapshot={snapshot}
                            onClaimAttentionItem={onClaimAttentionItem}
                            onResolveAttentionItem={onResolveAttentionItem}
                            onDismissAttentionItem={onDismissAttentionItem}
                            pendingActionIds={pendingActionIds}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
});
