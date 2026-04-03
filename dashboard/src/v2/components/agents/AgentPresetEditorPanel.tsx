import type { FunctionComponent } from "preact";
import { useState, useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Save, X, RefreshCw } from "lucide-preact";
import type { AgentPreset } from "../../types.js";
import { AgentAvatarCustomizer } from "./AgentAvatarCustomizer.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { getAccentHex } from "../../lib/agent-avatar.js";

export const AgentPresetEditorPanel: FunctionComponent<{
  preset: AgentPreset;
  saving: boolean;
  onSave: (id: string, updates: Partial<AgentPreset>) => void;
  onCancel: () => void;
}> = ({ preset, saving, onSave, onCancel }) => {
  const panelRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(preset.name);
  const [labels, setLabels] = useState(preset.labels.join(", "));
  const [instructionMarkdown, setInstructionMarkdown] = useState(preset.instructionMarkdown);
  const [memoryOverrideEnabled, setMemoryOverrideEnabled] = useState(!!preset.memoryTemplateOverrideEnabled);
  const [memoryMarkdown, setMemoryMarkdown] = useState(preset.memoryTemplateMarkdown ?? "");
  const [avatarConfig, setAvatarConfig] = useState(preset.avatarConfig);

  const accentHex = getAccentHex(avatarConfig?.accent);

  useEffect(() => {
    setName(preset.name);
    setLabels(preset.labels.join(", "));
    setInstructionMarkdown(preset.instructionMarkdown);
    setMemoryOverrideEnabled(!!preset.memoryTemplateOverrideEnabled);
    setMemoryMarkdown(preset.memoryTemplateMarkdown ?? "");
    setAvatarConfig(preset.avatarConfig);
  }, [preset]);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    gsap.fromTo(
      panelRef.current,
      { opacity: 0, x: 20 },
      { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }
    );
  }, [preset.id]);

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
      ref={panelRef}
      onSubmit={handleSubmit}
      className="relative flex flex-col gap-8 overflow-hidden rounded-[1.75rem] border border-white/[0.06] bg-void-900 p-8 shadow-[0_8px_40px_rgba(0,0,0,0.4)]"
    >
      <BorderTrace accentHex={accentHex} />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.05] pb-5">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-signal-500">Editing</span>
          <h2 className="font-display text-2xl font-black tracking-tight text-white">
            {name || "Unnamed Agent"}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-transparent px-4 py-2.5 text-sm font-bold text-slate-400 transition-colors hover:bg-white/[0.05] hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-6 py-2.5 text-sm font-bold text-void-900 shadow-[0_0_16px_rgba(0,224,160,0.25)] transition-all hover:scale-[1.04] hover:bg-signal-400 hover:shadow-[0_0_24px_rgba(0,224,160,0.4)] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.5} /> : <Save className="h-4 w-4" strokeWidth={2.5} />}
            Save Agent
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-8 xl:flex-row">
        {/* Fields */}
        <div className="flex w-full flex-col gap-6 xl:w-1/2">
          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Agent Name
            </label>
            <input
              type="text"
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              placeholder="e.g. Planning Agent"
              required
              className="rounded-2xl border border-white/[0.08] bg-void-800/60 px-4 py-3.5 text-base font-medium text-white placeholder-slate-600 outline-none transition-colors focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              Labels (comma separated)
            </label>
            <input
              type="text"
              value={labels}
              onInput={(e) => setLabels(e.currentTarget.value)}
              placeholder="e.g. planning, core"
              className="rounded-2xl border border-white/[0.08] bg-void-800/60 px-4 py-3.5 text-base font-medium text-white placeholder-slate-600 outline-none transition-colors focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              System Instructions
            </label>
            <textarea
              value={instructionMarkdown}
              onInput={(e) => setInstructionMarkdown(e.currentTarget.value)}
              placeholder="Markdown instructions for this agent's behavior..."
              rows={8}
              className="rounded-2xl border border-white/[0.08] bg-void-800/60 px-4 py-3.5 text-base font-medium leading-relaxed text-white placeholder-slate-600 outline-none transition-colors focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10"
            />
          </div>

          {/* Memory override */}
          <div className="flex flex-col gap-4 rounded-2xl border border-white/[0.05] bg-void-800/30 p-5">
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={memoryOverrideEnabled}
                  onChange={(e) => setMemoryOverrideEnabled(e.currentTarget.checked)}
                  className="peer sr-only"
                />
                <div className="h-6 w-11 rounded-full bg-void-800 border border-white/[0.1] peer-checked:bg-signal-500/30 transition-colors" />
                <div className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-slate-500 transition-all peer-checked:translate-x-5 peer-checked:bg-signal-400" />
              </div>
              <span className="text-sm font-bold text-slate-300">
                Memory Template Override
              </span>
            </label>
            {memoryOverrideEnabled && (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Memory Template Markdown
                </label>
                <textarea
                  value={memoryMarkdown}
                  onInput={(e) => setMemoryMarkdown(e.currentTarget.value)}
                  placeholder="Override the default memory prompt template for this agent."
                  rows={5}
                  className="rounded-2xl border border-white/[0.08] bg-void-800/60 px-4 py-3.5 text-base font-medium leading-relaxed text-white placeholder-slate-600 outline-none transition-colors focus:border-signal-500 focus:ring-4 focus:ring-signal-500/10"
                />
              </div>
            )}
          </div>
        </div>

        {/* Avatar customizer */}
        <div className="w-full xl:w-1/2">
          <AgentAvatarCustomizer
            config={avatarConfig || {}}
            onChange={setAvatarConfig}
          />
        </div>
      </div>
    </form>
  );
};
