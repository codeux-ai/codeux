import { activeTierSignal, selectedSprintIdSignal, selectedAgentPresetIdSignal } from "./memoryState.js";
import { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AlertTriangle, Plus } from "lucide-preact";
import { useInteractionTokens } from "../../lib/motion/index.js";
import type { MemoryStats } from "../../lib/memory-api.js";
import type { MemoryScope } from "../../memory-types.js";
import type { SprintRecord, AgentPreset } from "../../types.js";
import { useMemoryI18n } from "../../i18n/messages/memory.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";

type MemTier = "short_term" | "long_term" | "skills";
const TIER_TABS: { key: MemTier; labelKey: "shortTerm" | "longTerm" | "skills"; scope: MemoryScope }[] = [
    { key: "short_term", labelKey: "shortTerm", scope: "sprint" },
    { key: "long_term",  labelKey: "longTerm",  scope: "project" },
    { key: "skills", labelKey: "skills", scope: "project" },
];

export const MemoryFilters: FunctionComponent<{
    stats: MemoryStats;
    sprints: SprintRecord[];
    agentPresets: AgentPreset[];
    setShowAddModal: (s: boolean) => void;
    lobotomize: boolean;
    handleLobotomizeToggle: () => void;
    skillsCount?: number;
}> = ({
    stats, sprints, agentPresets,
    setShowAddModal,
    lobotomize, handleLobotomizeToggle, skillsCount = 0,
}) => {
    const activeTier = activeTierSignal.value;
    const selectedSprintId = selectedSprintIdSignal.value;
    const selectedAgentPresetId = selectedAgentPresetIdSignal.value;
    const interactionTokens = useInteractionTokens();
    const { formatNumber, t, tp } = useMemoryI18n();
    const [announcement, setAnnouncement] = useState("");
    const activeTierLabel = t(activeTier === "short_term" ? "shortTerm" : activeTier === "long_term" ? "longTerm" : "skills");
    const shortTermCount = stats.sprint + stats.agent;
    const longTermCount = stats.project;
    const activeTierCount = activeTier === "short_term" ? shortTermCount : activeTier === "long_term" ? longTermCount : skillsCount;
    const totalCount = shortTermCount + longTermCount + skillsCount;
    const selectedSprint = sprints.find((sprint) => sprint.id === selectedSprintId);
    const selectedAgent = agentPresets.find((agent) => agent.id === selectedAgentPresetId);
    const hasSprintFilters = sprints.length > 0;
    const hasAgentFilters = agentPresets.length > 0;
    const hasShortTermFilterData = activeTier !== "short_term" || shortTermCount > 0;
    const showSprintFilter = activeTier === "short_term" && hasSprintFilters && hasShortTermFilterData;
    const showAgentFilter = hasAgentFilters && hasShortTermFilterData;
    const hasScopeFilters = showSprintFilter || showAgentFilter;
    const sprintLabel = selectedSprint
        ? t("sprintNumber", { number: selectedSprint.number ?? "?" })
        : activeTier === "short_term" && shortTermCount === 0
            ? t("noShortTermMemories")
            : hasSprintFilters ? t("allSprints") : t("noSprintsAvailable");
    const agentLabel = selectedAgent?.name ?? t("allAgents");
    const activeTierCountLabel = tp(activeTier === "skills" ? "skill" : "memory", activeTierCount, { formattedCount: formatNumber(activeTierCount) });
    const memoryTotal = shortTermCount + longTermCount;
    const totalCountLabel = skillsCount > 0
        ? t("indexedItems", { countLabel: tp("item", totalCount, { formattedCount: formatNumber(totalCount) }) })
        : tp("memory", memoryTotal, { formattedCount: formatNumber(memoryTotal) });
    const currentScopeParts = [
        activeTier === "short_term" ? sprintLabel : activeTier === "skills" ? t("versionedSkillStorages") : t("projectWide"),
        agentLabel,
    ];
    const currentScopeCopy = activeTier === "skills"
        ? t("showingSkillsScope", { tier: activeTierLabel, activeCount: activeTierCountLabel, scope: currentScopeParts.join(" · ") })
        : t("showingScope", { tier: activeTierLabel, activeCount: activeTierCountLabel, totalCount: totalCountLabel, scope: currentScopeParts.join(" · ") });
    const unavailableScopeCopy = activeTier === "short_term"
        ? shortTermCount === 0
            ? t("noShortTermFilters")
            : hasAgentFilters
                ? t("noSprintFilters")
                : t("noSprintOrAgentFilters")
        : t("noAgentFilters");
    const unavailablePartialScopeCopy = activeTier === "short_term" && !showSprintFilter && shortTermCount > 0
        ? t("noSprintFilters")
        : !showAgentFilter && hasScopeFilters
            ? t("noAgentFilters")
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
        setAnnouncement(t("tierSelected", { tier: activeTierLabel, countLabel: activeTierCountLabel }));
    }, [activeTierCountLabel, activeTierLabel, t]);

    useEffect(() => {
        if (selectedSprintId && ((activeTier === "short_term" && shortTermCount === 0) || !sprints.some((sprint) => sprint.id === selectedSprintId))) {
            selectedSprintIdSignal.value = undefined;
        }
    }, [activeTier, selectedSprintId, shortTermCount, sprints]);

    useEffect(() => {
        if (selectedAgentPresetId && ((activeTier === "short_term" && shortTermCount === 0) || !agentPresets.some((agent) => agent.id === selectedAgentPresetId))) {
            selectedAgentPresetIdSignal.value = undefined;
        }
    }, [activeTier, agentPresets, selectedAgentPresetId, shortTermCount]);

    const handleTierChange = (tier: MemTier) => {
        activeTierSignal.value = tier;
    };

    const handleDangerToggle = () => {
        handleLobotomizeToggle();
        setAnnouncement(lobotomize
            ? t("dangerModeOffAnnouncement")
            : t("dangerModeArmedAnnouncement"));
    };

    const handleSprintChange = (value: string) => {
        selectedSprintIdSignal.value = value || undefined;
        const sprint = sprints.find((item) => item.id === value);
        setAnnouncement(sprint ? t("sprintFilterSet", { number: sprint.number ?? "?" }) : t("sprintFilterCleared"));
    };

    const handleAgentChange = (value: string) => {
        selectedAgentPresetIdSignal.value = value || undefined;
        const agent = agentPresets.find((item) => item.id === value);
        setAnnouncement(agent ? t("agentFilterSet", { name: agent.name }) : t("agentFilterAll"));
    };

    return (
        <div className="flex w-full min-w-0 max-w-full flex-col gap-3 overflow-hidden rounded-2xl border border-black/[0.06] bg-white/70 p-3 shadow-[0_18px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.045] dark:shadow-[0_18px_54px_rgba(0,0,0,0.28)] lg:w-[min(52rem,52vw)] xl:w-[52rem]">
            <div className="flex w-full min-w-0 flex-col gap-2">
                <div className="flex w-full min-w-0 flex-wrap items-stretch gap-2" role="tablist" aria-label={t("memoryTier")} aria-describedby="memory-filter-status">
                    {TIER_TABS.map(tab => {
                        const count = tab.key === "short_term"
                            ? shortTermCount
                            : tab.key === "long_term" ? longTermCount : skillsCount;
                        const tabCountLabel = tp(tab.key === "skills" ? "skill" : "memory", count, { formattedCount: formatNumber(count) });
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
                                className={`flex min-h-14 min-w-0 flex-[1_1_8.75rem] flex-col items-start justify-center gap-1 rounded-xl border px-3 py-2 text-left leading-tight cursor-pointer motion-reduce:duration-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 sm:flex-none sm:basis-[10rem]
                                ${activeTier === tab.key
                                    ? "bg-signal-500/[0.14] border-signal-500/40 text-signal-700 shadow-[0_0_0_2px_rgba(0,224,160,0.08)] hover:bg-signal-500/[0.2] dark:text-signal-300"
                                    : "bg-black/[0.035] dark:bg-white/[0.04] border-transparent text-slate-500 hover:bg-black/[0.07] dark:hover:bg-white/[0.08] hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em]">{t(tab.labelKey)}</span>
                                <span id={`tab-${tab.key}-count`} className="text-base font-bold font-display text-slate-900 dark:text-white">
                                    {tabCountLabel}
                                </span>
                            </button>
                        );
                    })}
                </div>
                <div id="memory-filter-status" className="min-w-0 text-left text-[11px] font-semibold leading-snug text-slate-500 dark:text-slate-400" title={currentScopeCopy}>
                    {currentScopeCopy}
                </div>
            </div>
            <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
            <div className="flex w-full min-w-0 flex-wrap items-start gap-2.5 rounded-xl border border-black/[0.05] bg-black/[0.025] p-2 dark:border-white/[0.06] dark:bg-black/[0.12]" role="group" aria-label={t("memoryScopeFilters")}>
                {/* Sprint selector — only for Short Term */}
                {showSprintFilter && (
                    <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 sm:max-w-[18rem]">
                        <label htmlFor="sprint-selector" className="sr-only">{t("filterBySprint")}</label>
                        <AvantgardeSelect
                            id="sprint-selector"
                            aria-label={t("filterMemoryBySprint")}
                            aria-describedby="sprint-selector-status"
                            title={t("filterMemoryBySprint")}
                            value={selectedSprintId ?? ""}
                            onChange={handleSprintChange}
                            variant="card"
                            className="w-full min-w-0"
                            options={[
                                { value: "", label: t("allSprints") },
                                ...sprints.map((s) => ({
                                    value: s.id,
                                    label: `${t("sprintNumber", { number: s.number ?? "?" })} — ${s.name || s.goal?.slice(0, 40) || s.id.slice(0, 8)}`,
                                })),
                            ]}
                        />
                        <span id="sprint-selector-status" className="min-w-0 text-[10px] font-semibold leading-snug text-slate-400">
                            {sprintLabel}
                        </span>
                    </div>
                )}
                {/* Agent selector — both tiers */}
                {showAgentFilter && (
                    <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-1 sm:max-w-[18rem]">
                        <label htmlFor="agent-selector" className="sr-only">{t("filterByAgentPreset")}</label>
                        <AvantgardeSelect
                            id="agent-selector"
                            aria-label={t("filterMemoryByAgentPreset")}
                            aria-describedby="agent-selector-status"
                            title={t("filterMemoryByAgentPreset")}
                            value={selectedAgentPresetId ?? ""}
                            onChange={handleAgentChange}
                            variant="card"
                            className="w-full min-w-0"
                            options={[
                                { value: "", label: t("allAgents") },
                                ...agentPresets.map((agent) => ({ value: agent.id, label: agent.name })),
                            ]}
                        />
                        <span id="agent-selector-status" className="min-w-0 text-[10px] font-semibold leading-snug text-slate-400">
                            {agentLabel}
                        </span>
                    </div>
                )}
                {!hasScopeFilters && (
                    <p className="flex min-h-9 min-w-0 flex-1 items-center px-1 text-[11px] font-semibold leading-snug text-slate-400">
                        {unavailableScopeCopy}
                    </p>
                )}
                {unavailablePartialScopeCopy && (
                    <p className="flex min-h-9 min-w-0 flex-[1_1_12rem] items-center px-1 text-[11px] font-semibold leading-snug text-slate-400 sm:max-w-[18rem]">
                        {unavailablePartialScopeCopy}
                    </p>
                )}
            </div>
            {activeTier !== "skills" && <div className="flex w-full min-w-0 flex-wrap items-start justify-between gap-2.5" role="group" aria-label={t("memoryActions")}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button type="button" onClick={() => setShowAddModal(true)}
                        aria-label={t("addMemory")}
                        style={controlTransitionStyle}
                        className="flex min-h-9 min-w-0 flex-[1_1_8.5rem] items-center justify-center gap-1.5 whitespace-normal rounded-xl px-4 py-2 text-xs font-bold leading-tight
                                   bg-signal-500/10 text-signal-500 hover:bg-signal-500/20
                                   border border-signal-500/20
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900
                                   transition-[background-color,border-color,box-shadow,color] motion-reduce:duration-0 sm:flex-none">
                        <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> {t("addMemory")}
                    </button>
                </div>
                <div className="flex min-w-0 flex-col items-start gap-1 sm:items-end">
                    <button type="button" aria-pressed={lobotomize} onClick={handleDangerToggle}
                        aria-label={t(lobotomize ? "disableDangerDelete" : "enableDangerDelete")}
                        aria-describedby="danger-delete-mode-copy"
                        style={controlTransitionStyle}
                        className={`flex min-h-9 min-w-0 flex-[1_1_12rem] items-center justify-center gap-2.5 whitespace-normal rounded-xl px-4 py-2 text-xs font-bold leading-tight border
                                   transition-[background-color,box-shadow,border-color,color] motion-reduce:duration-0
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-900 sm:flex-none
                                   ${lobotomize
                                       ? "bg-status-red text-white border-status-red ring-2 ring-status-red/30 ring-offset-2 ring-offset-white shadow-[0_0_28px_rgba(227,0,15,0.42)] hover:bg-status-red/90 hover:shadow-[0_0_36px_rgba(227,0,15,0.58)] active:bg-status-red/80 active:shadow-[0_0_12px_rgba(227,0,15,0.5)] dark:ring-offset-void-900"
                                       : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:border-status-red/50 hover:text-status-red hover:bg-status-red/[0.04] active:bg-status-red/10 active:border-status-red/60"
                                   }`}>
                        <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                        <span>{t(lobotomize ? "dangerDeleteArmed" : "dangerDeleteOff")}</span>
                    </button>
                </div>
            </div>}
            {activeTier !== "skills" && <p
                id="danger-delete-mode-copy"
                className={`w-full min-w-0 text-left text-[11px] font-semibold leading-snug ${lobotomize ? "text-status-red" : "text-slate-400"}`}
                style={inlineValidationStyle}
            >
                {lobotomize
                    ? t("dangerDeleteArmedDescription")
                    : t("dangerDeleteOffDescription")}
            </p>}
        </div>
    );
};
