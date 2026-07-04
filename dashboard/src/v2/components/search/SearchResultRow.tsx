import { FunctionComponent } from "preact";
import { Target, ListChecks, Cpu, Compass, ArrowRight, Ban } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { AgentAvatarSvg } from "../agents/AgentAvatarSvg.js";
import type { AgentSearchItem, ContainerSearchItem, SearchCategoryId, SearchItem, SprintSearchItem, TaskSearchItem } from "./SearchOverlay";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

interface SearchResultRowProps {
    item: SearchItem;
    categoryType: SearchCategoryId;
    searchQuery: string;
    globalItemIndex: number;
    isFocused: boolean;
    onFocus: () => void;
    activeItemRef: preact.Ref<HTMLAnchorElement> | null;
    onClick?: () => void;
}

const disabledStatuses = new Set(["unavailable", "disabled"]);

function getDisabledReason(item: SearchItem): string | undefined {
    if (!item.status || !disabledStatuses.has(item.status)) return undefined;
    return item.status === "disabled" ? "Disabled" : "Unavailable";
}

export const SearchResultRow: FunctionComponent<SearchResultRowProps> = ({
    item,
    categoryType,
    searchQuery,
    globalItemIndex,
    isFocused,
    onFocus,
    activeItemRef,
    onClick,
}) => {
    const interactionTokens = useInteractionTokens();
    const transitionDuration = interactionTokens.selectionMovement.duration;
    const transitionTimingFunction = interactionTokens.selectionMovement.ease;
    const avatarConfig = "avatarConfig" in item ? item.avatarConfig : null;
    const disabledReason = getDisabledReason(item);
    const isDisabled = Boolean(disabledReason);
    const disabledDescriptionId = isDisabled ? `search-result-${item.id}-disabled-reason` : undefined;
    let Icon = Target;
    let itemId = item.id;
    let title = 'title' in item ? item.title : item.name;
    let typeLabel = 'Result';
    let badgeText = '';
    let badgeColorClass = 'text-slate-400 bg-black/5 dark:bg-white/5';
    let showDot = false;
    let dotColorClass = 'bg-slate-400';

    let targetTo = "";
    let targetSearch = {};

    if (categoryType === 'sprints') {
        const sprintItem = item as SprintSearchItem;
        Icon = Target;
        typeLabel = 'Sprint';
        targetTo = "/sprints";
        itemId = sprintItem.displayKey;
        title = sprintItem.title;
        targetSearch = { sprintId: sprintItem.routeSprintId, sprintKey: sprintItem.sprintKey };
        badgeText = sprintItem.status || 'Active';
        if (sprintItem.status === 'completed') badgeColorClass = 'text-status-green bg-status-green/10';
        else if (sprintItem.status === 'active') badgeColorClass = 'text-signal-500 bg-signal-500/10';
    } else if (categoryType === 'tasks') {
        const taskItem = item as TaskSearchItem;
        Icon = ListChecks;
        typeLabel = 'Task';
        targetTo = "/tasks";
        targetSearch = { taskId: taskItem.routeTaskId, sprintId: taskItem.routeSprintId };
        itemId = taskItem.id;
        badgeText = taskItem.status || 'Open';
        if (taskItem.status === 'done') badgeColorClass = 'text-status-green bg-status-green/10';
        else if (taskItem.status === 'in_progress') badgeColorClass = 'text-signal-500 bg-signal-500/10';
    } else if (categoryType === 'agents') {
        const agentItem = item as AgentSearchItem;
        Icon = Cpu;
        typeLabel = 'Agent';
        targetTo = "/agents";
        targetSearch = { agentId: agentItem.routeAgentId };
        showDot = true;
        itemId = agentItem.id;
        badgeText = agentItem.status || 'Offline';
        if (agentItem.status === 'idle') dotColorClass = 'bg-slate-400';
        else if (agentItem.status === 'running' || agentItem.status === 'active') dotColorClass = 'bg-status-green animate-pulse';
    } else if (categoryType === 'containers') {
        const containerItem = item as ContainerSearchItem;
        Icon = Compass;
        typeLabel = 'Preview';
        targetTo = "/browser";
        targetSearch = { containerId: containerItem.routeContainerId };
        showDot = true;
        itemId = containerItem.id;
        badgeText = containerItem.status || 'Stopped';
        if (containerItem.status === 'running') {
            dotColorClass = 'bg-status-green animate-pulse';
            badgeText = 'Running';
        } else {
             dotColorClass = 'bg-status-red';
        }
    }

    // Highlight matches in the title
    const renderTitle = () => {
        if (!searchQuery || !title) return title;
        const lowerTitle = title.toLowerCase();
        const lowerQuery = searchQuery.toLowerCase();
        const startIndex = lowerTitle.indexOf(lowerQuery);
        if (startIndex === -1) return title;

        const endIndex = startIndex + searchQuery.length;
        const beforeMatch = title.substring(0, startIndex);
        const matchText = title.substring(startIndex, endIndex);
        const afterMatch = title.substring(endIndex);

        return (
            <>
                {beforeMatch}
                <mark className="bg-signal-500/20 text-signal-700 dark:text-signal-400 rounded-[2px] font-medium px-0.5">{matchText}</mark>
                {afterMatch}
            </>
        );
    };

    return (
        <Link
            to={targetTo as any}
            search={targetSearch as any}
            onClick={(e: MouseEvent) => {
                if (isDisabled) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                onClick?.();
            }}
            id={`search-result-${item.id}`}
            ref={activeItemRef as any}
            onMouseEnter={() => {
                if (!isDisabled) onFocus();
            }}
            tabIndex={-1}
            data-result-index={globalItemIndex}
            data-selected={isFocused ? "true" : undefined}
            aria-disabled={isDisabled ? 'true' : undefined}
            aria-describedby={disabledDescriptionId}
            aria-label={`${categoryType} result: ${itemId} ${title}${badgeText ? `, ${badgeText}` : ''}${disabledReason ? `, ${disabledReason}` : ''}`}
            role="option"
            aria-selected={isFocused && !isDisabled}
            style={{ transitionDuration, transitionTimingFunction }}
            className={`group relative flex w-full min-w-0 items-stretch overflow-hidden text-left rounded-[1.25rem] border px-3.5 py-3 transition-[background-color,border-color,box-shadow,color,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-800 sm:px-4 ${
                isDisabled
                    ? 'border-black/[0.06] bg-black/[0.025] text-slate-500 shadow-none dark:border-white/[0.06] dark:bg-white/[0.025] dark:text-slate-500'
                    : isFocused
                    ? 'translate-y-[-1px] border-signal-500/55 bg-signal-500/[0.09] shadow-[0_12px_32px_rgba(0,224,160,0.13),inset_0_0_0_1px_rgba(0,224,160,0.14)] backdrop-blur-2xl motion-reduce:translate-y-0 dark:bg-signal-500/[0.11]'
                    : 'border-black/[0.06] bg-white/58 backdrop-blur-xl hover:border-black/[0.1] hover:bg-white/86 dark:border-white/[0.06] dark:bg-white/[0.035] dark:hover:border-white/[0.11] dark:hover:bg-white/[0.06]'
            } aria-disabled:cursor-not-allowed aria-disabled:opacity-75`}
        >
            <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-y-3 left-2 w-1 rounded-full bg-signal-500 transition-opacity ${
                    isFocused && !isDisabled ? 'opacity-100' : 'opacity-0 group-focus-visible:opacity-80'
                }`}
                style={{ transitionDuration, transitionTimingFunction }}
            />
            <span
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 bg-signal-500/[0.045] transition-opacity ${
                    isFocused && !isDisabled ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ transitionDuration, transitionTimingFunction }}
            />

            <div className="relative z-10 flex w-full min-w-0 items-start gap-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                    isDisabled ? 'border-black/[0.05] bg-black/[0.035] text-slate-400 dark:border-white/[0.05] dark:bg-white/[0.035] dark:text-slate-500' : isFocused ? 'border-signal-500/25 bg-signal-500/12 text-signal-500' : 'border-black/[0.05] bg-black/[0.04] text-slate-500 group-hover:text-slate-700 dark:border-white/[0.06] dark:bg-white/[0.05] dark:text-slate-400 dark:group-hover:text-slate-200'
                }`} style={{ transitionDuration, transitionTimingFunction }}>
                    {avatarConfig ? (
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                            <AgentAvatarSvg config={avatarConfig} expression="happy" size={20} static />
                        </div>
                    ) : (
                        <Icon className="h-[18px] w-[18px]" strokeWidth={isFocused ? 2 : 1.5} aria-hidden="true" />
                    )}
                </div>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="shrink-0 rounded-md border border-black/[0.06] bg-black/[0.035] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-400">
                            {typeLabel}
                        </span>
                        <span className="min-w-0 max-w-full truncate rounded-md bg-black/[0.045] px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
                            {itemId}
                        </span>
                    </div>

                    <div className="flex min-w-0 items-start justify-between gap-3">
                        <span className={`min-w-0 flex-1 break-words text-sm font-semibold leading-5 transition-colors [overflow-wrap:anywhere] ${
                            isDisabled ? 'text-slate-500 dark:text-slate-500' : isFocused ? 'text-signal-700 dark:text-signal-400' : 'text-slate-800 group-hover:text-slate-950 dark:text-slate-200 dark:group-hover:text-white'
                        }`} style={{ transitionDuration, transitionTimingFunction }}>
                            {renderTitle()}
                        </span>

                        <div className="flex shrink-0 items-center gap-2 pt-0.5">
                            {showDot && (
                                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                                    <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColorClass} ${dotColorClass.includes('animate-pulse') ? 'animate-ping' : ''}`}></span>
                                    <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColorClass.replace('animate-pulse', '')}`}></span>
                                </span>
                            )}
                            {badgeText && !showDot && (
                                <span className={`shrink-0 rounded-full border border-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest dark:border-white/[0.06] ${badgeColorClass}`}>
                                    {badgeText}
                                </span>
                            )}
                            {showDot && badgeText && (
                                <span className="max-w-24 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500 dark:text-slate-400">
                                    {badgeText}
                                </span>
                            )}
                            {disabledReason && (
                                <span
                                    id={disabledDescriptionId}
                                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-red/20 bg-status-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-status-red"
                                >
                                    <Ban className="h-3 w-3" aria-hidden="true" />
                                    {disabledReason}
                                </span>
                            )}
                            <span
                                className={`shrink-0 transition-[color,opacity,transform] ${
                                    isDisabled ? 'text-slate-300 opacity-35 dark:text-slate-600' : isFocused ? 'translate-x-0 text-signal-500 opacity-100' : 'translate-x-0 text-slate-400 opacity-60 group-hover:opacity-80'
                                } motion-reduce:translate-x-0`}
                                style={{ transitionDuration, transitionTimingFunction }}
                            >
                                <ArrowRight className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Link>
    );
};
