import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Search, Command } from "lucide-preact";
import { SearchOverlay } from "../search/SearchOverlay.js";
import { useProjectTasks } from "../../hooks/use-project-tasks.js";
import { usePreviewSessions } from "../../hooks/use-preview-sessions.js";
import type { SprintPreviewSession } from "../../../types.js";
import type { Task, Source, Sprint, AgentPreset } from "../../types.js";
import { fetchAgentPresets } from "../../lib/agent-preset-api.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { formatSprintDisplay, formatSprintTitle } from "../../lib/format-sprint.js";
import { formatSprintKey } from "../../lib/sprint-ledger-state.js";

interface GlobalSearchProps {
    projectId: string | null;
    selectedProject: Source | null;
    sprints: Sprint[];
    sprintKeyPrefix?: string;
}

export const GlobalSearch: FunctionComponent<GlobalSearchProps> = ({ projectId, selectedProject, sprints, sprintKeyPrefix = "SPR" }) => {
    const searchBarRef = useRef<HTMLButtonElement>(null);
    const searchBarContainerRef = useRef<HTMLDivElement>(null);

    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);

    const gsapTokens = useGsapInteractionTokens();
    const interactionTokens = useInteractionTokens();
    const searchDebounceMs = Math.round(gsapTokens.controlFeedback.duration * 1000);
    const { tasks } = useProjectTasks(projectId, selectedProject ? [selectedProject] : [], sprints, null, {
        enabled: isSearchOpen,
    });
    const { sessions } = usePreviewSessions({ projectId: isSearchOpen ? projectId : null, pollInterval: isSearchOpen ? 5000 : 0 });

    useEffect(() => {
        if (isSearchOpen && selectedProject?.id) {
            void fetchAgentPresets(selectedProject.id)
                .then(setAgentPresets)
                .catch(console.error);
        }
    }, [isSearchOpen, selectedProject?.id]);

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(searchQuery), searchDebounceMs);
        return () => clearTimeout(timer);
    }, [searchQuery, searchDebounceMs]);

    useEffect(() => {
        const handleCmdK = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                const target = e.target as HTMLElement;
                if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
                    return;
                }
                e.preventDefault();
                setIsSearchOpen(true);
            }
        };
        document.addEventListener('keydown', handleCmdK);
        return () => document.removeEventListener('keydown', handleCmdK);
    }, []);

    const handleSearchEnter = () => {
        if (!searchBarContainerRef.current) return;
        gsap.to(searchBarContainerRef.current, {
            scale: 1,
            duration: gsapTokens.controlFeedback.duration,
            ease: gsapTokens.controlFeedback.ease,
            boxShadow: "0 10px 30px rgba(0,0,0,0.08), 0 0 0 2px rgba(0,224,160,0.24)",
            overwrite: "auto"
        });
    };

    const handleSearchLeave = () => {
        if (!searchBarContainerRef.current || isSearchOpen) return;
        gsap.to(searchBarContainerRef.current, {
            scale: 1,
            duration: gsapTokens.controlFeedback.duration,
            ease: gsapTokens.controlFeedback.ease,
            boxShadow: "0 0 0 0px rgba(0,224,160,0)",
            overwrite: "auto"
        });
    };

    useEffect(() => {
        if (!isSearchOpen) {
            handleSearchLeave();
        } else {
            handleSearchEnter();
        }
    }, [isSearchOpen, gsapTokens.controlFeedback.duration, gsapTokens.controlFeedback.ease]);

    const searchResults = useMemo(() => {
        if (!debouncedQuery.trim()) {
            return { sprints: [], tasks: [], agents: [], containers: [] };
        }

        const lowerQuery = debouncedQuery.toLowerCase();

        const filteredSprints = sprints.filter((s) => {
            const formattedKey = formatSprintKey(s, sprintKeyPrefix);
            const haystack = [
                s.name,
                s.goal,
                s.slug,
                s.id,
                s.number == null ? "" : String(s.number),
                formattedKey,
                formatSprintDisplay(s, sprintKeyPrefix),
                s.status,
            ].join(" ").toLowerCase();
            return haystack.includes(lowerQuery);
        }).map(s => {
            const formattedKey = formatSprintKey(s, sprintKeyPrefix);
            return {
                id: s.id,
                title: formatSprintTitle(s, sprintKeyPrefix),
                displayKey: formattedKey,
                sprintKey: formattedKey,
                routeSprintId: s.id,
                status: s.status
            };
        });

        const filteredTasks = (tasks || []).filter((t: Task) =>
            t.title.toLowerCase().includes(lowerQuery) ||
            (t.recordId && t.recordId.toLowerCase().includes(lowerQuery)) ||
            (t.description && t.description.toLowerCase().includes(lowerQuery))
        ).map((t: Task) => ({
            id: t.id,
            title: t.title,
            sprint: t.sprint,
            sprintId: t.sprintId,
            routeTaskId: t.id,
            routeSprintId: t.sprintId,
            status: t.status
        }));

        const filteredAgents = (selectedProject?.agentBindings || []).filter(a =>
            a.workerDisplayName?.toLowerCase().includes(lowerQuery) ||
            a.workerEndpointType?.toLowerCase().includes(lowerQuery)
        ).map(a => {
            const preset = agentPresets.find(p => p.id === a.workerEndpointId);
            return {
                id: a.id || `${a.workerEndpointType}-${a.workerDisplayName}`,
                name: a.workerDisplayName || a.workerEndpointType,
                routeAgentId: a.id || `${a.workerEndpointType}-${a.workerDisplayName}`,
                status: 'idle',
                avatarConfig: preset?.avatarConfig
            };
        });

        const filteredContainers = sessions.filter((s: SprintPreviewSession) =>
            (s.containerName && s.containerName.toLowerCase().includes(lowerQuery)) ||
            (s.sprintId && s.sprintId.toLowerCase().includes(lowerQuery))
        ).map((s: SprintPreviewSession) => ({
            id: s.id,
            name: s.containerName || 'Unnamed Container',
            routeContainerId: s.id,
            status: s.status
        }));

        return {
            sprints: filteredSprints,
            tasks: filteredTasks,
            agents: filteredAgents,
            containers: filteredContainers
        };
    }, [debouncedQuery, sprints, sprintKeyPrefix, tasks, selectedProject, agentPresets, sessions]);

    return (
        <>
            {/* Search Bar */}
            <div
                ref={searchBarContainerRef}
                role="search"
                style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                className="group relative hidden w-full max-w-[168px] rounded-xl transition-[box-shadow,transform] md:block lg:max-w-[260px]"
            >
                <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex items-center pl-3.5">
                    <Search aria-hidden="true" className="h-3.5 w-3.5 text-slate-500 transition-colors group-focus-within:text-signal-500 dark:text-slate-400" strokeWidth={2} />
                </div>
                <button
                    ref={searchBarRef}
                    type="button"
                    onClick={() => setIsSearchOpen(true)}
                    onMouseEnter={handleSearchEnter}
                    onMouseLeave={handleSearchLeave}
                    onFocus={handleSearchEnter}
                    onBlur={handleSearchLeave}
                    style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                    className="relative z-0 flex h-9 w-full items-center rounded-xl border border-black/[0.08] bg-white/88 pl-9 pr-12 text-left text-sm font-medium text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),0_1px_10px_rgba(15,23,42,0.05)] backdrop-blur-xl transition-colors hover:border-black/[0.12] hover:bg-white focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.1] dark:bg-white/[0.11] dark:text-slate-200 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.2)] dark:hover:border-white/[0.16] dark:hover:bg-white/[0.15]"
                    aria-expanded={isSearchOpen}
                    aria-haspopup="dialog"
                    aria-controls={isSearchOpen ? "global-search-overlay" : undefined}
                >
                    <span className="block min-w-0 truncate">Search workspace</span>
                </button>
                <div className="pointer-events-none absolute inset-y-0 right-0 z-10 hidden items-center pr-2.5 lg:flex">
                    <kbd className="inline-flex h-5 min-w-9 items-center justify-center gap-0.5 rounded-md border border-black/[0.08] bg-black/[0.035] px-1.5 font-mono text-[9px] font-semibold text-slate-500 shadow-sm dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-400">
                        <Command aria-hidden="true" className="h-2.5 w-2.5" /> K
                    </kbd>
                </div>
            </div>
            {/* Mobile/Tablet Search Trigger */}
            <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                aria-label="Open search"
                aria-expanded={isSearchOpen}
                aria-haspopup="dialog"
                aria-controls={isSearchOpen ? "global-search-overlay" : undefined}
                style={{ transitionDuration: interactionTokens.controlFeedback.duration, transitionTimingFunction: interactionTokens.controlFeedback.ease }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] bg-white/88 shadow-sm backdrop-blur-xl transition-colors hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.1] dark:bg-white/[0.11] dark:hover:bg-white/[0.15] md:hidden"
            >
                <Search aria-hidden="true" className="h-4 w-4 text-slate-600 dark:text-slate-300" strokeWidth={2} />
            </button>

            <SearchOverlay
                anchorRef={searchBarContainerRef}
                committedSearchQuery={debouncedQuery}
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                results={searchResults}
                isLoading={searchQuery !== debouncedQuery}
                hasProjectData={!!selectedProject}
            />
        </>
    );
};
