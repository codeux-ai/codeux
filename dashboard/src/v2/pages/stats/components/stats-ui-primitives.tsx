import { buildDonutSlices } from "./stats-geometry.js";
import type { FunctionComponent, ComponentType, JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import "../styles/stats-theme.css";
import {
  Activity,
  ArrowDown,
  ArrowDownRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Brain,
  Code2,
  Clock3,
  Cpu,
  Database,
  GitBranch,
  Layers3,
  PieChart,
  ShieldCheck,
  Sparkles,
  TimerReset,
  Zap,
  Workflow,
  Bot,
  Terminal,
  type LucideIcon,
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
  formatStatsDuration,
  formatPercent,
  formatDateTime,
  NUMBER_FORMATTER,
  sumUsage,
  createSeries,
  getPurposeConfig,
} from "../stats-utils.js";
import { useInteractionTokens } from "../../../lib/motion/tokens.js";

import type { DonutSliceGeometry, ChartPoint } from "./stats-geometry.js";
export type StatsVisualMode = "trend" | "composition" | "models" | "reliability" | "ledgers" | "system";
export type ChartSeriesId = "tokens" | "active" | "invocations";
export type LedgerSortKey = "last" | "tokens" | "active" | "input" | "output" | "name" | "p50" | "p95";

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

export const PANEL_CLASS = "stats-surface-panel relative min-w-0 overflow-hidden rounded-[var(--stats-panel-radius)] p-5 transition-colors duration-150 motion-reduce:transition-none";
export const SUBPANEL_CLASS = "stats-surface-subpanel min-w-0 rounded-[var(--stats-subpanel-radius)] p-4 transition-colors duration-150 motion-reduce:transition-none";
export const CHIP_CLASS = "stats-surface-chip rounded-[var(--stats-chip-radius)] transition-[background-color,border-color,color] duration-150 motion-reduce:transition-none";
export const CONTROL_FOCUS_CLASS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--stats-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--stats-focus-ring-offset)]";
export const INPUT_CLASS = `stats-surface-input h-11 rounded-[var(--stats-control-radius)] px-4 text-sm text-[color:var(--stats-value-color)] outline-none transition-[background-color,border-color,color] duration-150 placeholder:text-[color:var(--stats-detail-color)] focus:border-[color:var(--stats-focus-ring)] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${CONTROL_FOCUS_CLASS}`;
export const LEDGER_ROW_CLASS = "stats-surface-subpanel group rounded-[var(--stats-subpanel-radius)] p-4 transition-[background-color,border-color] duration-150 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-subpanel-hover)] motion-reduce:transition-none";
export const LEDGER_ROW_MODERN_CLASS = "stats-surface-panel group relative min-w-0 overflow-hidden rounded-[var(--stats-panel-radius)] p-5 transition-colors duration-150 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-panel-hover)] motion-reduce:transition-none";
export const TEXT_LABEL_CLASS = "text-[color:var(--stats-label-color)]";
export const TEXT_DETAIL_CLASS = "text-[color:var(--stats-detail-color)]";
export const TEXT_VALUE_CLASS = "text-[color:var(--stats-value-color)]";
export const TRACK_CLASS = "bg-[color:var(--stats-quiet-track)]";
export const DASHED_EMPTY_CLASS = "rounded-[var(--stats-subpanel-radius)] border border-dashed border-[color:var(--stats-card-border)] px-4 py-8 text-center text-sm text-[color:var(--stats-label-color)]";
export const STATUS_TONE_CLASS = {
  signal: "border-[color:var(--stats-status-signal-border)] bg-[color:var(--stats-accent-signal-fill)] text-[color:var(--stats-signal-text)]",
  positive: "border-[color:var(--stats-status-positive-border)] bg-[color:var(--stats-accent-emerald-fill)] text-[color:var(--stats-positive-text)]",
  warning: "border-[color:var(--stats-status-warning-border)] bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-warning-text)]",
  negative: "border-[color:var(--stats-status-negative-border)] bg-[color:var(--stats-accent-rose-fill)] text-[color:var(--stats-negative-text)]",
  cyan: "border-[color:var(--stats-status-cyan-border)] bg-[color:var(--stats-accent-cyan-fill)] text-[color:var(--stats-accent-cyan)]",
  neutral: "border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-chip)] text-[color:var(--stats-detail-color)]",
} as const;
export const TAB_ACTIVE_CLASS = "border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-surface-control-active)] text-[color:var(--stats-control-text-active)]";
export const TAB_IDLE_CLASS = "text-[color:var(--stats-detail-color)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-value-color)]";
export const TAB_COUNT_ACTIVE_CLASS = "bg-[color:var(--stats-surface-control-active-strong)] text-[color:var(--stats-control-text-active-strong)]";
export const TAB_COUNT_IDLE_CLASS = "text-[color:var(--stats-detail-color)]";
const CONTROL_BASE_CLASS = `inline-flex min-w-0 items-center justify-center rounded-[var(--stats-control-radius)] border px-3 text-[11px] font-bold uppercase tracking-[0.12em] transition-[background-color,border-color,color] duration-150 motion-reduce:transition-none ${CONTROL_FOCUS_CLASS}`;
const CONTROL_IDLE_CLASS = "border-transparent text-[color:var(--stats-control-text)] hover:bg-[color:var(--stats-surface-chip-hover)] hover:text-[color:var(--stats-control-text-hover)]";
const CONTROL_ACTIVE_CLASS = "border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-surface-control-active)] text-[color:var(--stats-control-text-active)]";
const CONTROL_ACTIVE_STRONG_CLASS = "border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-surface-control-active-strong)] text-[color:var(--stats-control-text-active-strong)]";

