import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import { AttentionLedger } from "../AttentionLedger.js";
import { CheckCircle2, AlertCircle } from "lucide-preact";

export const AttentionQueuePanel: FunctionComponent = memo(() => {
    const { execution } = useExecutionTimeline();

    const { total, open, claimed, resolved, failed } = useMemo(() => {
        const items = execution?.attentionItems || [];
        return {
            total: items.length,
            open: items.filter(i => i.status === "open").length,
            claimed: items.filter(i => i.status === "claimed").length,
            resolved: items.filter(i => i.status === "resolved").length,
            failed: items.filter(i => i.status === "failed").length,
        };
    }, [execution?.attentionItems]);

    // When there are no attention items ever
    if (total === 0) {
        return (
            <div role="status" className="flex flex-col items-center justify-center py-10 rounded-[1.4rem] border border-black/[0.06] bg-white/75 dark:border-white/[0.06] dark:bg-void-800/65 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] backdrop-blur-sm p-4">
                <CheckCircle2 className="w-8 h-8 mb-3 text-status-green opacity-40" strokeWidth={1.5} />
                <p className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-400">Attention Queue Empty</p>
                <p className="text-xs mt-1 font-mono opacity-80 text-slate-500">All tasks and workers are proceeding normally.</p>
            </div>
        );
    }

    // Wrap the Ledger and potentially show summary stats
    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
                 {[
                    { label: "Open", value: open, color: "text-status-amber" },
                    { label: "Claimed", value: claimed, color: "text-signal-500" },
                    { label: "Resolved", value: resolved, color: "text-status-green" },
                    { label: "Failed", value: failed, color: "text-status-red" }
                 ].map(stat => (
                     <div key={stat.label} className="rounded-lg border border-black/[0.04] bg-white/50 dark:bg-void-800/50 p-2 dark:border-white/[0.05]">
                         <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{stat.label}</div>
                         <div className={`mt-1 text-lg font-black leading-none ${stat.color}`}>{stat.value}</div>
                     </div>
                 ))}
            </div>
            <AttentionLedger collapsible defaultOpen />
        </div>
    );
});
