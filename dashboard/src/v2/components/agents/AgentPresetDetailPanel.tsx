import type { FunctionComponent } from "preact";
import { useState, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import {
  Edit2, FileUp, Trash2, RefreshCw, AlertTriangle,
  Smile, Frown, Angry, Meh, Zap,
} from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { LazyAgentAvatarScene } from "./LazyAgentAvatarScene.js";
import { SHOWCASE_EXPRESSIONS, getAccentHex } from "../../lib/agent-avatar.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";

/* ── Expression icon map ── */
const EXPRESSION_ICON: Record<string, typeof Smile> = {
  happy: Smile,
  sad: Frown,
  angry: Angry,
  bored: Meh,
  hyped: Zap,
};

const EXPRESSION_LABELS: Record<string, string> = {
  happy: "Happy",
  sad: "Sad",
  angry: "Angry",
  bored: "Bored",
  hyped: "Hyped",
};

const syncStatusDisplay = (preset: AgentPreset) => {
  switch (preset.syncStatus) {
    case "out_of_sync":
      return { cls: "border-amber-400/20 bg-amber-400/8 text-amber-600 dark:text-amber-400", label: "Out of Sync" };
    case "missing_source":
      return { cls: "border-status-red/20 bg-status-red/8 text-status-red", label: "Source Missing" };
    case "synced":
      return { cls: "border-signal-500/20 bg-signal-500/8 text-signal-600 dark:text-signal-400", label: preset.sourceScope === "project" ? "Project" : preset.sourceScope === "default" ? "Default" : "Home" };
    default:
      return { cls: "border-black/[0.06] bg-black/[0.03] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-400", label: "Database Only" };
  }
};

export const AgentPresetDetailPanel: FunctionComponent<{
  preset: AgentPreset;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onImport: (id: string) => void;
  deleting: boolean;
  importing: boolean;
}> = ({ preset, onEdit, onDelete, onImport, deleting, importing }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const [activeExpression, setActiveExpression] = useState<AgentAvatarExpression>("happy");
  const accentHex = getAccentHex(preset.avatarConfig?.accent);
  const sync = syncStatusDisplay(preset);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(panelRef.current, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" });
  }, [preset.id]);

  return (
    <div
      ref={panelRef}
      className="group relative flex flex-col overflow-hidden rounded-[1.75rem] border border-black/[0.06] bg-white shadow-[0_4px_32px_rgba(0,0,0,0.06)] dark:border-white/[0.06] dark:bg-void-900 dark:shadow-[0_8px_40px_rgba(0,0,0,0.35)]"
    >
      <WaveFluid accentHex={accentHex} />

      {/* ── Avatar stage ── */}
      <div className="relative h-56 w-full overflow-hidden bg-gradient-to-b from-slate-50 to-slate-100 dark:from-void-800 dark:to-void-900 md:h-72">
        <LazyAgentAvatarScene config={preset.avatarConfig} expression={activeExpression} className="h-full w-full" />

        {/* Bottom gradient */}
        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/70 to-transparent dark:from-void-900 dark:via-void-900/70" />

        {/* Expression selector */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 px-4">
          {SHOWCASE_EXPRESSIONS.map((expr) => {
            const Icon = EXPRESSION_ICON[expr];
            const isActive = activeExpression === expr;
            return (
              <button
                key={expr}
                type="button"
                onClick={() => setActiveExpression(expr)}
                title={EXPRESSION_LABELS[expr]}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
                  isActive
                    ? "bg-signal-500/15 shadow-[0_0_12px_rgba(0,224,160,0.12)] dark:bg-signal-500/20"
                    : "bg-white/60 hover:bg-white dark:bg-void-900/50 dark:hover:bg-void-800/80"
                }`}
              >
                {Icon && (
                  <Icon
                    className={`h-4 w-4 ${isActive ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"}`}
                    strokeWidth={2}
                  />
                )}
                <span
                  className={`text-[7px] font-bold uppercase tracking-[0.12em] ${
                    isActive ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"
                  }`}
                >
                  {EXPRESSION_LABELS[expr]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col gap-6 p-7 md:p-8">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            <h2 className="font-display text-2xl font-black tracking-tight text-slate-900 md:text-3xl dark:text-white">
              {preset.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {preset.labels.map((l) => (
                <span
                  key={l}
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ backgroundColor: `${accentHex}10`, color: accentHex }}
                >
                  {l}
                </span>
              ))}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${sync.cls}`}>
                {preset.syncStatus === "out_of_sync" && <AlertTriangle className="h-3 w-3" strokeWidth={2.2} />}
                {sync.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/15 transition-all hover:scale-[1.03] hover:bg-signal-400 hover:shadow-signal-500/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:text-void-900"
          >
            <Edit2 className="h-4 w-4" strokeWidth={2.5} />
            Edit
          </button>
        </div>

        {/* System Instructions */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-500">
            System Instructions
          </h3>
          <div className="whitespace-pre-wrap rounded-2xl border border-black/[0.04] bg-slate-50/80 p-5 text-sm leading-relaxed text-slate-700 dark:border-white/[0.04] dark:bg-void-800/50 dark:text-slate-300">
            {preset.instructionMarkdown || (
              <span className="italic text-slate-400 dark:text-slate-500">No instructions provided.</span>
            )}
          </div>
        </div>

        {/* Memory override */}
        {preset.memoryTemplateOverrideEnabled && preset.memoryTemplateMarkdown && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600 dark:text-violet-400">
              Memory Template Override
            </h3>
            <div className="whitespace-pre-wrap rounded-2xl border border-violet-500/10 bg-violet-50/50 p-5 text-sm leading-relaxed text-slate-700 dark:border-violet-500/10 dark:bg-violet-500/5 dark:text-slate-300">
              {preset.memoryTemplateMarkdown}
            </div>
          </div>
        )}

        {/* Source path */}
        {preset.sourcePath && (
          <div className="flex flex-col gap-1 rounded-2xl border border-black/[0.04] bg-slate-50/50 px-5 py-3 dark:border-white/[0.04] dark:bg-white/[0.02]">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">Markdown Source</span>
            <span className="break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">{preset.sourcePath}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.04] pt-6 dark:border-white/[0.04]">
          {preset.sourcePath && (
            <button
              type="button"
              onClick={() => onImport(preset.id)}
              disabled={importing || preset.syncStatus === "manual"}
              className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-600 transition-colors hover:bg-signal-500/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
            >
              {importing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : <FileUp className="h-3.5 w-3.5" strokeWidth={2.2} />}
              Import
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(preset.id)}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/8 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/15 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          >
            {deleting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : <Trash2 className="h-3.5 w-3.5" strokeWidth={2.2} />}
            Delete
          </button>
          <span className="ml-auto font-mono text-[10px] text-slate-400 dark:text-slate-600">
            {preset.id}
          </span>
        </div>
      </div>
    </div>
  );
};
