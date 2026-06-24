import { FunctionComponent } from "preact";
import { Target, ListChecks, Cpu, Compass, ArrowRight } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { AgentAvatarSvg } from "../agents/AgentAvatarSvg.js";
import type { SearchItem } from "./SearchOverlay";
import { INTERACTION_TOKENS } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface SearchResultRowProps {
    item: SearchItem;
    categoryType: string;
    searchQuery: string;
    globalItemIndex: number;
    isFocused: boolean;
    onFocus: () => void;
    activeItemRef: preact.Ref<HTMLButtonElement> | null;
    onClick?: () => void;
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
    const reducedMotion = useReducedMotion();
    const transitionDuration = reducedMotion ? "0ms" : INTERACTION_TOKENS.selectionMovement.duration;
    const transitionTimingFunction = reducedMotion ? "none" : INTERACTION_TOKENS.selectionMovement.ease;
    // Determine icon and specific formatting based on category
    let Icon = Target;
    let itemId = item.id;
    let title = 'title' in item ? item.title : item.name;
    let badgeText = '';
    let badgeColorClass = 'text-slate-400 bg-black/5 dark:bg-white/5';
    let showDot = false;
    let dotColorClass = 'bg-slate-400';

    let targetTo = "";
    let targetSearch = {};

    if (categoryType === 'sprints') {
        Icon = Target;
        targetTo = "/sprints";
        // The TopNav formats title as `SPR-XX: Name`, let's extract it
        const match = title?.match(/^(SPR-\d+):\s*(.*)$/);
        if (match) {
            itemId = match[1];
            title = match[2];
        } else {
             // fallback if format isn't matched
            itemId = 'SPR';
        }
        targetSearch = { sprintId: item.id };
        badgeText = item.status || 'Active';
        if (item.status === 'completed') badgeColorClass = 'text-status-green bg-status-green/10';
        else if (item.status === 'active') badgeColorClass = 'text-signal-500 bg-signal-500/10';
    } else if (categoryType === 'tasks') {
        Icon = ListChecks;
        targetTo = "/tasks";
        targetSearch = { taskId: item.id, sprintId: item.sprintId };
        // Typically tsk-something
        itemId = item.id.substring(0, 8);
        badgeText = item.status || 'Open';
        if (item.status === 'done') badgeColorClass = 'text-status-green bg-status-green/10';
        else if (item.status === 'in_progress') badgeColorClass = 'text-signal-500 bg-signal-500/10';
    } else if (categoryType === 'agents') {
        Icon = Cpu;
        targetTo = "/agents";
        targetSearch = { agentId: item.id };
        showDot = true;
        itemId = item.id.split('-')[0] || 'AGT'; // Or however it's formatted
        badgeText = item.status || 'Offline';
        if (item.status === 'idle') dotColorClass = 'bg-slate-400';
        else if (item.status === 'running' || item.status === 'active') dotColorClass = 'bg-status-green animate-pulse';
    } else if (categoryType === 'containers') {
        Icon = Compass;
        targetTo = "/browser";
        targetSearch = { containerId: item.id };
        showDot = true;
        itemId = item.id.substring(0, 8);
        badgeText = item.status || 'Stopped';
        if (item.status === 'running') {
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
            onClick={item.status === 'unavailable' || item.status === 'disabled' ? (e: any) => e.preventDefault() : onClick}
            id={`search-result-${categoryType}-${item.id}`}
            ref={activeItemRef as any}
            onMouseEnter={onFocus}
            aria-disabled={item.status === 'unavailable' || item.status === 'disabled' ? 'true' : undefined}
            aria-label={`${categoryType} result: ${title}`}
            role="option"
            tabIndex={-1}
            aria-selected={isFocused}
            style={{ transitionDuration, transitionTimingFunction }}
            className={`group relative flex items-center justify-between w-full text-left px-4 py-3 rounded-[1.25rem] transition-all overflow-hidden ${
                isFocused
                    ? 'bg-signal-500/8 dark:bg-signal-500/10 border-signal-500/20 shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-2xl'
                    : 'bg-white/50 dark:bg-void-800/40 hover:bg-white/80 dark:hover:bg-void-700/60 border-black/5 dark:border-white/5 backdrop-blur-xl'
            } border aria-disabled:opacity-50 aria-disabled:pointer-events-none`}
        >
            {/* Hover/Focus Background Glow */}
            {isFocused && (
                <div className="absolute inset-0 bg-gradient-to-r from-signal-500/5 to-transparent pointer-events-none" />
            )}

            <div className="flex items-center gap-4 relative z-10 w-full overflow-hidden">
                <div className={`p-2 rounded-xl transition-colors duration-200 shrink-0 ${
                    isFocused ? 'bg-signal-500/15 text-signal-500' : 'bg-black/5 dark:bg-white/5 text-slate-500 dark:text-slate-400 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                }`}>
                    {item.avatarConfig ? (
                        <div className="w-5 h-5 flex items-center justify-center shrink-0">
                            <AgentAvatarSvg config={item.avatarConfig} expression="happy" size={20} static />
                        </div>
                    ) : (
                        <Icon className="w-5 h-5" strokeWidth={isFocused ? 2 : 1.5} />
                    )}
                </div>

                <div className="flex flex-col min-w-0 flex-1 gap-0.5">
                    <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-slate-400 dark:text-slate-500 shrink-0">
                            {itemId}
                        </span>
                        <span className={`font-semibold truncate transition-colors duration-200 ${
                            isFocused ? 'text-signal-600 dark:text-signal-400' : 'text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white'
                        }`}>
                            {renderTitle()}
                        </span>
                    </div>

                    <div className="flex items-center gap-2 mt-0.5">
                        {showDot && (
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColorClass} ${dotColorClass.includes('animate-pulse') ? 'animate-ping' : ''}`}></span>
                                <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColorClass.replace('animate-pulse', '')}`}></span>
                            </span>
                        )}
                        {badgeText && !showDot && (
                            <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full ${badgeColorClass} border border-black/5 dark:border-white/5 shrink-0`}>
                                {badgeText}
                            </span>
                        )}
                        {showDot && badgeText && (
                            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                {badgeText}
                            </span>
                        )}
                    </div>
                </div>

                <div className={`shrink-0 transition-all duration-300 ${
                    isFocused ? 'opacity-100 translate-x-0 text-signal-500' : 'opacity-0 -translate-x-2 text-slate-400'
                }`}>
                    <ArrowRight className="w-5 h-5" strokeWidth={2} />
                </div>
            </div>
        </Link>
    );
};
