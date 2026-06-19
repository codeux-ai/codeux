import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo, useLayoutEffect, useRef, useId, useState } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion, useResolvedMotionDuration } from "../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../lib/motion/tokens.js";
import { Bot, CheckCircle2, ChevronDown, XCircle } from "lucide-preact";
import { renderMarkdown } from "../../lib/markdown.js";
import { formatTime } from "../../lib/time.js";
import { MARKDOWN_PROSE_CLASS } from "./ui/MarkdownEditorField.js";
import { useExecutionTimeline } from "../../hooks/ExecutionTimelineContext.js";
import { ATTENTION_OWNER_LABELS, ATTENTION_SEVERITY_TONE, ATTENTION_TYPE_LABELS, ATTENTION_STATUS_TONE, shortenRuntimeId } from "./live-session/ExecutionRuntimePanel.js";
import { BorderTrace } from "./ui/BorderTrace.js";
import { WaveFluid } from "./ui/WaveFluid.js";

type AttentionLedgerProps = {
    collapsible?: boolean;
    defaultOpen?: boolean;
};

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
    const workersByEndpointId = useMemo(() => {
        if (!snapshot) return new Map<string, string>();
        const overflow = snapshot.overflowAssignedWorkers || [];
        const pairs = [
            snapshot.primaryAssignedWorker,
            ...overflow,
        ].filter(Boolean).map((worker) => [worker!.workerEndpointId || "", worker!.workerDisplayName] as const);
        return new Map(pairs);
    }, [snapshot?.overflowAssignedWorkers, snapshot?.primaryAssignedWorker, snapshot]);

    const listRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const reducedMotion = useReducedMotion();
    const duration = useResolvedMotionDuration(parseFloat(INTERACTION_TOKENS.enterExit.duration) / 1000);
    const attentionItems = snapshot?.attentionItems || [];

    const { openCount, claimedCount } = useMemo(() => {
        return {
            openCount: attentionItems.filter((item) => item.status === "open").length,
            claimedCount: attentionItems.filter((item) => item.status === "claimed").length,
        };
    }, [attentionItems, attentionItems.length]);

    const visibleAttentionItems = useMemo(() => {
        return attentionItems.slice(0, 8);
    }, [attentionItems, attentionItems.length]);

    useLayoutEffect(() => {
        if (!listRef.current || reducedMotion) {
            prevCountRef.current = attentionItems.length;
            return;
        }

        const currentCount = attentionItems.length;
        let ctx: any;
        if (currentCount > prevCountRef.current) {
            // New items were added, animate them
            const newElements = Array.from(listRef.current.children).filter(el => !el.hasAttribute('data-entered'));

            if (newElements.length > 0) {
                ctx = gsap.context(() => {
                    gsap.fromTo(newElements, { opacity: 0, x: -10 }, { opacity: 1, x: 0, duration: duration, stagger: 0.04, ease: INTERACTION_TOKENS.enterExit.ease, overwrite: "auto" });
                });
                newElements.forEach(el => el.setAttribute('data-entered', 'true'));
            }
        }
        prevCountRef.current = currentCount;
        return () => {
            if (ctx) ctx.revert();
        };
    }, [attentionItems, attentionItems.length, reducedMotion]);

    if (!snapshot) return null;

    const canAutoClaim = Boolean(snapshot.primaryAssignedWorker || (snapshot.overflowAssignedWorkers && snapshot.overflowAssignedWorkers.length > 0));

    const header = (
        <>
            <div className="flex items-center gap-2.5">
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Attention Queue</span>
                <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                    <span className="rounded-full border border-status-amber/20 bg-status-amber/10 px-2 py-1 text-status-amber">
                        open {openCount}
                    </span>
                    <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-signal-500">
                        claimed {claimedCount}
                    </span>
                </div>
            </div>
            {collapsible && (
                <ChevronDown
                    className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-300 ${open ? "rotate-0" : "-rotate-90"}`}
                    strokeWidth={2}
                />
            )}
        </>
    );

    return (
        <div className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#00E0A0" />
            <BorderTrace accentHex="#00E0A0" />

            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={contentId}
                    onClick={() => setOpen(!open)}
                    className="relative z-10 flex w-full items-center justify-between gap-4 p-5 transition-colors duration-200 hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
                >
                    {header}
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 p-5">
                    {header}
                </div>
            )}

            <div className={`${collapsible ? `collapsible-section ${open ? "open" : ""}` : ""}`}>
                <div id={contentId} className={`${collapsible ? "collapsible-content" : ""}`}>
                    <div className="relative z-10 px-5 pb-5 pt-0">
                        {attentionItems.length === 0 ? (
                            <p className="text-[11px] font-mono text-slate-400 dark:text-slate-600">
                                No active blockers are waiting in the project attention queue.
                            </p>
                        ) : (
                            <div ref={listRef} className="max-h-80 space-y-2 overflow-y-auto pr-1 dashboard-scrollbar">
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
                                            className="rounded-xl border border-black/[0.04] bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]"
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
                                                className={`mt-3 line-clamp-3 text-[11px] leading-relaxed prose-p:my-0 ${MARKDOWN_PROSE_CLASS}`}
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
                                                        <Bot className={`h-3 w-3 ${pendingActionIds.has(claimActionId) ? "animate-pulse" : ""}`} strokeWidth={2} />
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
                                                        <CheckCircle2 className={`h-3 w-3 ${pendingActionIds.has(resolveActionId) ? "animate-spin" : ""}`} strokeWidth={2} />
                                                        {pendingActionIds.has(resolveActionId) ? "Resolving" : "Resolve"}
                                                    </button>
                                                )}
                                                {snapshot.projectId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => onDismissAttentionItem(snapshot.projectId!, item.id)}
                                                        disabled={pendingActionIds.has(dismissActionId)}
                                                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 transition-colors hover:bg-black/[0.05] disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 dark:hover:bg-white/[0.05]"
                                                    >
                                                        <XCircle className={`h-3 w-3 ${pendingActionIds.has(dismissActionId) ? "animate-spin" : ""}`} strokeWidth={2} />
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
                </div>
            </div>
        </div>
    );
});
