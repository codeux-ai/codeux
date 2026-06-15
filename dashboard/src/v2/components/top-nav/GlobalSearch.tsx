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

interface GlobalSearchProps {
    projectId: string | null;
    selectedProject: Source | null;
    sprints: Sprint[];
}

export const GlobalSearch: FunctionComponent<GlobalSearchProps> = ({ projectId, selectedProject, sprints }) => {
    const searchBarRef = useRef<HTMLButtonElement>(null);
    const searchBarContainerRef = useRef<HTMLDivElement>(null);

    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);

    const { tasks } = useProjectTasks(projectId, selectedProject ? [selectedProject] : [], sprints, null);
    const { sessions } = usePreviewSessions({ projectId: isSearchOpen ? projectId : null, pollInterval: 0 });

    useEffect(() => {
        if (isSearchOpen && selectedProject?.id) {
            void fetchAgentPresets(selectedProject.id)
                .then(setAgentPresets)
                .catch(console.error);
        }
    }, [isSearchOpen, selectedProject?.id]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedQuery(searchQuery), 200);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    useEffect(() => {
        const handleCmdK = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
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
            scaleX: 1.05,
            duration: 0.35,
            ease: "expo.out",
            boxShadow: "0 0 0 2px rgba(0,224,160,0.3)",
            overwrite: "auto"
        });
    };

    const handleSearchLeave = () => {
        if (!searchBarContainerRef.current) return;
        gsap.to(searchBarContainerRef.current, {
            scaleX: 1,
            duration: 0.35,
            ease: "expo.out",
            boxShadow: "0 0 0 0px rgba(0,224,160,0)",
            overwrite: "auto"
        });
    };

    const searchResults = useMemo(() => {
        if (!debouncedQuery.trim()) {
            return { sprints: [], tasks: [], agents: [], containers: [] };
        }

        const lowerQuery = debouncedQuery.toLowerCase();

        const filteredSprints = sprints.filter(s =>
            s.name.toLowerCase().includes(lowerQuery) ||
            `spr-${s.number}`.includes(lowerQuery)
        ).map(s => ({
            id: s.id,
            title: `SPR-${s.number}: ${s.name}`,
            status: s.status
        }));

        const filteredTasks = (tasks || []).filter((t: Task) =>
            t.title.toLowerCase().includes(lowerQuery) ||
            (t.recordId && t.recordId.toLowerCase().includes(lowerQuery)) ||
            (t.description && t.description.toLowerCase().includes(lowerQuery))
        ).map((t: Task) => ({
            id: t.id,
            title: t.title,
            sprint: t.sprint,
            sprintId: t.sprintId,
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
            status: s.status
        }));

        return {
            sprints: filteredSprints,
            tasks: filteredTasks,
            agents: filteredAgents,
            containers: filteredContainers
        };
    }, [debouncedQuery, sprints, tasks, selectedProject, sessions]);

    return (
        <>
            {/* Search Bar */}
            <div ref={searchBarContainerRef} className="relative group w-full max-w-[140px] sm:max-w-xs hidden md:block rounded-xl">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none z-10">
                    <Search aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 group-focus-within:text-signal-500 transition-colors" strokeWidth={2} />
                </div>
                <button
                    ref={searchBarRef}
                    type="button"
                    onClick={() => setIsSearchOpen(true)}
                    onMouseEnter={handleSearchEnter}
                    onMouseLeave={handleSearchLeave}
                    onFocus={handleSearchEnter}
                    onBlur={handleSearchLeave}
                    className="w-full h-9 pl-10 pr-4 sm:pr-12 bg-black/[0.04] dark:bg-white/[0.04] border border-transparent hover:border-black/[0.08] dark:hover:border-white/[0.08] rounded-xl text-sm text-left text-slate-400 focus:outline-none focus-visible:outline-none transition-all relative z-0"
                >
                    Search...
                </button>
                <div className="absolute inset-y-0 right-0 pr-3 hidden sm:flex items-center pointer-events-none z-10">
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono font-medium text-slate-400 border border-black/10 dark:border-white/10 rounded-md">
                        <Command aria-hidden="true" className="w-2.5 h-2.5" /> K
                    </kbd>
                </div>
            </div>
            {/* Mobile/Tablet Search Trigger */}
            <button
                type="button"
                onClick={() => setIsSearchOpen(true)}
                aria-label="Open search"
                className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30 md:hidden shrink-0"
            >
                <Search aria-hidden="true" className="w-4 h-4 text-slate-600 dark:text-slate-300" strokeWidth={2} />
            </button>

            <SearchOverlay
                anchorRef={searchBarContainerRef}
                isOpen={isSearchOpen}
                onClose={() => setIsSearchOpen(false)}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                results={searchResults}
                isLoading={searchQuery !== debouncedQuery}
            />
        </>
    );
};
