import type { FunctionComponent } from "preact";
import { useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  BarChart3,
  Clock3,
  Layers3,
  ShieldCheck,
  Sparkles,
  TimerReset,
} from "lucide-preact";
import { useProjectData } from "./context/project-data.js";
import { useProjectStats } from "./hooks/use-project-stats.js";
import type { ExecutionStatsEntitySummary, ExecutionUsageBucketSummary, ExecutionUsageTotals, ProjectStatsWindow } from "./types.js";

const EMPTY_USAGE: ExecutionUsageTotals = {
  invocationCount: 0,
  activeTimeMs: 0,
  wallTimeMs: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
  reportedInvocationCount: 0,
  estimatedInvocationCount: 0,
  unavailableInvocationCount: 0,
  unsupportedInvocationCount: 0,
};

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return value.toLocaleString();
}

function formatDuration(value: number): string {
  const seconds = Math.max(0, Math.round(value / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function buildLinePath(values: number[], width: number, height: number): string {
  if (values.length === 0) {
    return "";
  }
  const max = Math.max(...values, 1);
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * height;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

const RangeToggle: FunctionComponent<{
  window: ProjectStatsWindow;
  onChange: (value: ProjectStatsWindow) => void;
}> = ({ window, onChange }) => (
  <div className="inline-flex rounded-full border border-black/[0.06] bg-white/60 p-1 dark:border-white/[0.06] dark:bg-white/[0.04]">
    {(["24h", "7d"] as const).map((value) => (
      <button
        key={value}
        type="button"
        onClick={() => onChange(value)}
        className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] transition-all ${
          window === value
            ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        {value}
      </button>
    ))}
  </div>
);

const UsageHeroGraph: FunctionComponent<{
  buckets: ExecutionUsageBucketSummary[];
  window: ProjectStatsWindow;
}> = ({ buckets, window }) => {
  const tokenValues = buckets.map((bucket) => bucket.usage.totalTokens);
  const timeValues = buckets.map((bucket) => bucket.usage.activeTimeMs);
  const width = 760;
  const height = 220;
  const tokenPath = buildLinePath(tokenValues, width, height);
  const timePath = buildLinePath(timeValues, width, height);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.82),rgba(245,242,233,0.7))] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(15,23,42,0.3))]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.14),transparent_42%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.14),transparent_44%)]" />
      <div className="relative mb-5 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">Usage Graph</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
            {window === "24h" ? "Last 24 hours" : "Last 7 days"}
          </div>
        </div>
        <div className="flex gap-3 text-[10px] font-bold uppercase tracking-[0.16em]">
          <span className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-signal-600 dark:text-signal-400">
            <span className="h-2 w-2 rounded-full bg-signal-500" />
            Tokens
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-amber-600 dark:text-amber-400">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            Active Time
          </span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height + 44}`} className="relative h-[300px] w-full overflow-visible">
        <defs>
          <linearGradient id="stats-token-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(0,224,160,0.85)" />
            <stop offset="100%" stopColor="rgba(0,170,255,0.95)" />
          </linearGradient>
          <linearGradient id="stats-time-line" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="rgba(255,184,0,0.85)" />
            <stop offset="100%" stopColor="rgba(251,113,133,0.9)" />
          </linearGradient>
        </defs>
        {Array.from({ length: 4 }).map((_, index) => (
          <line
            key={index}
            x1="0"
            x2={width}
            y1={((index + 1) / 4) * height}
            y2={((index + 1) / 4) * height}
            stroke="currentColor"
            strokeOpacity="0.08"
          />
        ))}
        <path d={tokenPath} fill="none" stroke="url(#stats-token-line)" strokeWidth="4" strokeLinecap="round" className="drop-shadow-[0_0_18px_rgba(0,224,160,0.28)]" />
        <path d={timePath} fill="none" stroke="url(#stats-time-line)" strokeWidth="3" strokeLinecap="round" strokeDasharray="8 10" className="drop-shadow-[0_0_18px_rgba(251,191,36,0.24)]" />
        {buckets.map((bucket, index) => {
          const x = buckets.length === 1 ? width / 2 : (index / (buckets.length - 1)) * width;
          return (
            <text
              key={bucket.bucketStart}
              x={x}
              y={height + 26}
              textAnchor="middle"
              className="fill-slate-400 text-[9px] font-bold uppercase tracking-[0.18em]"
            >
              {bucket.label}
            </text>
          );
        })}
      </svg>
    </div>
  );
};

const UsageCard: FunctionComponent<{
  icon: typeof Sparkles;
  label: string;
  value: string;
  detail: string;
  tone: string;
}> = ({ icon: Icon, label, value, detail, tone }) => (
  <div className="rounded-[1.7rem] border border-black/[0.05] bg-white/60 p-5 shadow-[0_20px_60px_rgba(15,23,42,0.06)] dark:border-white/[0.05] dark:bg-white/[0.04]">
    <div className="flex items-center justify-between gap-4">
      <span className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">{label}</span>
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-2xl ${tone}`}>
        <Icon className="h-4 w-4" strokeWidth={2} />
      </div>
    </div>
    <div className="mt-5 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
    <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{detail}</div>
  </div>
);

