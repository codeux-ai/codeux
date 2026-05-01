import { buildDonutSlices } from "./stats-geometry.js";
import type { FunctionComponent, ComponentType } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  Clock3,
  Database,
  Layers3,
  PieChart,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Workflow,
  Bot,
  Terminal,
} from "lucide-preact";
import { Sparkline } from "../../../components/ui/Sparkline.js";
import { StatsCard, type StatsCardAccent } from "./StatsCard.js";
import type {
  ExecutionStatsEntitySummary,
  ExecutionUsageBucketSummary,
  ProjectExecutionStatsSnapshot,
  ProjectStatsWindow,
  SegmentDefinition,
} from "../../../types.js";
import {
  formatTokens,
  formatDuration,
  formatPercent,
  formatDateTime,
  sumUsage,
  createSeries,
  getPurposeConfig,
} from "../stats-utils.js";

import type { DonutSliceGeometry, ChartPoint } from "./stats-geometry.js";
export type StatsVisualMode = "trend" | "composition" | "providers" | "ledgers";
export type ChartSeriesId = "tokens" | "active" | "invocations";
export type LedgerSortKey = "last" | "tokens" | "active" | "input" | "output" | "name";

export interface ChartSeriesDefinition {
  id: ChartSeriesId;
  label: string;
  accentHex: string;
  accessor: (bucket: ExecutionUsageBucketSummary) => number;
  formatter: (value: number) => string;
  signalLabel: string;
}

export interface ChartZoomRange {
  start: number;
  end: number;
}

export const PANEL_CLASS = "relative overflow-hidden rounded-[1.9rem] border border-black/[0.06] bg-white/70 p-6 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]";
export const SUBPANEL_CLASS = "rounded-[1.45rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)]";
export const CHIP_CLASS = "rounded-full border border-black/[0.06] bg-white/70 shadow-[0_1px_3px_rgba(0,0,0,0.04)] backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/55 dark:shadow-[0_1px_3px_rgba(0,0,0,0.18)]";
export const INPUT_CLASS = "h-11 rounded-2xl border border-black/[0.06] bg-white/72 px-4 text-sm text-slate-700 outline-none transition-colors focus:border-signal-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-200";
export const LEDGER_ROW_CLASS = "group rounded-[1.5rem] border border-black/[0.05] bg-white/68 p-4 shadow-[0_10px_24px_rgba(15,23,42,0.045)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-signal-500/18 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] dark:border-white/[0.05] dark:bg-void-900/35 dark:shadow-[0_12px_28px_rgba(0,0,0,0.2)] dark:hover:bg-void-900/45";
export const LEDGER_ROW_MODERN_CLASS = "group relative overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-6 shadow-[0_8px_32px_rgba(15,23,42,0.05)] backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1 hover:border-signal-500/30 hover:shadow-[0_18px_48px_rgba(0,224,160,0.12)] dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_12px_32px_rgba(0,0,0,0.25)] dark:hover:border-signal-500/40 dark:hover:bg-void-800/80";

export const CHART_SERIES: ChartSeriesDefinition[] = [
  {
    id: "tokens",
    label: "Tokens",
    accentHex: "#00E0A0",
    accessor: (bucket) => bucket.usage.totalTokens,
    formatter: formatTokens,
    signalLabel: "Throughput",
  },
  {
    id: "active",
    label: "Active Time",
    accentHex: "#FFB800",
    accessor: (bucket) => bucket.usage.activeTimeMs,
    formatter: formatDuration,
    signalLabel: "Latency",
  },
  {
    id: "invocations",
    label: "Invocations",
    accentHex: "#0EA5E9",
    accessor: (bucket) => bucket.usage.invocationCount,
    formatter: (value) => value.toLocaleString(),
    signalLabel: "Volume",
  },
];