export const CHART_SERIES: ChartSeriesDefinition[] = [
  {
    id: "tokens",
    label: "Tokens",
    accentHex: "var(--stats-accent-signal)",
    accessor: (bucket) => bucket.usage.totalTokens,
    formatter: formatTokens,
    signalLabel: "Throughput",
  },
  {
    id: "active",
    label: "Active Time",
    accentHex: "#FFB800",
    accessor: (bucket) => bucket.usage.activeTimeMs,
    formatter: formatStatsDuration,
    signalLabel: "Latency",
  },
  {
    id: "invocations",
    label: "Invocations",
    accentHex: "#0EA5E9",
    accessor: (bucket) => bucket.usage.invocationCount,
    formatter: (value) => NUMBER_FORMATTER.format(value),
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
    <div className={`inline-flex flex-wrap gap-1 p-1 ${CHIP_CLASS}`}>
      {(["1h", "24h", "7d", "30d", "all"] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onSelectPreset(value)}
          aria-pressed={activeWindow === value}
          className={`${CONTROL_BASE_CLASS} min-h-9 px-4 py-2 ${
            activeWindow === value
              ? CONTROL_ACTIVE_STRONG_CLASS
              : CONTROL_IDLE_CLASS
          }`}
        >
          {value === "all" ? "All time" : value}
        </button>
      ))}
      <button
        type="button"
        onClick={onApplyCustom}
        aria-pressed={activeWindow === "custom"}
        className={`${CONTROL_BASE_CLASS} min-h-9 px-4 py-2 ${
          activeWindow === "custom"
            ? CONTROL_ACTIVE_STRONG_CLASS
            : CONTROL_IDLE_CLASS
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
        className={`inline-flex h-11 items-center justify-center rounded-[var(--stats-control-radius)] border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-control-active)] px-4 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-control-text-active)] transition-[background-color,border-color,color] duration-150 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-control-active-strong)] motion-reduce:transition-none ${CONTROL_FOCUS_CLASS}`}
      >
        Apply
      </button>
    </div>
  </div>
);

export const ViewToggle: FunctionComponent<{
  value: StatsVisualMode;
  onChange: (value: StatsVisualMode) => void;
  ariaLabel?: string;
  className?: string;
  controlsId?: string;
}> = ({ value, onChange, ariaLabel = "Analytics modes", className = "", controlsId }) => {
  const tokens = useInteractionTokens();
  const buttonRefs = useRef<Partial<Record<StatsVisualMode, HTMLButtonElement | null>>>({});
  const modes: Array<{ id: StatsVisualMode; label: string; accessibleLabel: string; icon: LucideIcon }> = [
    { id: "trend", label: "Trend", accessibleLabel: "Trend", icon: BarChart3 },
    { id: "composition", label: "Composition", accessibleLabel: "Composition", icon: PieChart },
    { id: "models", label: "Models", accessibleLabel: "Models", icon: Cpu },
    { id: "reliability", label: "Providers", accessibleLabel: "Providers", icon: ShieldCheck },
    { id: "ledgers", label: "Ledgers", accessibleLabel: "Ledgers", icon: Layers3 },
    { id: "system", label: "System", accessibleLabel: "System", icon: Terminal },
  ];
  const focusMode = (index: number) => {
    const nextMode = modes[index];
    if (!nextMode) {
      return;
    }

    onChange(nextMode.id);
    buttonRefs.current[nextMode.id]?.focus();
  };

  const handleKeyDown = (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const activeElement = document.activeElement;
    const focusedIndex = modes.findIndex((mode) => buttonRefs.current[mode.id] === activeElement);
    const currentIndex = focusedIndex >= 0 ? focusedIndex : modes.findIndex((mode) => mode.id === value);
    if (event.key === "Home") {
      focusMode(0);
      return;
    }
    if (event.key === "End") {
      focusMode(modes.length - 1);
      return;
    }

    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
    focusMode((currentIndex + delta + modes.length) % modes.length);
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
      className={`flex w-full max-w-full min-w-0 flex-wrap gap-1 p-1 ${CHIP_CLASS} ${className}`.trim()}
    >
      <span className="sr-only" aria-live="polite">
        Selected analytics mode: {modes.find((mode) => mode.id === value)?.accessibleLabel ?? value}.
      </span>
      {modes.map((mode) => {
        const Icon = mode.icon;
        const selected = value === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            ref={(node) => {
              buttonRefs.current[mode.id] = node;
            }}
            onClick={() => onChange(mode.id)}
            aria-pressed={selected}
            aria-controls={controlsId}
            aria-label={mode.accessibleLabel}
            title={mode.label}
            data-selection-motion="selectionMovement"
            className={`${CONTROL_BASE_CLASS} min-h-10 min-w-10 flex-[1_1_calc(33.333%-0.25rem)] gap-2 px-2 py-2 sm:min-w-[7rem] sm:flex-[1_1_auto] sm:px-4 ${
              selected
                ? CONTROL_ACTIVE_CLASS
                : CONTROL_IDLE_CLASS
            }`}
            style={{
              transitionDuration: tokens.selectionMovement.duration,
              transitionTimingFunction: tokens.selectionMovement.ease,
            }}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="hidden min-w-0 truncate sm:inline">{mode.label}</span>
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
      <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)] ${CHIP_CLASS}`}>
        {signalLabel}
      </div>
    }
    // We map hex to known accent if possible, or just pass children
    accent={accentHex === "var(--stats-accent-signal)" ? "signal" : accentHex === "#FFB800" ? "amber" : "cyan"}
  >
    <div className="relative z-10 mt-4 h-16 rounded-[var(--stats-control-radius)]">
      <Sparkline points={sparkline} color={accentHex} className="absolute inset-0 h-full w-full pointer-events-none" />
    </div>
    <div className="mt-4 flex flex-col gap-1 border-t border-[color:var(--stats-card-border)] pt-4">
      <div className="text-xs font-medium text-[color:var(--stats-detail-color)]">
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
  <div className={`relative inline-flex min-w-0 items-center gap-2 overflow-hidden rounded-[var(--stats-chip-radius)] border px-3 py-1.5 transition-[background-color,border-color,color] duration-150 motion-reduce:transition-none ${tone}`}>
    <div className="relative flex min-w-0 items-center gap-1.5 opacity-85">
      <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
      <span className="truncate text-[10px] font-bold uppercase tracking-[0.14em]">{label}</span>
    </div>
    <div className="relative shrink-0 text-[11px] font-semibold text-[color:var(--stats-value-color)]">
      {typeof value === "number" ? formatTokens(value) : value}
    </div>
  </div>
);

