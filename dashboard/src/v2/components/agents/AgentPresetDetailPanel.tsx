import type { FunctionComponent } from "preact";
import { useState, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Edit2, FileUp, Trash2, RefreshCw, AlertTriangle } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import type { AgentAvatarExpression } from "../../lib/agent-avatar.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";
import { SHOWCASE_EXPRESSIONS, getAccentHex } from "../../lib/agent-avatar.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";

const EXPRESSION_EMOJI: Record<string, string> = {
  happy: "\u{1F60A}",
  sad: "\u{1F622}",
  angry: "\u{1F620}",
  bored: "\u{1F611}",
  hyped: "\u{1F929}",
};

const syncStatusDisplay = (preset: AgentPreset): { badge: string; label: string } => {
  switch (preset.syncStatus) {
    case "out_of_sync":
      return {
        badge: "border-amber-500/25 bg-amber-500/10 text-amber-400",
        label: "Out of Sync",
      };
    case "missing_source":
      return {
        badge: "border-status-red/25 bg-status-red/10 text-status-red",
        label: "Source Missing",
      };
    case "synced":
      return {
        badge: "border-signal-500/25 bg-signal-500/10 text-signal-400",
        label: preset.sourceScope === "project" ? "Project" : preset.sourceScope === "default" ? "Default" : "Home",
      };
    default:
      return {
        badge: "border-white/[0.08] bg-white/[0.04] text-slate-400",
        label: "Database Only",
      };
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
  const syncTone = syncStatusDisplay(preset);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, x: 20 },
      { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }
    );
  }, [preset.id]);

  return (
    <div
      ref={panelRef}
      className="group relative flex flex-col overflow-hidden rounded-[1.75rem] border border-white/[0.06] bg-void-900 shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
    >
      <WaveFluid accentHex={accentHex} />

      {/* Avatar stage */}
      <div className="relative h-64 w-full overflow-hidden bg-void-800 md:h-80">
        <AgentAvatarScene config={preset.avatarConfig} expression={activeExpression} className="h-full w-full" />

        {/* Gradient overlay bottom */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-void-900 via-void-900/60 to-transparent" />

        {/* Expression bar floating at bottom of avatar */}
        <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5 px-4">
          {SHOWCASE_EXPRESSIONS.map((expr) => (
            <button
              key={expr}
              type="button"
              onClick={() => setActiveExpression(expr)}
              className={`flex flex-col items-center gap-0.5 rounded-xl px-3 py-1.5 transition-all focus:outline-none ${
                activeExpression === expr
                  ? "bg-signal-500/20 shadow-[0_0_12px_rgba(0,224,160,0.15)]"
                  : "bg-void-900/40 backdrop-blur-sm hover:bg-white/5"
              }`}
            >
              <span className="text-base leading-none">{EXPRESSION_EMOJI[expr]}</span>
              <span
                className={`text-[7px] font-bold uppercase tracking-[0.14em] ${
                  activeExpression === expr ? "text-signal-400" : "text-slate-500"
                }`}
              >
                {expr}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col gap-6 p-8">
        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-3xl font-black tracking-tight text-white">
              {preset.name}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {preset.labels.map((l) => (
                <span
                  key={l}
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ backgroundColor: `${accentHex}15`, color: accentHex }}
                >
                  {l}
                </span>
              ))}
              <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${syncTone.badge}`}>
                {preset.syncStatus === "out_of_sync" && <AlertTriangle className="h-3 w-3" strokeWidth={2.1} />}
                {syncTone.label}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-void-900 shadow-[0_0_16px_rgba(0,224,160,0.25)] transition-all hover:scale-[1.04] hover:bg-signal-400 hover:shadow-[0_0_24px_rgba(0,224,160,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            <Edit2 className="h-4 w-4" strokeWidth={2.5} />
            Edit
          </button>
        </div>

        {/* System instructions */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500">
            System Instructions
          </h3>
          <div className="whitespace-pre-wrap rounded-2xl border border-white/[0.06] bg-void-800/60 p-5 text-sm leading-relaxed text-slate-300 backdrop-blur-sm">
            {preset.instructionMarkdown || (
              <span className="italic text-slate-500">No instructions provided.</span>
            )}
          </div>
        </div>

        {/* Memory template override */}
        {preset.memoryTemplateOverrideEnabled && preset.memoryTemplateMarkdown && (
          <div className="flex flex-col gap-2">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-400">
              Memory Template Override
            </h3>
            <div className="whitespace-pre-wrap rounded-2xl border border-violet-500/15 bg-violet-500/5 p-5 text-sm leading-relaxed text-slate-300">
              {preset.memoryTemplateMarkdown}
            </div>
          </div>
        )}

        {/* Source path */}
        {preset.sourcePath && (
          <div className="flex flex-col gap-1 rounded-2xl border border-white/[0.04] bg-white/[0.02] px-5 py-3">
            <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-500">Markdown Source</span>
            <span className="break-all font-mono text-[11px] text-slate-400">{preset.sourcePath}</span>
          </div>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.05] pt-6">
          {preset.sourcePath && (
            <button
              type="button"
              onClick={() => onImport(preset.id)}
              disabled={importing || preset.syncStatus === "manual"}
              className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-400 transition-colors hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
            >
              {importing ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} /> : <FileUp className="h-4 w-4" strokeWidth={2} />}
              Import Markdown
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(preset.id)}
            disabled={deleting}
            className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-4 py-2 text-[10px] font-bold uppercase tracking-[0.14em] text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            {deleting ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
            Delete Agent
          </button>
          <span className="ml-auto font-mono text-[10px] text-slate-600">
            {preset.id}
          </span>
        </div>
      </div>
    </div>
  );
};
