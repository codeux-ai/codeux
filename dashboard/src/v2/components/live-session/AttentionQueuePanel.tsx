import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { AttentionLedger } from "../AttentionLedger.js";
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-preact";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { RuntimeSnapshotSurfaceBadge, RuntimeSnapshotSurfaceNotice } from "./ExecutionRuntimePanel.js";
import { useLiveI18n } from "../../i18n/messages/live.js";

export const AttentionQueuePanel: FunctionComponent<{
    collapsible?: boolean;
    defaultOpen?: boolean;
}> = memo(({
    collapsible = false,
    defaultOpen = true,
}) => {
    const { t, tp, formatNumber } = useLiveI18n();
    const { execution, snapshotSurface } = useExecutionTimeline();
    const [openState, setOpenState] = useState(defaultOpen);
    const contentId = useId();
    const contentRef = useRef<HTMLDivElement>(null);
    const isReducedMotion = useReducedMotion();
    const motionTokens = useGsapInteractionTokens();

    useLayoutEffect(() => {
        if (!contentRef.current || !collapsible) return;
        if (isReducedMotion) {
            gsap.set(contentRef.current, { height: openState ? "auto" : 0, overflow: "hidden" });
        } else {
            gsap.killTweensOf(contentRef.current);
            gsap.to(contentRef.current, {
                height: openState ? "auto" : 0,
                duration: motionTokens.expansionCollapse.duration,
                ease: motionTokens.expansionCollapse.ease,
                overwrite: "auto",
                onComplete: () => {
                    if (openState && contentRef.current) gsap.set(contentRef.current, { height: "auto" });
                },
            });
        }
    }, [collapsible, isReducedMotion, motionTokens.expansionCollapse.duration, motionTokens.expansionCollapse.ease, openState]);

    const { total, open, claimed, resolved, dismissed } = useMemo(() => {
        const items = execution?.attentionItems || [];
        return {
            total: items.length,
            open: items.filter(i => i.status === "open").length,
            claimed: items.filter(i => i.status === "claimed").length,
            resolved: items.filter(i => i.status === "resolved").length,
            dismissed: items.filter(i => i.status === "dismissed" || i.status === "expired").length,
        };
    }, [execution?.attentionItems]);
    const summary = t("attentionSummary", { total: formatNumber(total), open: formatNumber(open), claimed: formatNumber(claimed), resolved: formatNumber(resolved), cleared: formatNumber(dismissed) });

    if (!execution) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 text-[11px] font-mono text-slate-400 shadow-sm dark:border-white/[0.08] dark:bg-void-800 dark:text-slate-500">
                {t("loadingAttentionQueue")}
            </div>
        );
    }

    const header = (
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-status-amber" strokeWidth={1.7} aria-hidden="true" />
            <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("attentionQueue")}</span>
            <div className="flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em]">
                <span className="rounded-md bg-status-amber/10 px-2 py-0.5 font-mono text-status-amber">{t("openCount", { count: formatNumber(open) })}</span>
                <span className="rounded-md bg-signal-500/10 px-2 py-0.5 font-mono text-signal-500">{t("claimedCount", { count: formatNumber(claimed) })}</span>
                <span className="rounded-md bg-status-green/10 px-2 py-0.5 font-mono text-status-green">{t("resolved")} {formatNumber(resolved)}</span>
                <span className="rounded-md bg-black/[0.03] px-2 py-0.5 font-mono text-slate-500 dark:bg-white/[0.04] dark:text-slate-400">{t("cleared")} {formatNumber(dismissed)}</span>
            </div>
            <RuntimeSnapshotSurfaceBadge surface={snapshotSurface} />
            <span className="sr-only">{summary}</span>
        </div>
    );

    const content = total === 0 ? (
        <div role="status" aria-live="polite" aria-atomic="true">
                <div className="flex items-start gap-3 rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] border-l-status-green bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" strokeWidth={1.7} aria-hidden="true" />
                    <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t("queueClear")}</p>
                        <p className="mt-1 text-[11px] font-mono leading-relaxed text-slate-400 dark:text-slate-500">{t("allProceeding")}</p>
                    </div>
                </div>
        </div>
    ) : (
        <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                 {[
                    { label: t("open"), value: open, color: "text-status-amber" },
                    { label: t("claimed"), value: claimed, color: "text-signal-500" },
                    { label: t("resolved"), value: resolved, color: "text-status-green" },
                    { label: t("cleared"), value: dismissed, color: "text-slate-500" }
                 ].map(stat => (
                     <div key={stat.label} className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30 min-w-0">
                         <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{stat.label}</div>
                         <div className={`mt-1 font-mono text-base font-semibold leading-none ${stat.color}`}>{formatNumber(stat.value)}</div>
                     </div>
                 ))}
            </div>
            {open > 0 && (
                <div role="status" aria-live="polite" className="flex items-center gap-2 rounded-r-xl rounded-l-sm border border-l-2 border-status-amber/20 border-l-status-amber bg-status-amber/[0.055] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                    <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
                    {tp("needsAttention", open, { count: formatNumber(open) })}
                </div>
            )}
            <AttentionLedger collapsible defaultOpen />
        </>
    );

    return (
        <div role="region" aria-label={t("attentionQueueStatus")} aria-busy={snapshotSurface?.isBusy || claimed > 0 ? "true" : undefined} className="group relative overflow-hidden rounded-[1.75rem] border border-black/[0.08] bg-white shadow-sm dark:border-white/[0.08] dark:bg-void-800">
            {collapsible ? (
                <button
                    type="button"
                    aria-expanded={openState}
                    aria-controls={contentId}
                    onClick={() => setOpenState((current) => !current)}
                    className="relative z-10 flex w-full items-center justify-between gap-4 p-5 text-left transition-colors duration-[var(--interaction-control-feedback-duration)] ease-[var(--interaction-control-feedback-ease)] hover:bg-black/[0.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:hover:bg-white/[0.01] dark:focus-visible:ring-offset-void-800"
                >
                    {header}
                    <ChevronDown
                        className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-[var(--interaction-expansion-collapse-duration)] ease-[var(--interaction-expansion-collapse-ease)] ${openState ? "rotate-0" : "-rotate-90"}`}
                        strokeWidth={2}
                        aria-hidden="true"
                    />
                </button>
            ) : (
                <div className="relative z-10 flex items-center justify-between gap-4 p-5">
                    {header}
                </div>
            )}
            <div
                className={collapsible ? `collapsible-section ${openState ? "open" : ""}` : ""}
                id={contentId}
                aria-hidden={collapsible && !openState ? "true" : undefined}
            >
                <div ref={contentRef} className={collapsible ? "collapsible-content overflow-hidden" : ""}>
                    <div className="relative z-10 flex flex-col gap-3 px-5 pb-5 pt-0">
                        <RuntimeSnapshotSurfaceNotice surface={snapshotSurface} panelLabel={t("attentionQueuePanelLabel")} />
                        {content}
                    </div>
                </div>
            </div>
        </div>
    );
});