export function getProviderIcon(provider: string | null | undefined): { icon: ComponentType<any>; bg: string; text: string } {
  const p = (provider || "").toLowerCase();
  if (p.includes("gemini")) return { icon: Sparkles, bg: "bg-[color:var(--stats-accent-cyan-fill)]", text: "text-[color:var(--stats-accent-cyan)]" };
  if (p.includes("claude")) return { icon: Brain, bg: "bg-[color:var(--stats-accent-amber-fill)]", text: "text-[color:var(--stats-warning-text)]" };
  if (p.includes("codex")) return { icon: Terminal, bg: "bg-[color:var(--stats-accent-cyan-fill)]", text: "text-[color:var(--stats-accent-cyan)]" };
  if (p.includes("jules")) return { icon: Layers3, bg: "bg-[color:var(--stats-accent-signal-fill)]", text: "text-[color:var(--stats-signal-text)]" };
  if (p.includes("qwen-code")) return { icon: Code2, bg: "bg-[color:var(--stats-accent-signal-fill)]", text: "text-[color:var(--stats-signal-text)]" };
  if (p.includes("opencode")) return { icon: GitBranch, bg: "bg-[color:var(--stats-accent-emerald-fill)]", text: "text-[color:var(--stats-positive-text)]" };
  if (p.includes("antigravity")) return { icon: Zap, bg: "bg-[color:var(--stats-accent-amber-fill)]", text: "text-[color:var(--stats-warning-text)]" };
  return { icon: Bot, bg: "bg-[color:var(--stats-surface-chip)]", text: TEXT_DETAIL_CLASS };
}