export const RangeToggle: FunctionComponent<{
  activeWindow: ProjectStatsWindow | string;
  customFrom: string;
  customTo: string;
  onSelectPreset: (value: Exclude<ProjectStatsWindow, "custom">) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
  onApplyCustom: () => void;
}> = ({
  activeWindow,
  customFrom,
  customTo,
  onSelectPreset,
  onCustomFromChange,
  onCustomToChange,
  onApplyCustom,
}) => (
  <div className="flex flex-col gap-4">
    <div className={`inline-flex flex-wrap p-1 ${CHIP_CLASS}`}>
      {(["24h", "7d", "30d", "all"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelectPreset(value)}
          className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-all ${
            activeWindow === value
              ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
              : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
          }`}
        >
          {value === "all" ? "All time" : value}
        </button>
      ))}
      <button
        type="button"
        onClick={onApplyCustom}
        className={`rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] transition-all ${
          activeWindow === "custom"
            ? "bg-void-900 text-white shadow-[0_12px_30px_rgba(15,23,42,0.18)] dark:bg-white dark:text-void-900"
            : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
        }`}
      >
        Custom
      </button>
    </div>
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
      <input
        type="date"
        value={customFrom}
        onInput={(event) => onCustomFromChange((event.currentTarget as HTMLInputElement).value)}
        className={INPUT_CLASS}
      />
      <input
        type="date"
        value={customTo}
        onInput={(event) => onCustomToChange((event.currentTarget as HTMLInputElement).value)}
        className={INPUT_CLASS}
      />
      <button
        type="button"
        onClick={onApplyCustom}
        className="inline-flex h-11 items-center justify-center rounded-2xl bg-white/78 px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 dark:bg-white dark:text-void-900"
      >
        Apply
      </button>
    </div>
  </div>
);

export const ViewToggle: FunctionComponent<{
  value: StatsVisualMode;
  onChange: (value: StatsVisualMode) => void;
}> = ({ value, onChange }) => {
  const modes: Array<{ id: StatsVisualMode; label: string; icon: any }> = [
    { id: "trend", label: "Trend", icon: BarChart3 },
    { id: "composition", label: "Composition", icon: PieChart },
    { id: "providers", label: "Providers", icon: ShieldCheck },
    { id: "ledgers", label: "Ledgers", icon: Layers3 },
  ];

  return (
    <div className={`inline-flex p-1 ${CHIP_CLASS}`}>
      {modes.map((mode) => {
        const Icon = mode.icon;
        return (
          <button
            key={mode.id}
            type="button"
            onClick={() => onChange(mode.id)}
            className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] transition-all ${
              value === mode.id
                ? "bg-slate-900 text-white shadow-[0_14px_32px_rgba(15,23,42,0.16)] dark:bg-white dark:text-slate-900"
                : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};

export const SignalMetricCard: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  accentHex: string;
  hoverTint: string;
  sparkline: number[];
  signalLabel: string;
}> = ({ label, value, detail, accentHex, sparkline, signalLabel }) => (
  <StatsCard
    title={label}
    value={value}
    trend={
      <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
        {signalLabel}
      </div>
    }
    // We map hex to known accent if possible, or just pass children
    accent={accentHex === "#00E0A0" ? "signal" : accentHex === "#FFB800" ? "amber" : "cyan"}
  >
    <Sparkline points={sparkline} color={accentHex} />
    <div className="mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
        {detail}
      </div>
    </div>
  </StatsCard>
);

export const TokenChip: FunctionComponent<{
  icon: ComponentType<any>;
  label: string;
  value: number | string;
  tone: string;
}> = ({ icon: Icon, label, value, tone }) => (
  <div className={`group relative inline-flex items-center gap-2 overflow-hidden rounded-[14px] border px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_2px_8px_rgba(0,0,0,0.04)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.8),0_4px_12px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_4px_12px_rgba(0,0,0,0.2)] ${tone}`}>
    <div className="relative flex items-center gap-1.5 opacity-80 transition-opacity group-hover:opacity-100">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
      <span className="text-[10px] font-bold uppercase tracking-[0.16em]">{label}</span>
    </div>
    <div className="relative text-[11px] font-black tracking-wide text-slate-900 drop-shadow-sm transition-all group-hover:drop-shadow-md dark:text-white">
      {typeof value === "number" ? formatTokens(value) : value}
    </div>
  </div>
);

export function getProviderIcon(provider: string | null | undefined): { icon: ComponentType<any>; bg: string; text: string } {
  const p = (provider || "").toLowerCase();
  if (p.includes("gemini")) return { icon: Sparkles, bg: "bg-indigo-500/10", text: "text-indigo-600 dark:text-indigo-400" };
  if (p.includes("claude")) return { icon: Brain, bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400" };
  if (p.includes("codex")) return { icon: Terminal, bg: "bg-cyan-500/10", text: "text-cyan-600 dark:text-cyan-400" };
  if (p.includes("jules")) return { icon: Layers3, bg: "bg-signal-500/10", text: "text-signal-600 dark:text-signal-400" };
  return { icon: Bot, bg: "bg-slate-500/10", text: "text-slate-600 dark:text-slate-400" };
}

export const TokenFlowBar: FunctionComponent<{
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}> = ({ input, cached, output, reasoning, total }) => {
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-black/[0.05] dark:bg-white/[0.05]" />;
  const inPct = (input / total) * 100;
  const cachedPct = (cached / total) * 100;
  const outPct = (output / total) * 100;
  const reasonPct = (reasoning / total) * 100;

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.05]">
      {inPct > 0 && <div className="h-full bg-signal-500 transition-all duration-500" style={{ width: `${inPct}%` }} title={`Input: ${inPct.toFixed(1)}%`} />}
      {cachedPct > 0 && <div className="h-full bg-cyan-500 transition-all duration-500" style={{ width: `${cachedPct}%` }} title={`Cached: ${cachedPct.toFixed(1)}%`} />}
      {outPct > 0 && <div className="h-full bg-amber-500 transition-all duration-500" style={{ width: `${outPct}%` }} title={`Output: ${outPct.toFixed(1)}%`} />}
      {reasonPct > 0 && <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${reasonPct}%` }} title={`Reasoning: ${reasonPct.toFixed(1)}%`} />}
    </div>
  );
};

