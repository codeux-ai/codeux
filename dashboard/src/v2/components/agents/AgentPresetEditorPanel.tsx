import type { FunctionComponent } from "preact";
import { useState, useEffect } from "preact/hooks";
import { Save, X, RefreshCw } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarCustomizer } from "./AgentAvatarCustomizer.js";

export const AgentPresetEditorPanel: FunctionComponent<{
  preset: AgentPreset;
  saving: boolean;
  onSave: (id: string, updates: Partial<AgentPreset>) => void;
  onCancel: () => void;
}> = ({ preset, saving, onSave, onCancel }) => {
  const [name, setName] = useState(preset.name);
  const [labels, setLabels] = useState(preset.labels.join(", "));
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const [memoryOverrideEnabled, setMemoryOverrideEnabled] = useState(!!preset.memoryTemplateOverrideEnabled);
  const [memoryMarkdown, setMemoryMarkdown] = useState(preset.memoryTemplateMarkdown ?? "");
  const [avatarConfig, setAvatarConfig] = useState(preset.avatarConfig);

  useEffect(() => {
    setName(preset.name);
    setLabels(preset.labels.join(", "));
    setInstructionMarkdown(preset.instructionMarkdown);
    setMemoryOverrideEnabled(!!preset.memoryTemplateOverrideEnabled);
    setMemoryMarkdown(preset.memoryTemplateMarkdown ?? "");
    setAvatarConfig(preset.avatarConfig);
  }, [preset]);

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    onSave(preset.id, {
      name,
      labels: labels.split(",").map((l) => l.trim()).filter(Boolean),
      instructionMarkdown,
      memoryTemplateOverrideEnabled: memoryOverrideEnabled,
      memoryTemplateMarkdown: memoryOverrideEnabled ? memoryMarkdown : undefined,
      avatarConfig,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-8 rounded-[1.75rem] border border-black/[0.08] bg-white p-8 shadow-2xl dark:border-white/[0.08] dark:bg-void-900 pb-24 md:pb-8"
    >
      <div className="flex flex-col items-start gap-4 md:flex-row md:items-center justify-between border-b border-black/5 pb-4 dark:border-white/5">
        <h2 className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white">
          Edit Agent
        </h2>
        <div className="fixed bottom-[5.5rem] left-0 right-0 z-50 flex flex-col md:flex-row items-stretch md:items-center justify-end gap-3 border-t border-black/5 bg-white p-4 shadow-[0_-10px_20px_rgba(0,0,0,0.05)] dark:border-white/5 dark:bg-void-900 md:static md:border-none md:bg-transparent md:p-0 md:shadow-none">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex w-full justify-center md:w-auto items-center gap-2 rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="inline-flex w-full justify-center md:w-auto items-center gap-2 rounded-full bg-signal-500 px-5 py-2 text-sm font-bold text-slate-900 shadow-lg shadow-signal-500/20 transition-all hover:scale-105 hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Save className="h-4 w-4" strokeWidth={2.5} />}
            Save Agent
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <div className="flex w-full flex-col gap-6 lg:w-1/2">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Agent Name
            </label>
            <input
              type="text"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Planning Agent"
              className="rounded-xl border border-black/10 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 focus:border-signal-500 focus:outline-none focus:ring-4 focus:ring-signal-500/20 dark:border-white/10 dark:bg-void-800 dark:text-white"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              Labels (comma separated)
            </label>
            <input
              type="text"
              value={labels}
              onInput={(e) => setLabels(e.currentTarget.value)}
              placeholder="e.g. planning, core"
              className="rounded-xl border border-black/10 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 focus:border-signal-500 focus:outline-none focus:ring-4 focus:ring-signal-500/20 dark:border-white/10 dark:bg-void-800 dark:text-white"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
              System Instructions
            </label>
            <textarea
              value={instructionMarkdown}
              onInput={(e) => setInstructionMarkdown(e.currentTarget.value)}
              placeholder="Markdown instructions for this agent's behavior..."
              rows={8}
              className="rounded-xl border border-black/10 bg-slate-50 px-4 py-3 text-base font-medium text-slate-900 focus:border-signal-500 focus:outline-none focus:ring-4 focus:ring-signal-500/20 dark:border-white/10 dark:bg-void-800 dark:text-white"
            />
          </div>

          <div className="flex flex-col gap-4 rounded-xl border border-black/5 bg-slate-50/50 p-5 dark:border-white/5 dark:bg-void-800/50">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={memoryOverrideEnabled}
                onChange={(e) => setMemoryOverrideEnabled(e.currentTarget.checked)}
                className="h-5 w-5 rounded border-black/20 text-signal-500 focus:ring-signal-500/30 dark:border-white/20 dark:bg-void-900"
              />
              <span className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Enable Memory Template Override
              </span>
            </label>
            {memoryOverrideEnabled && (
              <div className="flex flex-col gap-2 animate-in fade-in slide-in-from-top-2">
                <label className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                  Memory Template Markdown
                </label>
                <textarea
                  value={memoryMarkdown}
                  onInput={(e) => setMemoryMarkdown(e.currentTarget.value)}
                  placeholder="Override the default memory prompt template for this agent."
                  rows={5}
                  className="rounded-xl border border-black/10 bg-white px-4 py-3 text-base font-medium text-slate-900 focus:border-signal-500 focus:outline-none focus:ring-4 focus:ring-signal-500/20 dark:border-white/10 dark:bg-void-900 dark:text-white"
                />
              </div>
            )}
          </div>
        </div>

        <div className="w-full lg:w-1/2">
          <AgentAvatarCustomizer
            config={avatarConfig || {}}
            onChange={setAvatarConfig}
          />
        </div>
      </div>
    </form>
  );
};