export const TokenFlowBar: FunctionComponent<{
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}> = ({ input, cached, output, reasoning, total }) => {
  const summary = total > 0
    ? `Input ${formatTokens(input)}; cached ${formatTokens(cached)}; output ${formatTokens(output)}; reasoning ${formatTokens(reasoning)}; total ${formatTokens(total)}.`
    : "No token flow data available.";

  if (total <= 0) return <div role="img" aria-label={summary} className={`h-2 w-full rounded-full ${TRACK_CLASS}`} />;
  const inPct = (input / total) * 100;
  const cachedPct = (cached / total) * 100;
  const outPct = (output / total) * 100;
  const reasonPct = (reasoning / total) * 100;

  return (
    <div role="img" aria-label={summary} className={`flex h-2 w-full overflow-hidden rounded-full ${TRACK_CLASS}`}>
      {inPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-signal-text)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${inPct}%` }} title={`Input: ${inPct.toFixed(1)}%`} />}
      {cachedPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-accent-cyan)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${cachedPct}%` }} title={`Cached: ${cachedPct.toFixed(1)}%`} />}
      {outPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-warning-text)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${outPct}%` }} title={`Output: ${outPct.toFixed(1)}%`} />}
      {reasonPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-negative-text)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${reasonPct}%` }} title={`Reasoning: ${reasonPct.toFixed(1)}%`} />}
    </div>
  );
};