const UsageTable: FunctionComponent<{
  title: string;
  eyebrow: string;
  items: ExecutionStatsEntitySummary[];
  primaryLabel: (item: ExecutionStatsEntitySummary) => string;
}> = ({ title, eyebrow, items, primaryLabel }) => (
  <div className="rounded-[1.9rem] border border-black/[0.05] bg-white/60 p-6 shadow-[0_24px_70px_rgba(15,23,42,0.06)] dark:border-white/[0.05] dark:bg-white/[0.04]">
    <div className="mb-5 flex items-center justify-between gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">{eyebrow}</div>
        <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
      </div>
      <div className="rounded-full border border-black/[0.06] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:border-white/[0.06]">
        {items.length} items
      </div>
    </div>
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
          No telemetry landed in this window yet.
        </div>
      ) : items.map((item) => (
        <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 rounded-2xl border border-black/[0.04] bg-black/[0.015] px-4 py-3 dark:border-white/[0.04] dark:bg-white/[0.02]">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{primaryLabel(item)}</div>
            <div className="mt-1 text-[11px] font-mono text-slate-400">
              {item.secondaryLabel || item.status || "telemetry scope"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-black text-slate-900 dark:text-white">{formatTokens(item.usage.totalTokens)}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">tokens</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-black text-slate-900 dark:text-white">{formatDuration(item.usage.activeTimeMs)}</div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">active</div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const StatsPage: FunctionComponent = () => {
  const rootRef = useRef<HTMLDivElement>(null);
  const { selectedProject } = useProjectData();
  const [window, setWindow] = useState<ProjectStatsWindow>("7d");
  const { stats, loading, error } = useProjectStats(selectedProject?.id || null, window);

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }
    gsap.fromTo(
      rootRef.current.children,
      { opacity: 0, y: 36 },
      { opacity: 1, y: 0, duration: 0.9, stagger: 0.1, ease: "power4.out" },
    );
  }, []);

  const usage = stats?.usage || EMPTY_USAGE;
  const confidenceLabel = useMemo(() => {
    if (!stats) {
      return "No telemetry";
    }
    if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount === 0) {
      return "Provider reported";
    }
    if (usage.reportedInvocationCount > 0 && usage.estimatedInvocationCount > 0) {
      return "Mixed reported + estimated";
    }
    if (usage.estimatedInvocationCount > 0) {
      return "Estimated fallback";
    }
    return "Unavailable";
  }, [stats, usage.estimatedInvocationCount, usage.reportedInvocationCount]);

  return (
    <div ref={rootRef} className="mx-auto flex max-w-[2400px] flex-col gap-16 px-8 py-20 md:px-20">
      <section className="relative overflow-hidden rounded-[2.8rem] border border-black/[0.05] bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(244,240,228,0.7))] px-8 py-10 shadow-[0_40px_120px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-[linear-gradient(135deg,rgba(255,255,255,0.05),rgba(15,23,42,0.34))]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(0,224,160,0.13),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(255,184,0,0.16),transparent_40%)]" />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.24em] text-signal-600 dark:text-signal-400">
              <BarChart3 className="h-3.5 w-3.5" strokeWidth={2.2} />
              Telemetry Atlas
            </div>
            <h1 className="mt-6 text-5xl font-black tracking-[-0.06em] text-slate-900 dark:text-white md:text-7xl">
              Statistics.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-500 dark:text-slate-400">
              Token usage and tracked execution time across coding, CI recovery, and merge automation for the selected project.
            </p>
          </div>
          <div className="flex flex-col items-start gap-4 lg:items-end">
            <RangeToggle window={window} onChange={setWindow} />
            <div className="rounded-full border border-black/[0.06] bg-white/60 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
              {selectedProject?.name || "No project selected"}
            </div>
          </div>
        </div>
      </section>

      {!selectedProject ? (
        <div className="rounded-[2rem] border border-dashed border-black/[0.08] px-8 py-16 text-center text-base text-slate-400 dark:border-white/[0.08]">
          Select a project to load telemetry.
        </div>
      ) : loading && !stats ? (
        <div className="rounded-[2rem] border border-black/[0.05] bg-white/60 px-8 py-16 text-center text-base text-slate-500 dark:border-white/[0.05] dark:bg-white/[0.04] dark:text-slate-400">
          Loading the latest telemetry field for {selectedProject.name}.
        </div>
      ) : error ? (
        <div className="rounded-[2rem] border border-red-500/20 bg-red-500/10 px-8 py-12 text-base text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : stats ? (
        <>
          <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_1.55fr]">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <UsageCard
                icon={Sparkles}
                label="Total Tokens"
                value={formatTokens(usage.totalTokens)}
                detail={`${usage.reportedInvocationCount} reported · ${usage.estimatedInvocationCount} estimated`}
                tone="bg-signal-500/12 text-signal-600 dark:text-signal-400"
              />
              <UsageCard
                icon={Activity}
                label="Active AI Time"
                value={formatDuration(usage.activeTimeMs)}
                detail={`${usage.invocationCount} provider invocations in this window`}
                tone="bg-amber-500/12 text-amber-600 dark:text-amber-400"
              />
              <UsageCard
                icon={Clock3}
                label="Wall Runtime"
                value={formatDuration(usage.wallTimeMs)}
                detail="Summed from task-run durations in the same window"
                tone="bg-slate-900/10 text-slate-700 dark:bg-white/10 dark:text-slate-200"
              />
              <UsageCard
                icon={ShieldCheck}
                label="Telemetry Confidence"
                value={confidenceLabel}
                detail={`${usage.unavailableInvocationCount + usage.unsupportedInvocationCount} invocations missing provider counts`}
                tone="bg-status-green/12 text-status-green"
              />
            </div>
            <UsageHeroGraph buckets={stats.buckets} window={window} />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <div className="rounded-[1.8rem] border border-black/[0.05] bg-white/60 p-6 dark:border-white/[0.05] dark:bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <Layers3 className="h-4 w-4 text-signal-500" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Sprint Scope</div>
              </div>
              <div className="mt-4 text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                {stats.activeSprint ? stats.activeSprint.sprintName : "No active sprint"}
              </div>
              <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                {stats.activeSprint
                  ? `Sprint ${stats.activeSprint.sprintNumber ?? "?"} is currently driving live telemetry.`
                  : "Historical telemetry is still available even without an active sprint."}
              </div>
            </div>
            <div className="rounded-[1.8rem] border border-black/[0.05] bg-white/60 p-6 dark:border-white/[0.05] dark:bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <TimerReset className="h-4 w-4 text-amber-500" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Token Anatomy</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div><span className="block text-slate-400">Input</span><span className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(usage.inputTokens)}</span></div>
                <div><span className="block text-slate-400">Cached</span><span className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(usage.cachedInputTokens)}</span></div>
                <div><span className="block text-slate-400">Output</span><span className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(usage.outputTokens)}</span></div>
                <div><span className="block text-slate-400">Reasoning</span><span className="text-lg font-black text-slate-900 dark:text-white">{formatTokens(usage.reasoningOutputTokens)}</span></div>
              </div>
            </div>
            <div className="rounded-[1.8rem] border border-black/[0.05] bg-white/60 p-6 dark:border-white/[0.05] dark:bg-white/[0.04]">
              <div className="flex items-center gap-3">
                <Sparkles className="h-4 w-4 text-status-green" strokeWidth={2} />
                <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Source Mix</div>
              </div>
              <div className="mt-4 space-y-3">
                {stats.tokenSources.map((entry) => (
                  <div key={entry.source} className="flex items-center justify-between rounded-2xl border border-black/[0.04] px-4 py-3 dark:border-white/[0.04]">
                    <span className="text-sm font-semibold capitalize text-slate-700 dark:text-slate-200">{entry.source}</span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">{entry.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <UsageTable title="Top Tasks" eyebrow="Task Usage" items={stats.tasks} primaryLabel={(item) => item.label} />
            <UsageTable title="Sprint Ledger" eyebrow="Sprint Usage" items={stats.sprints} primaryLabel={(item) => item.label} />
            <UsageTable title="Provider Split" eyebrow="Provider Usage" items={stats.providers} primaryLabel={(item) => item.label.toUpperCase()} />
            <UsageTable title="Purpose Split" eyebrow="Execution Purpose" items={stats.purposes} primaryLabel={(item) => item.label.replace(/_/g, " ")} />
          </section>
        </>
      ) : null}
    </div>
  );
};