export const ChurnFlowBar: FunctionComponent<{
  insertions: number;
  deletions: number;
}> = ({ insertions, deletions }) => {
  const total = insertions + deletions;
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-black/[0.05] dark:bg-white/[0.05]" />;
  const inPct = (insertions / total) * 100;
  const delPct = (deletions / total) * 100;

  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-black/[0.05] dark:bg-white/[0.05]">
      {inPct > 0 && <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${inPct}%` }} title={`Insertions: ${inPct.toFixed(1)}%`} />}
      {delPct > 0 && <div className="h-full bg-rose-500 transition-all duration-500" style={{ width: `${delPct}%` }} title={`Deletions: ${delPct.toFixed(1)}%`} />}
    </div>
  );
};

export const SeriesLegendButton: FunctionComponent<{
  series: ChartSeriesDefinition;
  active: boolean;
  currentValue: number;
  disabled?: boolean;
  onToggle: () => void;
}> = ({ series, active, currentValue, disabled = false, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    className={`rounded-[1.25rem] border px-4 py-3 text-left transition-all ${
      active
        ? `${SUBPANEL_CLASS} border-signal-500/18`
        : "rounded-[1.25rem] border border-black/[0.05] bg-white/60 px-4 py-3 text-left opacity-72 backdrop-blur-xl hover:opacity-100 dark:border-white/[0.05] dark:bg-void-900/30"
    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
  >
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.accentHex }} />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{series.label}</span>
    </div>
    <div className="mt-3 flex items-end justify-between gap-4">
      <div className="text-lg font-black text-slate-900 dark:text-white">{series.formatter(currentValue)}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{series.signalLabel}</div>
    </div>
  </button>
);


