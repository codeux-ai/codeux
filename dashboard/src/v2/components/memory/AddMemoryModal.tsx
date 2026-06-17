import { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { createMemory } from "../../lib/memory-api.js";
import type { MemoryScope, MemoryCategory } from "../../memory-types.js";

const CATEGORIES: MemoryCategory[] = ["architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning"];

export const AddMemoryModal: FunctionComponent<{
    open: boolean;
    scope: MemoryScope;
    projectId: string;
    onClose: () => void;
    onCreated: () => void;
}> = ({ open, scope, projectId, onClose, onCreated }) => {
    const [content, setContent] = useState("");
    const [category, setCategory] = useState<MemoryCategory>("context");
    const [strength, setStrength] = useState(0.7);
    const [saving, setSaving] = useState(false);

    if (!open) return null;

    const handleSubmit = async () => {
        if (!content.trim()) return;
        setSaving(true);
        try {
            await createMemory(projectId, { scope, content: content.trim(), category, strength });
            setContent("");
            onCreated();
            onClose();
        } catch { /* ignore */ }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
            onClick={onClose}>
            <div className="w-full max-w-md cursor-default bg-white dark:bg-void-800 rounded-[1.5rem] p-6 flex flex-col gap-4
                           border border-black/[0.06] dark:border-white/[0.06]
                           shadow-[0_24px_80px_rgba(0,0,0,0.15)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
                onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-900 dark:text-white font-display">Add Memory</h3>
                <textarea value={content} onInput={e => setContent((e.target as HTMLTextAreaElement).value)}
                    placeholder="What should be remembered…"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl text-sm
                               bg-black/[0.03] dark:bg-white/[0.03]
                               border border-black/[0.06] dark:border-white/[0.06]
                               text-slate-800 dark:text-slate-200
                               placeholder:text-slate-400
                               focus:outline-none focus:ring-2 focus:ring-signal-500/20 focus:border-signal-500/40
                               resize-none" />
                <div className="flex items-center gap-3">
                    <select value={category} onChange={e => setCategory((e.target as HTMLSelectElement).value as MemoryCategory)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium
                                   bg-black/[0.03] dark:bg-white/[0.03]
                                   border border-black/[0.06] dark:border-white/[0.06]
                                   text-slate-700 dark:text-slate-300">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">{Math.round(strength * 100)}%</span>
                        <input type="range" min="0.1" max="1" step="0.1" value={strength}
                            onInput={e => setStrength(parseFloat((e.target as HTMLInputElement).value))}
                            className="w-20 accent-signal-500" />
                    </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                    <button onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold
                                   bg-black/[0.04] dark:bg-white/[0.04] text-slate-500 hover:text-slate-900 dark:hover:text-white
                                   transition-colors duration-200">
                        Cancel
                    </button>
                    <button onClick={handleSubmit}
                        disabled={!content.trim() || saving}
                        aria-disabled={!content.trim() || saving}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold
                                   bg-signal-500 text-void-900 hover:bg-signal-400
                                   shadow-[0_2px_12px_rgba(0,224,160,0.3)]
                                   transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed">
                        {saving ? "Saving…" : "Add Memory"}
                    </button>
                </div>
            </div>
        </div>
    );
};
