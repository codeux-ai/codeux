import type { FunctionComponent } from "preact";
import { Sparkles, ShieldCheck, Accessibility, Zap, Bug, Code2, Database, FileSearch, FlaskConical, GitBranch, Globe, Hammer, Heart, Layers, LayoutGrid, Lock, Microscope, Monitor, Paintbrush, RefreshCw, Search, Server, Shield, Terminal, TestTube2, Wrench, Settings2, Trash2 } from "lucide-preact";
import type { LucideProps } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { CHIP_CLASS, CONTROL_FOCUS_CLASS, PANEL_CLASS } from "../../pages/stats/components/stats-ui-primitives.js";

export const SUBTASK_SLIDER_MIN = 1;
export const SUBTASK_SLIDER_MAX = 30;

export function clampSubtaskSliderValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 5;
  }
  return Math.min(SUBTASK_SLIDER_MAX, Math.max(SUBTASK_SLIDER_MIN, Math.round(value)));
}

export const IconMap: Record<string, FunctionComponent<LucideProps>> = {
  Sparkles, ShieldCheck, Accessibility, Zap,
  Bug, Code2, Database, FileSearch, FlaskConical,
  GitBranch, Globe, Hammer, Heart, Layers,
  LayoutGrid, Lock, Microscope, Monitor,
  Paintbrush, RefreshCw, Search, Server,
  Shield, Terminal, TestTube2, Wrench,
};

export const TAG_STYLES = [
  { value: "signal", text: "text-signal-500", bg: "bg-signal-500/10", border: "border-signal-500/20", dot: "bg-signal-500" },
  { value: "ember", text: "text-ember-500", bg: "bg-ember-500/10", border: "border-ember-500/20", dot: "bg-ember-500" },
  { value: "green", text: "text-status-green", bg: "bg-status-green/10", border: "border-status-green/20", dot: "bg-status-green" },
  { value: "red", text: "text-status-red", bg: "bg-status-red/10", border: "border-status-red/20", dot: "bg-status-red" },
  { value: "amber", text: "text-status-amber", bg: "bg-status-amber/10", border: "border-status-amber/20", dot: "bg-status-amber" },
  { value: "violet", text: "text-violet-500", bg: "bg-violet-500/10", border: "border-violet-500/20", dot: "bg-violet-500" },
  { value: "cyan", text: "text-cyan-500", bg: "bg-cyan-500/10", border: "border-cyan-500/20", dot: "bg-cyan-500" },
  { value: "rose", text: "text-rose-500", bg: "bg-rose-500/10", border: "border-rose-500/20", dot: "bg-rose-500" },
  { value: "blue", text: "text-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/20", dot: "bg-blue-500" },
  { value: "slate", text: "text-slate-500", bg: "bg-slate-500/10", border: "border-slate-500/20", dot: "bg-slate-500" },
];

export const getTagStyles = (colorVal: string) => {
  const found = TAG_STYLES.find(s => s.value === colorVal);
  if (found) return { ...found, style: {} as import('preact').JSX.CSSProperties };
  // Fallback to CSS variables
  return {
    text: "", bg: "", border: "", dot: "", value: colorVal,
    style: { '--accent': colorVal } as import('preact').JSX.CSSProperties
  };
};

export const ICON_OPTIONS: ReadonlyArray<{ value: string; Icon: FunctionComponent<LucideProps> }> = [
  { value: "Sparkles", Icon: Sparkles },
  { value: "ShieldCheck", Icon: ShieldCheck },
  { value: "Accessibility", Icon: Accessibility },
  { value: "Zap", Icon: Zap },
  { value: "Bug", Icon: Bug },
  { value: "Code2", Icon: Code2 },
  { value: "Database", Icon: Database },
  { value: "FileSearch", Icon: FileSearch },
  { value: "FlaskConical", Icon: FlaskConical },
  { value: "GitBranch", Icon: GitBranch },
  { value: "Globe", Icon: Globe },
  { value: "Hammer", Icon: Hammer },
  { value: "Heart", Icon: Heart },
  { value: "Layers", Icon: Layers },
  { value: "LayoutGrid", Icon: LayoutGrid },
  { value: "Lock", Icon: Lock },
  { value: "Microscope", Icon: Microscope },
  { value: "Monitor", Icon: Monitor },
  { value: "Paintbrush", Icon: Paintbrush },
  { value: "RefreshCw", Icon: RefreshCw },
  { value: "Search", Icon: Search },
  { value: "Server", Icon: Server },
  { value: "Shield", Icon: Shield },
  { value: "Terminal", Icon: Terminal },
  { value: "TestTube2", Icon: TestTube2 },
  { value: "Wrench", Icon: Wrench },
];