export const ChurnFlowBar: FunctionComponent<{
  insertions: number;
  deletions: number;
}> = ({ insertions, deletions }) => {
  const total = insertions + deletions;
  const summary = total > 0
    ? `Code churn mix: ${insertions.toLocaleString()} insertions, ${deletions.toLocaleString()} deletions, ${total.toLocaleString()} total changed lines.`
    : "No code churn data available.";

  if (total <= 0) return <div role="img" aria-label={summary} className={`h-2 w-full rounded-full ${TRACK_CLASS}`} />;
  const inPct = (insertions / total) * 100;
  const delPct = (deletions / total) * 100;

  return (
    <div role="img" aria-label={summary} className={`flex h-2 w-full overflow-hidden rounded-full ${TRACK_CLASS}`}>
      {inPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-positive-text)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${inPct}%` }} title={`Insertions: ${inPct.toFixed(1)}%`} />}
      {delPct > 0 && <div aria-hidden="true" className="h-full bg-[color:var(--stats-negative-text)] motion-safe:transition-all motion-safe:duration-500" style={{ width: `${delPct}%` }} title={`Deletions: ${delPct.toFixed(1)}%`} />}
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
    aria-pressed={active}
    className={`rounded-[var(--stats-subpanel-radius)] border px-4 py-3 text-left transition-[background-color,border-color,opacity] duration-150 motion-reduce:transition-none ${CONTROL_FOCUS_CLASS} ${
      active
        ? `${SUBPANEL_CLASS} border-[color:var(--stats-control-border-active)]`
        : "border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-subpanel)] opacity-75 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-subpanel-hover)] hover:opacity-100"
    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
  >
    <div className="flex items-center gap-3">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: series.accentHex }} />
      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{series.label}</span>
    </div>
    <div className="mt-3 flex items-end justify-between gap-4">
      <div className="text-base font-semibold text-[color:var(--stats-value-color)]">{series.formatter(currentValue)}</div>
      <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">{series.signalLabel}</div>
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
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const slices = useMemo(() => buildDonutSlices(segments), [segments]);
  const activeSegment = hoveredIndex === null ? null : slices[hoveredIndex] || null;

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(media.matches);

    updatePreference();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", updatePreference);
      return () => media.removeEventListener("change", updatePreference);
    }

    media.addListener(updatePreference);
    return () => media.removeListener(updatePreference);
  }, []);

  useLayoutEffect(() => {
    if (!cardRef.current || !wheelRef.current || prefersReducedMotion) {
      return;
    }

    const items = Array.from(cardRef.current.querySelectorAll("[data-donut-item]"));
    const sliceNodes = Array.from(cardRef.current.querySelectorAll("[data-donut-slice]"));
    const timeline = gsap.timeline();
    timeline.fromTo(
      wheelRef.current,
      { opacity: 0, scale: 0.84, rotate: -14 },
      { opacity: 1, scale: 1, rotate: 0, duration: 0.85, ease: "power4.out" },
    );
    if (sliceNodes.length > 0) {
      timeline.fromTo(
        sliceNodes,
        { opacity: 0, scale: 0.86, transformOrigin: "50% 50%" },
        { opacity: 1, scale: 1, duration: 0.42, stagger: 0.05, ease: "power3.out" },
        "-=0.52",
      );
    }
    if (items.length > 0) {
      timeline.fromTo(
        items,
        { opacity: 0, y: 16 },
        { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power3.out" },
        "-=0.3",
      );
    }
    return () => timeline.kill();
  }, [prefersReducedMotion, segments.length]);

  return (
    <div ref={cardRef} className={`${PANEL_CLASS} h-full p-6`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[color:var(--stats-card-border)]" />
      <div className="relative flex h-full flex-col gap-6">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">{eyebrow}</div>
          <div className="mt-2 text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
          <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{description}</div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:items-center">
          <div className="flex items-center justify-center">
            <div className="relative h-60 w-60">
              <div className="sr-only" role="region" aria-label={title}>
                {description}. {segments.map(s => `${s.label}: ${s.value}`).join(", ")}
              </div>
              <svg
                ref={wheelRef}
                viewBox="0 0 240 240"
                className="h-full w-full overflow-visible"
                aria-hidden="true"
              >
                <circle cx="120" cy="120" r="103" fill="var(--stats-surface-subpanel)" stroke="var(--stats-border-hairline)" />
                {slices.map((slice, index) => {
                  return (
                    <path
                      data-donut-slice
                      key={slice.label}
                      d={slice.path}
                      fill={slice.color}
                      stroke="var(--stats-surface-panel)"
                      strokeWidth={hoveredIndex === index ? 2 : 1}
                      style={{
                        transformOrigin: "120px 120px",
                        opacity: hoveredIndex === null || hoveredIndex === index ? 0.9 : 0.38,
                        transition: prefersReducedMotion ? "none" : "opacity 180ms ease, stroke-width 180ms ease",
                      }}
                      onMouseEnter={() => setHoveredIndex(index)}
                      onMouseLeave={() => setHoveredIndex(null)}
                    />
                  );
                })}
              </svg>
              <div className="pointer-events-none absolute inset-[24%] rounded-full border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-panel)]" />
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">
                  {activeSegment ? formatTokens(activeSegment.value) : centerValue}
                </div>
                <div className="mt-1 max-w-[7.5rem] break-words text-center text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
                  {activeSegment ? activeSegment.label : centerLabel}
                </div>
                <div className="mt-2 text-[11px] font-mono text-[color:var(--stats-detail-color)]">
                  {activeSegment ? `${formatPercent(activeSegment.share)} of visible volume` : `${segments.length} lanes`}
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            {segments.length === 0 ? (
              <div className={DASHED_EMPTY_CLASS}>
                No telemetry landed in this composition yet.
              </div>
            ) : slices.map((segment, index) => {
              return (
                <div
                  key={segment.label}
                  data-donut-item
                  className={`${SUBPANEL_CLASS} transition-[border-color,background-color] duration-150 ${hoveredIndex === index ? "border-[color:var(--stats-border-strong)] bg-[color:var(--stats-surface-subpanel-hover)]" : ""}`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">#{index + 1}</span>
                        <span className={`min-w-0 break-words text-sm font-semibold ${segment.textClassName}`} title={segment.label}>{segment.label}</span>
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-[color:var(--stats-detail-color)]">
                        {formatPercent(segment.share)} of visible volume
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-[color:var(--stats-value-color)]">{formatTokens(segment.value)}</div>
                      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">tokens</div>
                    </div>
                  </div>
                  <div className={`mt-3 h-1.5 rounded-full ${TRACK_CLASS}`}>
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${Math.max(6, segment.share)}%`,
                        backgroundColor: segment.color,
                        opacity: hoveredIndex === null || hoveredIndex === index ? 0.85 : 0.45,
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
  totalTokens?: number;
  dominantPurposeId?: string | null;
}> = ({ purposes, totalTokens = 0, dominantPurposeId = null }) => {
  const rankedPurposes = [...purposes].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });

  if (rankedPurposes.length === 0) {
    return (
      <div className={DASHED_EMPTY_CLASS}>
        No purpose data for this window.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {rankedPurposes.slice(0, 4).map((purpose) => {
        const config = getPurposeConfig(purpose.id);
        const Icon = config.icon;
        const tokenShare = totalTokens > 0 ? (purpose.usage.totalTokens / totalTokens) * 100 : null;
        const isDominant = dominantPurposeId === purpose.id;
        const accentTextClass: Record<StatsCardAccent, string> = {
          default: TEXT_DETAIL_CLASS,
          signal: "text-[color:var(--stats-signal-text)]",
          amber: "text-[color:var(--stats-warning-text)]",
          cyan: "text-[color:var(--stats-accent-cyan)]",
          rose: "text-[color:var(--stats-negative-text)]",
          emerald: "text-[color:var(--stats-positive-text)]",
        };
        return (
          <div key={purpose.id} className={`${SUBPANEL_CLASS} flex min-h-[9rem] flex-col justify-between p-4`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words text-sm font-semibold capitalize text-[color:var(--stats-value-color)]" title={purpose.label.replace(/_/g, " ")}>
                  {purpose.label.replace(/_/g, " ")}
                </div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                  {purpose.usage.invocationCount.toLocaleString()} calls / {formatStatsDuration(purpose.usage.activeTimeMs)} active
                </div>
              </div>
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] ${accentTextClass[config.accent]}`}>
                <Icon className="h-4 w-4" strokeWidth={2.2} />
              </div>
            </div>
            <div>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-lg font-semibold text-[color:var(--stats-value-color)]">{formatTokens(purpose.usage.totalTokens)}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)]">
                    {tokenShare !== null ? `${formatPercent(tokenShare)} token share` : "No token share"}
                  </div>
                </div>
                {isDominant ? (
                  <div className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                    Dominant
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <TokenChip icon={ArrowDownRight} label="In" value={purpose.usage.inputTokens} tone={STATUS_TONE_CLASS.neutral} />
                <TokenChip icon={ArrowUpRight} label="Out" value={purpose.usage.outputTokens} tone={STATUS_TONE_CLASS.neutral} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const StudioHeader: FunctionComponent<{
  icon: typeof Activity | typeof PieChart | typeof ShieldCheck | typeof Layers3;
  eyebrow: string;
  title: string;
  description: string;
}> = ({ icon: Icon, eyebrow, title, description }) => (
  <div className="flex max-w-4xl items-start gap-4">
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[color:var(--stats-border-hairline)] bg-[color:var(--stats-surface-chip)] text-[color:var(--stats-signal-text)]">
      <Icon className="h-5 w-5" strokeWidth={2.2} />
    </div>
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--stats-label-color)]">{eyebrow}</div>
      <div className="mt-1 break-words text-xl font-semibold tracking-tight text-[color:var(--stats-value-color)]">{title}</div>
      <div className="mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{description}</div>
    </div>
  </div>
);


export const SortButton: FunctionComponent<{
  label: string;
  active: boolean;
  direction?: "asc" | "desc" | null;
  onClick: () => void;
}> = ({ label, active, direction = null, onClick }) => {
  const directionLabel = active && direction ? `, sorted ${direction === "asc" ? "ascending" : "descending"}` : ", not sorted";
  return (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    aria-label={`${label}${directionLabel}`}
    className={`${CONTROL_BASE_CLASS} gap-1 px-3 py-2 text-[10px] tracking-[0.16em] ${
      active
        ? CONTROL_ACTIVE_STRONG_CLASS
        : `${CHIP_CLASS} ${CONTROL_IDLE_CLASS}`
    }`}
  >
    {label}
    {active && direction ? (
      direction === "desc"
        ? <ArrowDown className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
        : <ArrowUp className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" />
    ) : null}
    <span className="sr-only">{directionLabel}</span>
  </button>
  );
};
