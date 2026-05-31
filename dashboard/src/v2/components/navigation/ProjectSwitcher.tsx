import { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo, useRef, useState, useLayoutEffect, useEffect } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import { ChevronDown, FolderOpen, ArrowRight } from "lucide-preact";
import { StatusDot } from "../ui/StatusDot.js";
import { AddProjectModal } from "../ui/AddProjectModal.js";
import { useDropdownKeyboard } from "../../hooks/useDropdownKeyboard.js";
import { useProjectData } from "../../context/project-data.js";
import { useSprints } from "../../../hooks/useSprints.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { formatSprintDisplay } from "../../lib/format-sprint.js";

export const ProjectSwitcher: FunctionComponent = memo(() => {
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showAddProject, setShowAddProject] = useState(false);
    const [projectSwitchBusy, setProjectSwitchBusy] = useState(false);
    const [projectFilter, setProjectFilter] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [sprintFilter, setSprintFilter] = useState('');
    const [sprintDropdownOpen, setSprintDropdownOpen] = useState(false);
    const sprintDropdownRef = useRef<HTMLDivElement>(null);
    const [sprintDropdownWidth, setSprintDropdownWidth] = useState<number>(0);
    const [sprintSwitchBusy, setSprintSwitchBusy] = useState(false);

    const {
        projects,
        selectedProject,
        createProject,
        selectProject,
        loading,
    } = useProjectData();
    const projectId = selectedProject?.id || null;

    const { data: sprints, selectedSprintId, selectedSprint, selectSprint, loading: sprintsLoading } = useSprints(projectId);
    const settings = useProjectEffectiveSettings(projectId);
    const sprintKeyPrefix = settings.data?.settings.git.sprintKeyPrefix || "SPR";

    const projectKb = useDropdownKeyboard(dropdownOpen, setDropdownOpen, dropdownRef, setProjectFilter);
    const sprintKb = useDropdownKeyboard(sprintDropdownOpen, setSprintDropdownOpen, sprintDropdownRef, setSprintFilter);

    const filteredProjects = useMemo(() => projects.filter(p => p.name.toLowerCase().includes(projectFilter.toLowerCase())), [projects, projectFilter]);
    const filteredSprints = useMemo(() => sprints.filter(s => s.name.toLowerCase().includes(sprintFilter.toLowerCase())), [sprints, sprintFilter]);

    useLayoutEffect(() => {
        if (sprintDropdownOpen && sprintDropdownRef.current) {
            setSprintDropdownWidth(sprintDropdownRef.current.offsetWidth);
        }
    }, [sprintDropdownOpen]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
            if (sprintDropdownRef.current && !sprintDropdownRef.current.contains(e.target as Node)) {
                setSprintDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleCreateProject = async (project: { name: string; type: 'local' | 'git'; path: string; cloneDir?: string }) => {
        await createProject({
            name: project.name,
            sourceType: project.type,
            sourceRef: project.path,
            cloneDir: project.cloneDir,
        });
    };

    return (
        <div className="flex items-center gap-1 sm:gap-3">
            {/* Project Selector */}
            <div className="relative hidden md:block" ref={dropdownRef} onKeyDown={projectKb.onContainerKeyDown}>
                <button
                    ref={projectKb.toggleRef}
                    onKeyDown={projectKb.onToggleKeyDown}
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    data-tour-id="project-selector"
                    aria-haspopup="listbox"
                    aria-expanded={dropdownOpen}
                    className="flex h-9 items-center gap-2.5 rounded-xl border border-black/[0.06] bg-black/[0.04] px-3.5 py-0 transition-all group hover:border-black/[0.08] focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.08]"
                >
                    <StatusDot status={selectedProject?.status || "idle"} />
                    <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono">
                        {projectSwitchBusy ? "Switching..." : (selectedProject?.name || (loading ? "Loading..." : "Select Project"))}
                    </span>
                    <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {/* Project Dropdown */}
                {dropdownOpen && (
                    <div role="listbox" aria-label="Project list" className="absolute right-0 top-full mt-2 w-56 bg-white/97 dark:bg-void-800/97 backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50">
                        <div className="px-3 pt-3 pb-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Projects</span>
                        </div>
                        <div className="px-2 pb-2">
                            <input
                                type="text"
                                placeholder="Filter projects..."
                                value={projectFilter}
                                onInput={(e) => setProjectFilter(e.currentTarget.value)}
                                className="w-full px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                            />
                        </div>
                        <div className="max-h-64 overflow-y-auto dropdown-scrollbar">
                        {filteredProjects.map((source) => (
                            <button
                                key={source.id}
                                role="option"
                                aria-selected={selectedProject?.id === source.id}
                                onClick={async () => {
                                    setProjectSwitchBusy(true);
                                    try {
                                        await selectProject(source.id);
                                        setDropdownOpen(false);
                                    } finally {
                                        setProjectSwitchBusy(false);
                                    }
                                }}
                                className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selectedProject?.id === source.id ? 'bg-signal-500/8' : ''}`}
                            >
                                <StatusDot status={source.status} />
                                <span className={`text-sm font-medium font-mono truncate transition-colors ${selectedProject?.id === source.id ? 'text-signal-600 dark:text-signal-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                    {source.name}
                                </span>
                                {selectedProject?.id === source.id && (
                                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-signal-500" />
                                )}
                            </button>
                        ))}
                        </div>
                        {!loading && projects.length === 0 && (
                            <div className="px-3 py-4 text-xs text-slate-400 font-medium">
                                No projects connected yet.
                            </div>
                        )}
                        <div className="p-2 border-t border-black/[0.04] dark:border-white/[0.04] mt-1 flex flex-col gap-1">
                            <button
                                onClick={() => { setDropdownOpen(false); setShowAddProject(true); }}
                                className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ember-600 dark:text-ember-400 hover:bg-ember-500/[0.06] rounded-xl transition-colors"
                            >
                                <FolderOpen aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
                                Add Project
                            </button>
                            <Link
                                to="/projects"
                                onClick={() => setDropdownOpen(false)}
                                className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
                            >
                                <span>Manage Projects</span>
                                <ArrowRight aria-hidden="true" className="w-3 h-3" strokeWidth={2} />
                            </Link>
                        </div>
                    </div>
                )}
            </div>

            {/* Sprint Selector */}
            {selectedProject && (
                <div className="relative hidden md:block" ref={sprintDropdownRef} onKeyDown={sprintKb.onContainerKeyDown}>
                    <button
                        ref={sprintKb.toggleRef}
                        onKeyDown={sprintKb.onToggleKeyDown}
                        aria-haspopup="listbox"
                        aria-expanded={sprintDropdownOpen}
                        onClick={(e) => {
                            if (sprints.length === 0) {
                                e.preventDefault();
                                return;
                            }
                            setSprintDropdownOpen(!sprintDropdownOpen);
                        }}
                        aria-disabled={sprints.length === 0}
                        className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 flex h-9 items-center gap-2.5 rounded-xl border border-transparent bg-black/[0.04] px-3.5 py-0 transition-all group dark:bg-white/[0.04] ${
                            sprints.length > 0
                                ? 'hover:border-black/[0.08] dark:hover:border-white/[0.08] cursor-pointer'
                                : 'opacity-50 cursor-not-allowed'
                        }`}
                    >
                        {selectedSprint && (
                            <StatusDot status={selectedSprint.status} />
                        )}
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono truncate max-w-[180px]">
                            {sprintSwitchBusy ? "Switching..." : (sprintsLoading ? "Loading..." : formatSprintDisplay(selectedSprint, sprintKeyPrefix))}
                        </span>
                        {sprints.length > 0 && (
                            <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${sprintDropdownOpen ? 'rotate-180' : ''}`} />
                        )}
                    </button>

                    {/* Sprint Dropdown */}
                    {sprintDropdownOpen && sprints.length > 0 && (
                        <div role="listbox" aria-label="Sprint list" className="absolute right-0 top-full mt-2 bg-white/97 dark:bg-void-800/97 backdrop-blur-md border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50" style={{ minWidth: Math.max(sprintDropdownWidth, 224) + 'px' }}>
                            <div className="px-3 pt-3 pb-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Sprint Scope</span>
                            </div>
                            <div className="px-2 pb-2">
                                <input
                                    type="text"
                                    placeholder="Filter sprints..."
                                    value={sprintFilter}
                                    onInput={(e) => setSprintFilter(e.currentTarget.value)}
                                    className="w-full px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                                />
                            </div>
                            <div className="max-h-64 overflow-y-auto dropdown-scrollbar">
                            <button
                                role="option"
                                aria-selected={selectedSprintId === null}
                                onClick={async () => {
                                    setSprintSwitchBusy(true);
                                    try {
                                        await selectSprint(null);
                                        setSprintDropdownOpen(false);
                                    } finally {
                                        setSprintSwitchBusy(false);
                                    }
                                }}
                                className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selectedSprintId === null ? 'bg-signal-500/8' : ''}`}
                            >
                                <span className={`text-sm font-medium font-mono truncate transition-colors ${selectedSprintId === null ? 'text-signal-600 dark:text-signal-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                    All Sprints
                                </span>
                                {selectedSprintId === null && (
                                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-signal-500" />
                                )}
                            </button>
                            {filteredSprints.map((sprint) => (
                                <button
                                    key={sprint.id}
                                    role="option"
                                    aria-selected={selectedSprintId === sprint.id}
                                    onClick={async () => {
                                        setSprintSwitchBusy(true);
                                        try {
                                            await selectSprint(sprint.id);
                                            setSprintDropdownOpen(false);
                                        } finally {
                                            setSprintSwitchBusy(false);
                                        }
                                    }}
                                    className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selectedSprintId === sprint.id ? 'bg-signal-500/8' : ''}`}
                                >
                                    <StatusDot status={sprint.status} />
                                    <span className={`text-sm font-medium font-mono truncate transition-colors ${selectedSprintId === sprint.id ? 'text-signal-600 dark:text-signal-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                        {formatSprintDisplay(sprint, sprintKeyPrefix)}
                                    </span>
                                    {selectedSprintId === sprint.id && (
                                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-signal-500" />
                                    )}
                                </button>
                            ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
            {showAddProject && (
                <AddProjectModal
                    onClose={() => setShowAddProject(false)}
                    onAdd={(project) => { void handleCreateProject(project); }}
                />
            )}
        </div>
    );
});
