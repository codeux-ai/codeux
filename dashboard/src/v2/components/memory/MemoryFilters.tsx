import { FunctionComponent } from "preact";
import { Plus, HardDrive, AlertTriangle } from "lucide-preact";
import type { SprintRecord, AgentPreset } from "../../types.js";
import type { MemoryScope } from "../../memory-types.js";
import type { MemoryStats } from "../../lib/memory-api.js";

type MemTier = "short_term" | "long_term";
const TIER_TABS: { key: MemTier; label: string; scope: MemoryScope }[] = [
    { key: "short_term", label: "Short Term", scope: "sprint" },
    { key: "long_term",  label: "Long Term",  scope: "project" },
];

import { activeTierSignal, selectedSprintIdSignal, selectedAgentPresetIdSignal } from "./memoryState.js";

export const MemoryFilters: FunctionComponent<{
    stats: MemoryStats;
    sprints: SprintRecord[];
    agentPresets: AgentPreset[];
    showModels: boolean;
    setShowModels: (s: boolean) => void;
    setShowAddModal: (s: boolean) => void;
    lobotomize: boolean;
    handleLobotomizeToggle: () => void;
}> = ({
    stats, sprints, agentPresets,
    showModels, setShowModels,
    setShowAddModal,
    lobotomize, handleLobotomizeToggle
}) => {
    const activeTier = activeTierSignal.value;
    const selectedSprintId = selectedSprintIdSignal.value;
    const selectedAgentPresetId = selectedAgentPresetIdSignal.value;

    return (
        <div className="flex flex-col items-end gap-3.5 shrink-0">
            <div className="flex items-center gap-2.5" role="tablist">
                {TIER_TABS.map(tab => {
                    const count = tab.key === "short_term"
                        ? (stats.sprint + stats.agent)
                        : stats.project;
                    return (
                        <button
                            key={tab.key}
                            role="tab"
                            aria-selected={activeTier === tab.key}
                            aria-controls="memory-panel"
                            className={`text-[10px] font-bold font-mono px-3.5 py-1.5 rounded-full cursor-pointer transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                            ${activeTier === tab.key
                                ? "bg-signal-500/[0.12] border border-signal-500/30 text-signal-500"
                                : "bg-black/[0.04] dark:bg-white/[0.04] border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            }`}
                            onClick={() => activeTierSignal.value = tab.key}>
                            {tab.label} · {count}
                        </button>
                    );
                })}
            </div>
            <div className="flex items-center gap-2.5">
                {/* Sprint selector — only for Short Term */}
                {activeTier === "short_term" && sprints.length > 0 && (
                    <select
                        aria-label="Select sprint"
                        value={selectedSprintId ?? ""}
                        onChange={(e) => selectedSprintIdSignal.value = (e.target as HTMLSelectElement).value || undefined}
                        className="text-[11px] font-mono font-bold px-3 py-1.5 rounded-lg
                                   bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08]
                                   text-slate-600 dark:text-slate-300 cursor-pointer
                                   focus:outline-none focus:border-signal-500/40">
                        {sprints.map(s => (
                            <option key={s.id} value={s.id}>
                                Sprint {s.number ?? "?"} — {s.name || s.goal?.slice(0, 40) || s.id.slice(0, 8)}
                            </option>
                        ))}
                    </select>
                )}
                {/* Agent selector — both tiers */}
                {agentPresets.length > 0 && (
                    <select
                        aria-label="Select agent preset"
                        value={selectedAgentPresetId ?? ""}
                        onChange={(e) => selectedAgentPresetIdSignal.value = (e.target as HTMLSelectElement).value || undefined}
                        className="text-[11px] font-mono font-bold px-3 py-1.5 rounded-lg
                                   bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08]
                                   text-slate-600 dark:text-slate-300 cursor-pointer
                                   focus:outline-none focus:border-signal-500/40">
                        <option value="">All Agents</option>
                        {agentPresets.map(a => (
                            <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                    </select>
                )}
            </div>
            <div className="flex items-center gap-2.5">
                <button onClick={() => setShowAddModal(true)}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20
                               border border-signal-500/20
                               transition-colors duration-200">
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add Memory
                </button>
                <button aria-pressed={showModels} onClick={() => setShowModels(!showModels)}
                    className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold
                               border transition-colors duration-200
                               ${showModels
                                   ? "bg-signal-500/[0.12] border-signal-500/30 text-signal-500"
                                   : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.06] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                               }`}>
                    <HardDrive className="w-3.5 h-3.5" strokeWidth={2} />
                    Models
                    {stats.activeModel && (
                        <span className="w-1.5 h-1.5 rounded-full bg-signal-500" />
                    )}
                </button>
                <button aria-pressed={lobotomize} onClick={handleLobotomizeToggle}
                    className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-xs border
                               transition-[background-color,box-shadow,border-color] duration-300
                               ${lobotomize
                                   ? "bg-status-red text-white border-status-red shadow-[0_0_24px_rgba(227,0,15,0.4)] hover:shadow-[0_0_36px_rgba(227,0,15,0.6)]"
                                   : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:border-status-red/50 hover:text-status-red"
                               }`}>
                    <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                    {lobotomize ? "Lobotomize Active" : "Lobotomize"}
                </button>
            </div>
        </div>
    );
};
