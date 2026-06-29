import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { AttentionLedger } from "../AttentionLedger.js";
import { AlertTriangle, CheckCircle2 } from "lucide-preact";

export const AttentionQueuePanel: FunctionComponent = memo(() => {
    const { execution } = useExecutionTimeline();

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

    // When there are no attention items ever
    if (total === 0) {
        return (
            <div role="status" className="rounded-[1.75rem] border border-black/[0.08] bg-white p-5 shadow-sm dark:border-white/[0.08] dark:bg-void-800">
                <div className="flex items-start gap-3 rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] border-l-status-green bg-black/[0.015] p-3 dark:border-white/[0.04] dark:bg-white/[0.015]">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-green" strokeWidth={1.7} />
                    <div>
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">Queue clear</p>
                        <p className="mt-1 text-[11px] font-mono leading-relaxed text-slate-400 dark:text-slate-500">All tasks and workers are proceeding normally.</p>
                    </div>
                </div>
            </div>
        );
    }

    // Wrap the Ledger and potentially show summary stats
    return (
        <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                 {[
                    { label: "Open", value: open, color: "text-status-amber" },
                    { label: "Claimed", value: claimed, color: "text-signal-500" },
                    { label: "Resolved", value: resolved, color: "text-status-green" },
                    { label: "Cleared", value: dismissed, color: "text-slate-500" }
                 ].map(stat => (
                     <div key={stat.label} className="rounded-xl border border-black/[0.04] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-void-900/30">
                         <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{stat.label}</div>
                         <div className={`mt-1 font-mono text-lg font-black leading-none ${stat.color}`}>{stat.value}</div>
                     </div>
                 ))}
            </div>
            {open > 0 && (
                <div className="flex items-center gap-2 rounded-r-xl rounded-l-sm border border-l-2 border-status-amber/20 border-l-status-amber bg-status-amber/[0.055] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
                    <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.7} />
                    {open} item{open === 1 ? "" : "s"} need operator or worker attention
                </div>
            )}
            <AttentionLedger collapsible defaultOpen />
        </div>
    );
});
