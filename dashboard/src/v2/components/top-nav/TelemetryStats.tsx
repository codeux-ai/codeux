import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HeaderTokenThroughputScopeViewModel } from "../../lib/header-token-throughput.js";
import { buildHeaderTokenThroughputViewModel } from "../../lib/header-token-throughput.js";
import { useHeaderTokenThroughput } from "../../hooks/use-header-token-throughput.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { RollingNumber } from "../ui/RollingNumber.js";
import type { Sprint, Task } from "../../types.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

interface TelemetryStatsProps {
    projectId: string | null;
    sprints: Sprint[];
}

const countDotClasses = {
    running: "bg-emerald-500",
    queued: "bg-amber-400",
    idle: "bg-slate-300 dark:bg-slate-600",
};
const RUNNING_TASK_STATE = "running" as const;
const QUEUED_TASK_STATE = "queued" as const;

type ThroughputDirection = "up" | "down" | "flat";

interface ThroughputSample {
    key: string;
    value: number;
}

interface ThroughputTrend {
    direction: ThroughputDirection;
    samples: ThroughputSample[];
    deltaLabel: string;
    linePoints: number[];
    revision: number;
}

const THROUGHPUT_POINT_COUNT = 20;

function formatRateDelta(value: number): string {
    const abs = Math.abs(Math.round(value));
    if (abs >= 1_000_000) return `${Math.round(abs / 1_000_000)}M`;
    if (abs >= 1_000) return `${Math.round(abs / 1_000)}K`;
    return String(abs);
}

function useThroughputTrend(metric: HeaderTokenThroughputScopeViewModel, sampleKey: string | null): ThroughputTrend {
    const initialPoint = metric.tokensPerMinute > 0 ? 90 : 0;
    const [trend, setTrend] = useState<ThroughputTrend>(() => ({
        direction: "flat",
        samples: [{ key: "initial", value: metric.tokensPerMinute }],
        deltaLabel: "0",
        linePoints: Array.from({ length: THROUGHPUT_POINT_COUNT }, () => initialPoint),
        revision: 0,
    }));

    useEffect(() => {
        if (!sampleKey) return;
        setTrend((current) => {
            const lastSample = current.samples[current.samples.length - 1];
            if (lastSample?.key === sampleKey) {
                return current;
            }
            const nextValue = metric.tokensPerMinute;
            const previousValue = lastSample?.value ?? nextValue;
            const delta = nextValue - previousValue;
            const direction: ThroughputDirection = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
            const nextPoint = nextValue <= 0
                ? 0
                : direction === "up"
                    ? 98
                    : direction === "down"
                        ? 72
                        : 90;
            const historicalPoints = current.linePoints.slice(1, -1);
            const previousTail = current.linePoints[current.linePoints.length - 1] ?? (nextValue > 0 ? 90 : 0);
            const settledTail = nextValue <= 0
                ? Math.max(0, previousTail - 24)
                : previousTail + (90 - previousTail) * 0.58;
            const linePoints = [...historicalPoints, settledTail, nextPoint].slice(-THROUGHPUT_POINT_COUNT);
            return {
                direction,
                samples: [...current.samples, { key: sampleKey, value: nextValue }].slice(-THROUGHPUT_POINT_COUNT),
                deltaLabel: direction === "flat" ? "0" : formatRateDelta(delta),
                linePoints,
                revision: current.revision + 1,
            };
        });
    }, [metric.tokensPerMinute, sampleKey]);

    return trend;
}

const directionTone: Record<ThroughputDirection, string> = {
    up: "text-emerald-500",
    down: "text-amber-500",
    flat: "text-slate-400 dark:text-slate-500",
};

const ACTIVE_SPARKLINE_COLOR = "#00E0A0";
const IDLE_SPARKLINE_COLOR = "#94A3B8";

function buildThroughputPath(points: number[]): string {
    if (points.length === 0) return "";
    return points.map((point, index) => {
        const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
        const y = 100 - Math.max(0, Math.min(100, point));
        if (index === 0) return `M ${x} ${y}`;
        const prevX = points.length === 1 ? 50 : ((index - 1) / (points.length - 1)) * 100;
        const prevY = 100 - Math.max(0, Math.min(100, points[index - 1]));
        const dx = x - prevX;
        return `C ${prevX + dx * 0.35} ${prevY} ${x - dx * 0.35} ${y} ${x} ${y}`;
    }).join(" ");
}

function easeOutCubic(value: number): number {
    return 1 - Math.pow(1 - value, 3);
}

function interpolatePoints(from: number[], to: number[], progress: number): number[] {
    const size = Math.max(from.length, to.length);
    return Array.from({ length: size }, (_, index) => {
        const start = from[index] ?? from[from.length - 1] ?? 0;
        const end = to[index] ?? to[to.length - 1] ?? 0;
        return start + (end - start) * progress;
    });
}

