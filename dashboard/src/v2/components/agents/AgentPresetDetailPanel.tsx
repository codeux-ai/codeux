import type { FunctionComponent } from "preact";
import { Edit2, FileUp, Trash2, RefreshCw } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarScene } from "./AgentAvatarScene.js";

export const AgentPresetDetailPanel: FunctionComponent<{
  preset: AgentPreset;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onImport: (id: string) => void;
  deleting: boolean;
  importing: boolean;
}> = ({ preset, onEdit, onDelete, onImport, deleting, importing }) => (
  <div className="flex flex-col overflow-hidden rounded-[2rem] border border-black/[0.08] bg-white shadow-2xl dark:border-white/[0.08] dark:bg-void-900">
    <div className="relative h-48 w-full bg-slate-100 dark:bg-void-800 md:h-64">
      <AgentAvatarScene config={preset.avatarConfig} expression="happy" className="h-full w-full object-cover" />
      <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-white to-transparent dark:from-void-900" />
    </div>

    <div className="relative z-10 -mt-10 flex flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            {preset.name}
          </h2>
          {preset.labels.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {preset.labels.map((l) => (
                <span
                  key={l}
                  className="inline-flex items-center rounded-md bg-signal-500/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-signal-600 dark:text-signal-400"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-5 py-2.5 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/20 transition-all hover:scale-105 hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
        >
          <Edit2 className="h-4 w-4" strokeWidth={2.5} />
          Edit Agent
        </button>
      </div>

      <div className="prose prose-slate prose-sm max-w-none dark:prose-invert">
        <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          System Instructions
        </h3>
        <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-slate-700 dark:bg-void-800 dark:text-slate-300">
          {preset.instructionMarkdown || <span className="italic opacity-50">No instructions provided.</span>}
        </div>
      </div>

      {preset.memoryTemplateOverrideEnabled && preset.memoryTemplateMarkdown && (
        <div className="prose prose-slate prose-sm max-w-none dark:prose-invert">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Memory Template Override
          </h3>
          <div className="mt-2 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-slate-700 dark:bg-void-800 dark:text-slate-300">
            {preset.memoryTemplateMarkdown}
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-black/5 pt-6 dark:border-white/5">
        {preset.sourcePath && (
          <button
            type="button"
            onClick={() => onImport(preset.id)}
            disabled={importing || preset.syncStatus === "manual"}
            className="inline-flex items-center gap-2 rounded-full border border-signal-500/20 bg-signal-500/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-signal-600 transition-colors hover:bg-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-signal-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            {importing ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} /> : <FileUp className="h-4 w-4" strokeWidth={2} />}
            Import Markdown
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(preset.id)}
          disabled={deleting}
          className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/10 px-4 py-2 text-xs font-bold uppercase tracking-widest text-status-red transition-colors hover:bg-status-red/20 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
        >
          {deleting ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} /> : <Trash2 className="h-4 w-4" strokeWidth={2} />}
          Delete Agent
        </button>
      </div>
    </div>
  </div>
);