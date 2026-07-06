import { activeTierSignal, selectedSprintIdSignal, selectedAgentPresetIdSignal } from "./memoryState.js";
import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AlertTriangle, HardDrive, Plus } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/index.js";
import type { MemoryStats } from "../../lib/memory-api.js";
import type { MemoryScope } from "../../memory-types.js";
import type { SprintRecord, AgentPreset } from "../../types.js";

type MemTier = "short_term" | "long_term";
const TIER_TABS: { key: MemTier; label: string; scope: MemoryScope }[] = [
    { key: "short_term", label: "Short Term", scope: "sprint" },
    { key: "long_term",  label: "Long Term",  scope: "project" },
];

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
    const interactionTokens = useInteractionTokens();
    const [announcement, setAnnouncement] = useState("");
    const selectedSprint = sprints.find((sprint) => sprint.id === selectedSprintId);
    const selectedAgent = agentPresets.find((agent) => agent.id === selectedAgentPresetId);
    const activeTierLabel = activeTier === "short_term" ? "Short Term" : "Long Term";
    const activeTierCount = activeTier === "short_term" ? stats.sprint + stats.agent : stats.project;
    const totalCount = stats.sprint + stats.agent + stats.project;
    const sprintLabel = selectedSprint
        ? `Sprint ${selectedSprint.number ?? "?"}`
        : "No sprint selected";
    const agentLabel = selectedAgent?.name ?? "All Agents";
    const sprintDisabledReason = activeTier === "short_term" && sprints.length === 0
        ? "Sprint filter disabled because this project has no sprints with memory."
        : "";
    const agentDisabledReason = agentPresets.length === 0
        ? "Agent filter disabled because no agent presets are available."
        : "";
    const controlTransitionStyle = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const selectionTransitionStyle = {
        transitionDuration: interactionTokens.selectionMovement.duration,
        transitionTimingFunction: interactionTokens.selectionMovement.ease,
    };
    const inlineValidationStyle = {
        transitionDuration: interactionTokens.inlineValidation.duration,
        transitionTimingFunction: interactionTokens.inlineValidation.ease,
    };

    useEffect(() => {
        setAnnouncement(`${activeTierLabel} tier selected. ${activeTierCount} ${activeTierCount === 1 ? "memory" : "memories"}.`);
    }, [activeTierCount, activeTierLabel]);

    const handleTierChange = (tier: MemTier) => {
        activeTierSignal.value = tier;
    };

    const handleModelCatalogToggle = () => {
        const next = !showModels;
        setShowModels(next);
        setAnnouncement(next
            ? `Embedding model catalog shown. ${stats.activeModel ? `Active model ${stats.activeModel}.` : "No active model selected."}`
            : "Embedding model catalog hidden.");
    };

    const handleDangerToggle = () => {
        handleLobotomizeToggle();
        setAnnouncement(lobotomize
            ? "Danger delete mode is off. Single-memory delete buttons are hidden."
            : "Danger delete mode armed. Single-memory deletes happen immediately.");
    };

    const handleSprintChange = (value: string) => {
        selectedSprintIdSignal.value = value || undefined;
        const sprint = sprints.find((item) => item.id === value);
        setAnnouncement(sprint ? `Sprint filter set to Sprint ${sprint.number ?? "?"}.` : "Sprint filter cleared.");
    };

    const handleAgentChange = (value: string) => {
        selectedAgentPresetIdSignal.value = value || undefined;
        const agent = agentPresets.find((item) => item.id === value);
        setAnnouncement(agent ? `Agent filter set to ${agent.name}.` : "Agent filter set to all agents.");
    };

    return (
        <div className="flex w-full min-w-0 flex-col items-stretch gap-3.5 md:items-end">
            <div className="flex w-full flex-wrap items-center gap-2.5" role="tablist" aria-label="Memory Tier" aria-describedby="memory-filter-status">
                {TIER_TABS.map(tab => {
                    const count = tab.key === "short_term"
                        ? (stats.sprint + stats.agent)
                        : stats.project;
                    return (
                        <button
                            key={tab.key}
                            id={`tab-${tab.key}`}
                            role="tab"
                            aria-selected={activeTier === tab.key}
                            aria-current={activeTier === tab.key ? "page" : undefined}
                            aria-controls="memory-panel"
                            aria-describedby={`tab-${tab.key}-count`}
                            tabIndex={activeTier === tab.key ? 0 : -1}
                            style={{
                                transitionProperty: "background-color, border-color, color, box-shadow, transform",
                                ...selectionTransitionStyle,
                            }}
                            className={`min-w-0 rounded-full border px-3.5 py-1.5 text-[10px] font-bold font-mono leading-tight whitespace-normal cursor-pointer motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                            ${activeTier === tab.key
                                ? "bg-signal-500/[0.14] border border-signal-500/40 text-signal-600 shadow-[0_0_0_2px_rgba(0,224,160,0.08)] hover:bg-signal-500/[0.2] dark:text-signal-400"
                                : "bg-black/[0.04] dark:bg-white/[0.04] border border-transparent text-slate-400 hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                            }`}
                            onClick={() => handleTierChange(tab.key)}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowRight" || e.key === "ArrowLeft" || e.key === "Home" || e.key === "End") {
                                    e.preventDefault();
                                    const currentIndex = TIER_TABS.findIndex(t => t.key === activeTier);
                                    let nextIndex = currentIndex;
                                    if (e.key === "ArrowRight") {
                                        nextIndex = (currentIndex + 1) % TIER_TABS.length;
                                    } else if (e.key === "ArrowLeft") {
                                        nextIndex = (currentIndex - 1 + TIER_TABS.length) % TIER_TABS.length;
                                    } else if (e.key === "Home") {
                                        nextIndex = 0;
                                    } else if (e.key === "End") {
                                        nextIndex = TIER_TABS.length - 1;
                                    }
                                    handleTierChange(TIER_TABS[nextIndex].key);
                                    const nextTab = e.currentTarget.parentElement?.children[nextIndex] as HTMLElement;
                                    nextTab?.focus();
                                }
                            }}
>
                            <span>{tab.label}</span>
                            <span id={`tab-${tab.key}-count`} className="ml-1 text-[9px] opacity-80">
                                {count} {count === 1 ? "memory" : "memories"}
                            </span>
                        </button>
                    );
                })}
            </div>
            <div id="memory-filter-status" className="w-full text-left text-[11px] font-medium text-slate-500 dark:text-slate-400 md:text-right">
                {activeTierLabel}: showing {activeTierCount} of {totalCount} {totalCount === 1 ? "memory" : "memories"}
                {activeTier === "short_term" ? ` · ${sprintLabel}` : ""}
                {" · "}{agentLabel}
            </div>
            <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
            <div className="flex w-full flex-wrap items-center gap-2.5">
                {/* Sprint selector — only for Short Term */}
                {activeTier === "short_term" && (
                    <div className="flex min-w-0 items-center gap-1.5">
                        <label htmlFor="sprint-selector" className="sr-only">Filter by Sprint</label>
                        <select
                            id="sprint-selector"
                            aria-label="Filter memory by Sprint"
                            aria-describedby="sprint-selector-status"
                            title="Filter memory by Sprint"
                            value={selectedSprintId ?? ""}
                            onChange={(e) => handleSprintChange((e.target as HTMLSelectElement).value)}
                            disabled={sprints.length === 0}
                            style={controlTransitionStyle}
                            className="min-w-0 max-w-full rounded-lg border border-black/[0.08] bg-black/[0.04] px-3 py-1.5 text-[11px] font-mono font-bold text-slate-600 transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0 cursor-pointer hover:bg-black/[0.08] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]
                                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-void-900">
                            {sprints.length === 0 && <option value="">No sprints available</option>}
                            {sprints.map(s => (
                                <option key={s.id} value={s.id}>
                                    Sprint {s.number ?? "?"} — {s.name || s.goal?.slice(0, 40) || s.id.slice(0, 8)}
                                </option>
                            ))}
                        </select>
                        <span id="sprint-selector-status" className="text-[10px] font-semibold text-slate-400">
                            {sprintDisabledReason || sprintLabel}
                        </span>
                    </div>
                )}
                {/* Agent selector — both tiers */}
                <div className="flex min-w-0 items-center gap-1.5">
                        <label htmlFor="agent-selector" className="sr-only">Filter by Agent Preset</label>
                        <select
                            id="agent-selector"
                            aria-label="Filter memory by Agent Preset"
                            aria-describedby="agent-selector-status"
                            title="Filter memory by Agent Preset"
                            value={selectedAgentPresetId ?? ""}
                            onChange={(e) => handleAgentChange((e.target as HTMLSelectElement).value)}
                            disabled={agentPresets.length === 0}
                            style={controlTransitionStyle}
                            className="min-w-0 max-w-full rounded-lg border border-black/[0.08] bg-black/[0.04] px-3 py-1.5 text-[11px] font-mono font-bold text-slate-600 transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0 cursor-pointer hover:bg-black/[0.08] dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300 dark:hover:bg-white/[0.08]
                                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-void-900">
                            <option value="">All Agents</option>
                            {agentPresets.map(a => (
                                <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                        </select>
                        <span id="agent-selector-status" className="text-[10px] font-semibold text-slate-400">
                            {agentDisabledReason || agentLabel}
                        </span>
                    </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
                <button type="button" onClick={() => setShowAddModal(true)}
                    aria-label="Add Memory"
                    style={controlTransitionStyle}
                    className="flex min-w-0 items-center gap-1.5 whitespace-normal leading-tight rounded-xl px-4 py-2.5 text-xs font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20
                               border border-signal-500/20
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                               transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0">
                    <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add Memory
                </button>
                <button type="button" aria-pressed={showModels} onClick={handleModelCatalogToggle}
                    aria-label={showModels ? "Hide embedding model catalog" : "Show embedding model catalog"}
                    style={controlTransitionStyle}
                    className={`flex min-w-0 items-center gap-1.5 whitespace-normal leading-tight rounded-xl px-4 py-2.5 text-xs font-bold cursor-pointer
                               border transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                               ${showModels
                                   ? "bg-signal-500/[0.14] border-signal-500/40 text-signal-600 shadow-[0_0_0_2px_rgba(0,224,160,0.08)] hover:bg-signal-500/[0.2] dark:text-signal-400"
                                   : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.06] text-slate-500 hover:bg-black/[0.08] dark:hover:bg-white/[0.08] hover:text-slate-900 dark:hover:text-white"
                               }`}>
                    <HardDrive className="w-3.5 h-3.5" strokeWidth={2} />
                    Model Catalog
                    <span className="text-[10px] opacity-80">{showModels ? "Shown" : "Hidden"}</span>
                    <span className="text-[10px] opacity-80">{stats.activeModel ? "1 active" : "0 active"}</span>
                    {stats.activeModel && (
                        <span className="w-1.5 h-1.5 rounded-full bg-signal-500" />
                    )}
                </button>
                <button type="button" aria-pressed={lobotomize} onClick={handleDangerToggle}
                    aria-label={lobotomize ? "Disable danger delete mode" : "Enable danger delete mode"}
                    aria-describedby="danger-delete-mode-copy"
                    style={controlTransitionStyle}
                    className={`flex min-w-0 items-center gap-2.5 whitespace-normal leading-tight rounded-xl px-5 py-2.5 text-xs font-bold border
                               transition-[background-color,box-shadow,border-color,color] motion-reduce:duration-0
                               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                               ${lobotomize
                                   ? "bg-status-red text-white border-status-red ring-2 ring-status-red/30 ring-offset-2 ring-offset-white shadow-[0_0_28px_rgba(227,0,15,0.42)] hover:bg-status-red/90 hover:shadow-[0_0_36px_rgba(227,0,15,0.58)] active:bg-status-red/80 active:shadow-[0_0_12px_rgba(227,0,15,0.5)] dark:ring-offset-void-900"
                                   : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:border-status-red/50 hover:text-status-red hover:bg-status-red/[0.04] active:bg-status-red/10 active:border-status-red/60"
                               }`}>
                    <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                    <span>{lobotomize ? "Danger Delete Armed" : "Danger Delete Off"}</span>
                </button>
            </div>
            <p
                id="danger-delete-mode-copy"
                className={`w-full text-left text-[11px] font-semibold leading-snug md:text-right ${lobotomize ? "text-status-red" : "text-slate-400"}`}
                style={inlineValidationStyle}
            >
                {lobotomize
                    ? "Danger delete mode is armed. Single-memory deletes skip confirmation until turned off."
                    : "Danger delete mode is off. Toggle only when immediate single-memory deletion is intentional."}
            </p>
        </div>
    );
};