function getAnimationNow(): number {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function useAnimatedThroughputLine(targetPoints: number[], revision: number): string {
    const [animatedPoints, setAnimatedPoints] = useState(targetPoints);
    const lastPointsRef = useRef(targetPoints);

    useEffect(() => {
        if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
            lastPointsRef.current = targetPoints;
            setAnimatedPoints(targetPoints);
            return;
        }

        const fromPoints = lastPointsRef.current;
        const startedAt = getAnimationNow();
        const durationMs = 860;
        let frame = 0;

        const tick = () => {
            const elapsed = getAnimationNow() - startedAt;
            const progress = Math.min(1, elapsed / durationMs);
            const eased = easeOutCubic(progress);
            setAnimatedPoints(interpolatePoints(fromPoints, targetPoints, eased));

            if (progress < 1) {
                frame = window.requestAnimationFrame(tick);
                return;
            }

            lastPointsRef.current = targetPoints;
        };

        frame = window.requestAnimationFrame(tick);
        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [revision, targetPoints]);

    return buildThroughputPath(animatedPoints);
}

const ThroughputSparkline: FunctionComponent<{
    metric: HeaderTokenThroughputScopeViewModel;
    trend: ThroughputTrend;
}> = ({ metric, trend }) => {
    const path = useAnimatedThroughputLine(trend.linePoints, trend.revision);
    const color = metric.hasActivity ? ACTIVE_SPARKLINE_COLOR : IDLE_SPARKLINE_COLOR;
    const gradientId = `header-throughput-${metric.scope}`;

    return (
        <svg
            aria-hidden="true"
            data-testid={`throughput-flux-${metric.scope}`}
            data-direction={trend.direction}
            className="h-6 w-20 shrink-0 overflow-visible"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
        >
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.42" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
            <path
                d={`${path} L 100 100 L 0 100 Z`}
                fill={`url(#${gradientId})`}
                opacity="0.9"
            />
            <path
                data-testid={`throughput-line-${metric.scope}`}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth="6"
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={100}
                strokeDasharray="100"
                strokeDashoffset="0"
                className="drop-shadow-[0_0_8px_rgba(0,224,160,0.45)] transition-[stroke] duration-700"
            />
        </svg>
    );
};

const ThroughputMetric: FunctionComponent<{
    metric: HeaderTokenThroughputScopeViewModel;
    trend: ThroughputTrend;
    compact?: boolean;
}> = ({ metric, trend, compact }) => (
    <div className={`flex min-w-0 items-center gap-2 px-2 ${compact ? "max-w-[7rem]" : "max-w-[13rem] xl:max-w-[14.5rem]"}`}>
        <ThroughputSparkline metric={metric} trend={trend} />
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
                <span
                    aria-hidden="true"
                    className={`hidden shrink-0 font-mono text-[9px] font-black leading-none tabular-nums 2xl:inline ${directionTone[trend.direction]}`}
                >
                    {trend.direction === "up" ? "+" : trend.direction === "down" ? "-" : ""}
                    {trend.deltaLabel}
                </span>
            </div>
        </div>
    </div>
);

const TaskCountMetric: FunctionComponent<{
    label: "running" | "queued";
    value: number;
}> = ({ label, value }) => {
    const { translate } = useOptionalDashboardI18n();
    const localizedLabel = translate(taskMessages, label);

    return (
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
            <span className="hidden text-[10px] font-medium leading-none text-slate-400 xl:inline">{localizedLabel}</span>
            <span className="text-[10px] font-medium leading-none text-slate-400 xl:hidden">{localizedLabel}</span>
        </div>
      </div>
    );
};

export const TelemetryStats: FunctionComponent<TelemetryStatsProps> = ({ projectId, sprints }) => {
    const activeSprintIds = useMemo(
        () => new Set((sprints || []).filter((s) => s.status === "running").map((s) => s.id)),
        [sprints],
    );
    const throughput = useHeaderTokenThroughput(null, "20s");
    const { tasks } = useProjectTasks(projectId, [], sprints, null, {
      enabled: activeSprintIds.size > 0,
      view: "overview",
    });

    const allTasks = tasks || [];
    const runningCount = allTasks.filter((t: Task) => t.status === "in_progress" && activeSprintIds.has(t.sprintId)).length;
    const queuedCount = allTasks.filter((t: Task) => t.status === "pending" && activeSprintIds.has(t.sprintId)).length;
    const tokenView = useMemo(() => buildHeaderTokenThroughputViewModel({
        snapshot: throughput.snapshot,
        projectId: null,
        window: "20s",
        loading: throughput.loading,
        error: throughput.error,
    }), [throughput.error, throughput.loading, throughput.snapshot]);
    const sampleKey = throughput.snapshot?.generatedAt ?? null;
    const appTrend = useThroughputTrend(tokenView.app, sampleKey ? `${sampleKey}:app` : null);
    const headerStatusLabel = tokenView.isError
        ? "Token telemetry unavailable"
        : tokenView.isLoading
            ? "Loading token telemetry"
            : tokenView.app.hasActivity
                ? `${tokenView.app.rateLabel} app throughput`
                : "No app token telemetry in this window";
    const headerAriaLabel = `${headerStatusLabel}. ${tokenView.app.ariaLabel}`;

    return (
        <div
            role="group"
            aria-label={headerAriaLabel}
            aria-busy={tokenView.isLoading ? "true" : "false"}
            className="hidden h-9 min-w-0 max-w-[min(40vw,24rem)] items-center gap-0.5 overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.025] px-1 dark:border-white/[0.06] dark:bg-white/[0.025] lg:flex 2xl:max-w-none"
        >
            <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                {headerStatusLabel}
            </span>
            <ThroughputMetric metric={tokenView.app} trend={appTrend} />
            <div className="h-4 w-px shrink-0 bg-black/[0.06] dark:bg-white/[0.06]" />
            <TaskCountMetric label={RUNNING_TASK_STATE} value={runningCount} />
            <div className="h-4 w-px shrink-0 bg-black/[0.06] dark:bg-white/[0.06]" />
            <TaskCountMetric label={QUEUED_TASK_STATE} value={queuedCount} />
        </div>
    );
};