/* ═════════════════════════════════════════════════════════════════════ */
/*  Template Card                                                       */
/* ═════════════════════════════════════════════════════════════════════ */
export const TemplateCard: FunctionComponent<{
  template: QuicksprintTemplateRecord;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}> = ({ template, onSelect, onEdit, onDelete }) => {
  const Icon = IconMap[template.icon] || Zap;
  const tagColor = template.categoryColor || "slate";
  const tagStyles = getTagStyles(tagColor);
  const tagAccentStyle = tagStyles.style?.["--accent"]
    ? { color: "var(--accent)", ...tagStyles.style }
    : undefined;
  const sourceDetail = template.isBuiltIn ? "Default Template" : "Custom Template";
  const descriptionId = `quicksprint-template-${template.id}-description`;
  const metaId = `quicksprint-template-${template.id}-meta`;

  return (
    <article
      className={`${PANEL_CLASS} group grid h-[19rem] cursor-pointer grid-rows-[auto_minmax(0,1fr)_auto] gap-5 !overflow-hidden !rounded-[1.45rem] !p-5 transition-[transform,background-color,border-color,box-shadow] before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-[color:var(--stats-card-accent,var(--stats-accent-amber))] before:to-transparent before:opacity-30 hover:border-[color:var(--stats-border-strong)] hover:bg-[color:var(--stats-surface-panel-hover)] hover:shadow-[var(--stats-card-shadow-hover)] motion-safe:hover:-translate-y-0.5`}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        onSelect();
      }}
    >
      <div className="relative z-10 flex min-w-0 items-start gap-3.5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-accent-amber-fill)] text-[color:var(--stats-accent-amber)] shadow-[var(--stats-subpanel-shadow)] transition-colors group-hover:bg-[color:var(--stats-surface-control-active-strong)]">
          <Icon className="h-5 w-5" strokeWidth={2.2} />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
            {sourceDetail}
          </div>
          <h3 className="mt-2 line-clamp-3 min-w-0 text-[1.2rem] font-black leading-[1.08] tracking-tight text-[color:var(--stats-value-color)]">
            {template.name}
          </h3>
        </div>
      </div>

      <p id={descriptionId} className="relative z-10 line-clamp-4 min-w-0 text-[13px] leading-relaxed text-[color:var(--stats-detail-color)]">
        {template.description}
      </p>

      <div className="relative z-10 grid gap-3 border-t border-[color:var(--stats-card-border)] pt-3.5">
        <div id={metaId} className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-w-0 max-w-[13rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase leading-tight tracking-[0.1em] ${CHIP_CLASS} ${tagStyles.text}`}
            style={tagAccentStyle}
            title={template.category}
          >
            <span
              className={`block h-1.5 w-1.5 shrink-0 rounded-full ${tagStyles.dot}`}
              style={tagStyles.style?.["--accent"] ? { backgroundColor: "var(--accent)", ...tagStyles.style } : undefined}
            />
            <span className="truncate">{template.category}</span>
          </span>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${CHIP_CLASS}`}>
            {template.defaultTaskCount} subtask{template.defaultTaskCount !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            aria-label={template.name}
            aria-describedby={`${descriptionId} ${metaId}`}
            onClick={(event) => { event.stopPropagation(); onSelect(); }}
            className={`inline-flex min-h-11 min-w-0 flex-1 items-center justify-between gap-3 rounded-[var(--stats-control-radius)] border border-[color:var(--stats-control-border-active)] bg-[color:var(--stats-surface-control-active)] px-3.5 text-left text-[10px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-control-text-active)] shadow-[var(--stats-control-shadow)] transition-[background-color,border-color,box-shadow,color] hover:bg-[color:var(--stats-surface-control-active-strong)] hover:text-[color:var(--stats-control-text-active-strong)] ${CONTROL_FOCUS_CLASS}`}
          >
            <span className="min-w-0 truncate">Launch</span>
            <span className="shrink-0 text-[color:var(--stats-detail-color)]">Enter</span>
          </button>
          {(onEdit || onDelete) && (
            <div className="flex shrink-0 items-center gap-1 rounded-[var(--stats-control-radius)] border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-chip)] p-1.5 shadow-[var(--stats-subpanel-shadow)]">
              {!template.isBuiltIn && onEdit && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                  aria-label={`Edit ${template.name} template`}
                  className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-[calc(var(--stats-control-radius)-0.25rem)] text-[color:var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-surface-control-active)] hover:text-[color:var(--stats-control-text-active)] ${CONTROL_FOCUS_CLASS}`}
                  title="Edit template"
                >
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  aria-label={`Delete ${template.name} template`}
                  className={`inline-flex min-h-8 min-w-8 items-center justify-center rounded-[calc(var(--stats-control-radius)-0.25rem)] text-[color:var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-accent-rose-fill)] hover:text-[color:var(--stats-negative-text)] ${CONTROL_FOCUS_CLASS}`}
                  title="Delete template"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
};

/* ═════════════════════════════════════════════════════════════════════ */
/*  Subtask Count Slider                                                */
/* ═════════════════════════════════════════════════════════════════════ */
export const SubtaskSlider: FunctionComponent<{
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled = false }) => {
  const displayValue = clampSubtaskSliderValue(value);
  const pct = ((displayValue - SUBTASK_SLIDER_MIN) / (SUBTASK_SLIDER_MAX - SUBTASK_SLIDER_MIN)) * 100;

  return (
    <div className={`select-none ${disabled ? "opacity-55" : ""}`}>
      {/* Large number display */}
      <div className="flex items-baseline gap-2 mb-6">
        <span className={`font-mono text-[3.5rem] font-black leading-none tracking-tighter tabular-nums ${
          disabled ? "text-slate-400 dark:text-slate-500" : "text-slate-900 dark:text-white"
        }`}>
          {String(displayValue).padStart(2, "0")}
        </span>
        <span className={`text-sm font-medium ${disabled ? "text-slate-400 dark:text-slate-500" : "text-slate-400"}`}>
          subtask{displayValue !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Track */}
      <div
        className={`relative h-10 ${disabled ? "cursor-not-allowed pointer-events-none" : "cursor-pointer touch-none"}`}
      >
        <input
          type="range"
          min={SUBTASK_SLIDER_MIN}
          max={SUBTASK_SLIDER_MAX}
          step="1"
          value={displayValue}
          disabled={disabled}
          aria-label="Subtask count"
          aria-valuetext={`${displayValue} subtask${displayValue === 1 ? "" : "s"}`}
          onInput={(e) => onChange(clampSubtaskSliderValue(parseInt((e.target as HTMLInputElement).value, 10)))}
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        />
        {/* Background track */}
        <div className="pointer-events-none absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.06]">
          {/* Fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ember-500 to-ember-400 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Notches */}
        <div className="pointer-events-none absolute top-1/2 left-0 right-0 -translate-y-1/2 flex justify-between px-[2px]">
          {Array.from({ length: SUBTASK_SLIDER_MAX - SUBTASK_SLIDER_MIN + 1 }, (_, i) => {
            const n = SUBTASK_SLIDER_MIN + i;
            const isActive = n <= displayValue;
            const isMajor = n === 1 || n === 5 || n === 10 || n === 15 || n === 20 || n === 25 || n === 30;
            return (
              <div
                key={n}
                className={`rounded-full transition-all ${
                  isMajor ? "h-3 w-1" : "h-1.5 w-0.5"
                } ${isActive ? "bg-ember-500/60" : "bg-black/[0.08] dark:bg-white/[0.08]"}`}
              />
            );
          })}
        </div>

        {/* Thumb */}
        <div
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-75"
          style={{ left: `${pct}%` }}
        >
          <div className="relative">
            <div className={`h-6 w-6 rounded-full border-[3px] bg-white shadow-[0_0_12px_rgba(255,107,0,0.3)] dark:bg-void-800 ${
              disabled ? "border-slate-300 dark:border-slate-600" : "border-ember-500"
            }`} />
            <div className="absolute -inset-2 rounded-full bg-ember-500/10 animate-pulse" style={{ animationDuration: "2s" }} />
          </div>
        </div>
      </div>

      {/* Labels */}
      <div className="mt-2 flex justify-between text-[10px] font-bold tracking-wider text-slate-300 dark:text-slate-600">
        <span>1</span>
        <span>5</span>
        <span>10</span>
        <span>15</span>
        <span>20</span>
        <span>25</span>
        <span>30</span>
      </div>
    </div>
  );
};