export const DonutCard: FunctionComponent<{
  title: string;
  eyebrow: string;
  description: string;
  centerValue: string;
  centerLabel: string;
  segments: SegmentDefinition[];
}> = ({ title, eyebrow, description, centerValue, centerLabel, segments }) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const slices = useMemo(() => buildDonutSlices(segments), [segments]);
  const activeSegment = hoveredIndex === null ? null : slices[hoveredIndex] || null;

  useLayoutEffect(() => {
    if (!cardRef.current || !wheelRef.current) {
      return;
    }

    const items = Array.from(cardRef.current.querySelectorAll("[data-donut-item]"));
    const sliceNodes = Array.from(cardRef.current.querySelectorAll("[data-donut-slice]"));
    const timeline = gsap.timeline();
    timeline
      .fromTo(wheelRef.current, { opacity: 0, scale: 0.84, rotate: -14 }, { opacity: 1, scale: 1, rotate: 0, duration: 0.85, ease: "power4.out" })
      .fromTo(sliceNodes, { opacity: 0, scale: 0.86, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.42, stagger: 0.05, ease: "power3.out" }, "-=0.52")
      .fromTo(items, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power3.out" }, "-=0.3");
    return () => timeline.kill();
  }, [segments.length]);

  return (
    <div ref={cardRef} className={`${PANEL_CLASS} h-full p-6`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/[0.08] to-transparent dark:via-white/[0.14]" />
      <div className="relative flex h-full flex-col gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">{eyebrow}</div>
          <div className="mt-2 text-2xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
          <div className="flex items-center justify-center">
            <div className="relative h-60 w-60">
              <svg
                ref={wheelRef}
                viewBox="0 0 240 240"
                className="h-full w-full overflow-visible"
              >
                <defs>
                  <filter id="stats-donut-glow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="8" result="blur" />
                    <feColorMatrix in="blur" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.28 0" />
                    <feBlend in="SourceGraphic" />
                  </filter>
                </defs>
                <circle cx="120" cy="120" r="103" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.08)" />
                {slices.map((slice, index) => {
                  const radians = ((slice.midAngle - 90) * Math.PI) / 180;
                  const offsetX = hoveredIndex === index ? Math.cos(radians) * 7 : 0;
                  const offsetY = hoveredIndex === index ? Math.sin(radians) * 7 : 0;
                  return (
                    <path
                      data-donut-slice
                      key={slice.label}
                      d={slice.path}
                      fill={slice.color}
                      stroke="rgba(255,255,255,0.12)"
                      strokeWidth={hoveredIndex === index ? 3 : 1.2}
                      filter={hoveredIndex === index ? "url(#stats-donut-glow)" : undefined}
                      style={{
                        transform: `translate(${offsetX}px, ${offsetY}px)`,
                        transformOrigin: "120px 120px",
                        opacity: hoveredIndex === null || hoveredIndex === index ? 1 : 0.58,
                        transition: "transform 220ms ease, opacity 220ms ease, stroke-width 220ms ease",
                      }}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    />
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-[24%] rounded-full border border-black/[0.05] bg-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/88 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_12px_28px_rgba(0,0,0,0.28)]" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-3xl font-black tracking-tight text-slate-900 dark:text-white">
                  {activeSegment ? formatTokens(activeSegment.value) : centerValue}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
                  {activeSegment ? activeSegment.label : centerLabel}
                </div>
                <div className="mt-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                  {activeSegment ? `${formatPercent(activeSegment.share)} of visible volume` : `${segments.length} lanes`}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
                No telemetry landed in this composition yet.
              </div>
            ) : slices.map((segment, index) => {
              return (
                <div
                  key={segment.label}
                  data-donut-item
                  className={`${SUBPANEL_CLASS} transition-transform duration-300 ${hoveredIndex === index ? "translate-x-1 border-white/[0.12] dark:border-white/[0.12]" : ""}`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span className={`truncate text-sm font-semibold ${segment.textClassName}`}>{segment.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-slate-400 dark:text-slate-500">
                        {formatPercent(segment.share)} of visible volume
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-black text-slate-900 dark:text-white">{formatTokens(segment.value)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">tokens</div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 rounded-full bg-black/[0.05] dark:bg-white/[0.06]">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(6, segment.share)}%`,
                        backgroundColor: segment.color,
                        opacity: hoveredIndex === null || hoveredIndex === index ? 1 : 0.72,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export const PurposeRibbon: FunctionComponent<{
  purposes: ExecutionStatsEntitySummary[];
}> = ({ purposes }) => (
  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
    {purposes.slice(0, 4).map((purpose) => {
      const config = getPurposeConfig(purpose.id);
      return (
        <StatsCard
          key={purpose.id}
          title={purpose.label.replace(/_/g, " ")}
          value={formatTokens(purpose.usage.totalTokens)}
          description={`${formatDuration(purpose.usage.activeTimeMs)} active time`}
          icon={config.icon}
          accent={config.accent}
        >
          <div className="mt-4 flex flex-wrap gap-2">
            <TokenChip icon={ArrowDownRight} label="In" value={purpose.usage.inputTokens} tone="border-black/[0.06] bg-white/72 text-slate-600 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300" />
            <TokenChip icon={ArrowUpRight} label="Out" value={purpose.usage.outputTokens} tone="border-black/[0.06] bg-white/72 text-slate-600 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300" />
          </div>
        </StatsCard>
      );
    })}
  </div>
);

export const StudioHeader: FunctionComponent<{
  icon: typeof Activity | typeof PieChart | typeof ShieldCheck | typeof Layers3;
  eyebrow: string;
  title: string;
  description: string;
}> = ({ icon: Icon, eyebrow, title, description }) => (
  <div className="max-w-3xl">
    <div className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/72 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 dark:border-white/[0.06] dark:bg-void-900/55 dark:text-slate-300">
      <Icon className="h-3.5 w-3.5 text-signal-500" strokeWidth={2.2} />
      {eyebrow}
    </div>
    <div className="mt-4 text-3xl font-black tracking-tight text-slate-900 dark:text-white">{title}</div>
    <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</div>
  </div>
);


export const SortButton: FunctionComponent<{
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, active, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-full px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-all ${
      active
        ? "bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.12)] dark:bg-white dark:text-void-900"
        : `${CHIP_CLASS} text-slate-500 dark:text-slate-300`
    }`}
  >
    {label}
  </button>
);
