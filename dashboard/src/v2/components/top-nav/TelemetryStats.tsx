import type { FunctionComponent } from "preact";
import { useMemo } from "preact/hooks";
import type { HeaderTokenThroughputScopeViewModel } from "../../lib/header-token-throughput.js";
import { buildHeaderTokenThroughputViewModel } from "../../lib/header-token-throughput.js";
import { useHeaderTokenThroughput } from "../../hooks/use-header-token-throughput.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { RollingNumber } from "../ui/RollingNumber.js";
import type { Sprint, Task } from "../../types.js";

interface TelemetryStatsProps {
    projectId: string | null;
    sprints: Sprint[];
}

const intensityClasses: Record<HeaderTokenThroughputScopeViewModel["intensity"], string> = {
    idle: "bg-slate-300 dark:bg-slate-600",
    low: "bg-signal-400 shadow-[0_0_10px_rgba(0,224,160,0.25)]",
    medium: "bg-signal-500 shadow-[0_0_14px_rgba(0,224,160,0.36)]",
    high: "bg-ember-400 shadow-[0_0_16px_rgba(255,184,0,0.4)]",
};

const countDotClasses = {
    running: "bg-emerald-500",
    queued: "bg-amber-400",
    idle: "bg-slate-300 dark:bg-slate-600",
};

const ThroughputBars: FunctionComponent<{ metric: HeaderTokenThroughputScopeViewModel }> = ({ metric }) => {
    const heightClass = metric.intensity === "high"
        ? ["h-2", "h-3", "h-4"]
        : metric.intensity === "medium"
            ? ["h-1.5", "h-2.5", "h-3.5"]
            : metric.intensity === "low"
                ? ["h-1", "h-2", "h-2.5"]
                : ["h-1", "h-1", "h-1"];

    return (
        <span aria-hidden="true" className="flex h-4 w-5 shrink-0 items-end justify-center gap-0.5">
            {heightClass.map((height, index) => (
                <span
                    key={`${metric.scope}-${index}`}
                    className={`w-1 rounded-full ${height} ${intensityClasses[metric.intensity]} ${
                        metric.hasActivity ? "motion-safe:animate-pulse motion-reduce:animate-none" : ""
                    }`}
                />
            ))}
        </span>
    );
};

const ThroughputMetric: FunctionComponent<{ metric: HeaderTokenThroughputScopeViewModel; compact?: boolean }> = ({ metric, compact }) => (
    <div className={`flex min-w-0 items-center gap-2 px-2 ${compact ? "max-w-[5.5rem]" : "max-w-[8.5rem] xl:max-w-[10rem]"}`}>
        <ThroughputBars metric={metric} />
        <div className="grid min-w-0 grid-rows-[auto_auto] gap-0.5">
            <div className="flex min-w-0 items-baseline gap-1">
                <span className="min-w-0 truncate font-mono text-[13px] font-black leading-none text-slate-800 tabular-nums dark:text-slate-100">
                    {metric.rateValueLabel}
                </span>
                <span className="shrink-0 text-[9px] font-bold uppercase leading-none text-slate-400 dark:text-slate-500">
                    {metric.rateUnitLabel}
                </span>
            </div>
            <div className="flex min-w-0 items-center gap-1 text-[9px] font-bold uppercase leading-none text-slate-400 dark:text-slate-500">
                <span className="min-w-0 truncate">{metric.label}</span>
                <span className="hidden min-w-0 truncate 2xl:inline">{metric.hasActivity ? metric.totalLabel : metric.emptyLabel}</span>
            </div>
        </div>
    </div>
);

const TaskCountMetric: FunctionComponent<{
    label: "running" | "queued";
    value: number;
}> = ({ label, value }) => (
    <div className="flex min-w-0 items-center gap-2 px-2">
        <span className="relative flex h-2 w-2 shrink-0">
            {label === "running" && value > 0 && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping motion-reduce:animate-none" />
            )}
            <span className={`relative inline-flex h-2 w-2 rounded-full ${value > 0 ? countDotClasses[label] : countDotClasses.idle}`} />
        </span>
        <div className="flex min-w-0 items-baseline gap-1">
            <span className="font-mono text-sm font-semibold leading-none text-slate-700 tabular-nums dark:text-slate-200">
                <RollingNumber value={value} />
            </span>
            <span className="hidden text-[10px] font-medium leading-none text-slate-400 xl:inline">{label}</span>
            <span className="text-[10px] font-medium leading-none text-slate-400 xl:hidden">{label === "running" ? "run" : "queue"}</span>
        </div>
    </div>
);

export const TelemetryStats: FunctionComponent<TelemetryStatsProps> = ({ projectId, sprints }) => {
    const activeSprintIds = useMemo(
        () => new Set((sprints || []).filter((s) => s.status === "running").map((s) => s.id)),
        [sprints],
    );
    const throughput = useHeaderTokenThroughput(projectId, "1h");
    const { tasks } = useProjectTasks(projectId, [], sprints, null, {
        enabled: activeSprintIds.size > 0,
    });

    const allTasks = tasks || [];
    const runningCount = allTasks.filter((t: Task) => t.status === "in_progress" && activeSprintIds.has(t.sprintId)).length;
    const queuedCount = allTasks.filter((t: Task) => t.status === "pending" && activeSprintIds.has(t.sprintId)).length;
    const tokenView = useMemo(() => buildHeaderTokenThroughputViewModel({
        snapshot: throughput.snapshot,
        projectId,
        window: "1h",
        loading: throughput.loading,
        error: throughput.error,
    }), [projectId, throughput.error, throughput.loading, throughput.snapshot]);

    return (
        <div
            role="group"
            aria-label={tokenView.ariaLabel}
            aria-busy={tokenView.isLoading ? "true" : "false"}
            className="hidden h-9 min-w-0 max-w-[min(48vw,29rem)] items-center gap-0.5 overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.025] px-1 dark:border-white/[0.06] dark:bg-white/[0.025] lg:flex 2xl:max-w-none"
        >
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {tokenView.statusLabel}
            </span>
            <ThroughputMetric metric={tokenView.app} />
            <div className="h-4 w-px shrink-0 bg-black/[0.06] dark:bg-white/[0.06]" />
            <ThroughputMetric metric={tokenView.project} compact />
            <div className="hidden h-4 w-px shrink-0 bg-black/[0.06] dark:bg-white/[0.06] xl:block" />
            <TaskCountMetric label="running" value={runningCount} />
            <div className="h-4 w-px shrink-0 bg-black/[0.06] dark:bg-white/[0.06]" />
            <TaskCountMetric label="queued" value={queuedCount} />
        </div>
    );
};
