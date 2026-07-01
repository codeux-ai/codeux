import { useRef, useCallback } from "preact/hooks";
import type { FunctionComponent } from "preact";
import { Sparkles, ShieldCheck, Accessibility, Zap, Bug, Code2, Database, FileSearch, FlaskConical, GitBranch, Globe, Hammer, Heart, Layers, LayoutGrid, Lock, Microscope, Monitor, Paintbrush, RefreshCw, Search, Server, Shield, Terminal, TestTube2, Wrench, Settings2 } from "lucide-preact";
import type { LucideProps } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

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
}> = ({ template, onSelect, onEdit }) => {
  const Icon = IconMap[template.icon] || Zap;
  const tagColor = template.categoryColor || "slate";

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group relative flex flex-col rounded-[1.75rem] border border-black/[0.06] bg-white/70 p-5 text-left transition-all hover:border-ember-500/30 hover:shadow-[0_0_24px_rgba(255,107,0,0.08)] dark:border-white/[0.06] dark:bg-void-800/60 dark:hover:border-ember-500/30"
    >
      {!template.isBuiltIn && onEdit && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="absolute top-4 right-4 rounded-lg min-h-[44px] min-w-[44px] p-1.5 text-slate-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-ember-500/10 hover:text-ember-500 dark:text-slate-500"
          title="Edit template"
        >
          <Settings2 className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ember-500/[0.08] text-ember-500 transition-colors group-hover:bg-ember-500/[0.14]">
          <Icon className="h-4.5 w-4.5" />
        </div>
        <h3 className="flex-1 text-sm font-bold text-slate-900 dark:text-white leading-tight pr-6">{template.name}</h3>
      </div>

      <p className="flex-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400 mb-4">{template.description}</p>

      <div className="flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${getTagStyles(tagColor).bg} ${getTagStyles(tagColor).text}`}
          style={getTagStyles(tagColor).style?.["--accent"] ? { backgroundColor: "color-mix(in srgb, var(--accent) 15%, transparent)", color: "var(--accent)", ...getTagStyles(tagColor).style } : undefined}
        >
          <span
            className={`block h-1.5 w-1.5 rounded-full ${getTagStyles(tagColor).dot}`}
            style={getTagStyles(tagColor).style?.["--accent"] ? { backgroundColor: "var(--accent)", ...getTagStyles(tagColor).style } : undefined}
          />
          {template.category}
        </span>
        <span className="text-[10px] font-medium text-slate-400">
          {template.defaultTaskCount} subtask{template.defaultTaskCount !== 1 ? "s" : ""}
        </span>
      </div>
    </button>
  );
};

/* ═════════════════════════════════════════════════════════════════════ */
/*  Subtask Count Slider                                                */
/* ═════════════════════════════════════════════════════════════════════ */
export const SubtaskSlider: FunctionComponent<{
  value: number;
  onChange: (v: number) => void;
}> = ({ value, onChange }) => {
  const min = 1;
  const max = 15;
  const pct = ((value - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointer = useCallback((e: PointerEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange(Math.round(min + x * (max - min)));
  }, [onChange]);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    handlePointer(e);
  }, [handlePointer]);

  return (
    <div className="select-none">
      {/* Large number display */}
      <div className="flex items-baseline gap-2 mb-6">
        <span className="font-mono text-[3.5rem] font-black leading-none tracking-tighter text-slate-900 dark:text-white tabular-nums">
          {String(value).padStart(2, "0")}
        </span>
        <span className="text-sm font-medium text-slate-400">
          subtask{value !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Track */}
      <div
        ref={trackRef}
        className="relative h-10 cursor-pointer touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={(e: PointerEvent) => { if (e.buttons === 1) handlePointer(e); }}
      >
        {/* Background track */}
        <div className="absolute top-1/2 left-0 right-0 h-2 -translate-y-1/2 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
          {/* Fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ember-500 to-ember-400 transition-[width] duration-75"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Notches */}
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 flex justify-between px-[2px]">
          {Array.from({ length: max - min + 1 }, (_, i) => {
            const n = min + i;
            const isActive = n <= value;
            const isMajor = n === 1 || n === 5 || n === 10 || n === 15;
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
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-[left] duration-75"
          style={{ left: `${pct}%` }}
        >
          <div className="relative">
            <div className="h-6 w-6 rounded-full border-[3px] border-ember-500 bg-white shadow-[0_0_12px_rgba(255,107,0,0.3)] dark:bg-void-800" />
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
      </div>
    </div>
  );
};
