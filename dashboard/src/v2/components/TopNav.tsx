import type { FunctionComponent, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bell, Command, Search, Moon, Sun, ChevronDown, Activity, FolderOpen, ArrowRight, Cpu, Zap, Compass } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { StatusDot } from "./ui/StatusDot.js";
import { AddProjectModal } from "./ui/AddProjectModal.js";
import { useProjectData } from "../context/project-data.js";
import { useExecutions } from "../../hooks/useExecutions.js";
import { useSprints } from "../../hooks/useSprints.js";
import { DockerStatusMenu } from "./DockerStatusMenu.js";
import { BrowserSessionsMenu } from "./browser/BrowserSessionsMenu.js";
import { dashboardSettingsToProjectSettings } from "../lib/settings-view-models.js";
import {
    getProjectWorkerOptions,
    type WorkerOption,
    type WorkerRoutingPreference,
} from "../lib/project-worker-options.js";
import { setProjectPreferredWorker } from "../lib/project-api.js";
import { saveProjectSettings } from "../lib/settings-api.js";
import { useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";

export function useDropdownKeyboard(
    isOpen: boolean,
    setIsOpen: (open: boolean) => void,
    containerRef: RefObject<HTMLElement>
) {
    const toggleRef = useRef<HTMLButtonElement>(null);

    const onToggleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen(!isOpen);
        }
    }, [isOpen, setIsOpen]);

    const onContainerKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen || !containerRef.current) return;

        if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
            toggleRef.current?.focus();
            return;
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();

            const focusableElements = Array.from(
                containerRef.current.querySelectorAll<HTMLElement>(
                    'button:not([disabled]), a[href]'
                )
            ).filter(el => el !== toggleRef.current);

            if (focusableElements.length === 0) return;

            const currentIndex = focusableElements.indexOf(document.activeElement as HTMLElement);

            let nextIndex = 0;
            if (e.key === "ArrowDown") {
                nextIndex = currentIndex < focusableElements.length - 1 ? currentIndex + 1 : 0;
            } else if (e.key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : focusableElements.length - 1;
            }

            focusableElements[nextIndex]?.focus();
        }
    }, [isOpen, setIsOpen, containerRef]);

    useEffect(() => {
        if (isOpen && containerRef.current) {
            // Give the DOM a moment to render the dropdown
            setTimeout(() => {
                if (!containerRef.current) return;
                const focusableElements = Array.from(
                    containerRef.current.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), a[href]'
                    )
                ).filter(el => el !== toggleRef.current);

                if (focusableElements.length > 0) {
                    focusableElements[0]?.focus();
                }
            }, 0);
        } else if (!isOpen && toggleRef.current && document.activeElement && containerRef.current?.contains(document.activeElement)) {
            toggleRef.current.focus();
        }
    }, [isOpen, containerRef]);

    return { toggleRef, onToggleKeyDown, onContainerKeyDown };
}

const LIVE_WORKER_STATUSES = new Set(["connected", "listening", "idle"]);

interface TopNavProps {
    isDark: boolean;
    toggleTheme: () => void;
}

export const TopNav: FunctionComponent<TopNavProps> = ({ isDark, toggleTheme }) => {
    const navRef = useRef<HTMLElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const workerDropdownRef = useRef<HTMLDivElement>(null);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [workerDropdownOpen, setWorkerDropdownOpen] = useState(false);
    const [showAddProject, setShowAddProject] = useState(false);
    const [workerSwitchBusy, setWorkerSwitchBusy] = useState(false);
    const [sprintDropdownOpen, setSprintDropdownOpen] = useState(false);
    const sprintDropdownRef = useRef<HTMLDivElement>(null);

    const {
        projects,
        selectedProject,
        createProject,
        selectProject,
        loading,
    } = useProjectData();

    const { data: execution, loading: executionLoading, refetch: refreshExecution } = useExecutions(selectedProject?.id || null);
    const { data: sprints, selectedSprintId, selectedSprint, selectSprint, loading: sprintsLoading } = useSprints(selectedProject?.id || null);

    const { data: effectiveSettings, refresh: refreshEffectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

    const workerRouting: WorkerRoutingPreference | null = effectiveSettings ? {
        executionMode: effectiveSettings.settings.workers.executionMode,
        virtualWorkerProvider: effectiveSettings.settings.workers.virtualWorkerProvider,
    } : null;

    const { options: workerOptions, selectedOption: selectedWorker } = getProjectWorkerOptions(execution, workerRouting, executionLoading);

    const projectKb = useDropdownKeyboard(dropdownOpen, setDropdownOpen, dropdownRef);
    const sprintKb = useDropdownKeyboard(sprintDropdownOpen, setSprintDropdownOpen, sprintDropdownRef);
    const workerKb = useDropdownKeyboard(workerDropdownOpen, setWorkerDropdownOpen, workerDropdownRef);

    useLayoutEffect(() => {
        if (navRef.current) {
            gsap.fromTo(navRef.current, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: "power3.out" });
        }
    }, []);

    // Close dropdowns on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
            if (workerDropdownRef.current && !workerDropdownRef.current.contains(e.target as Node)) {
                setWorkerDropdownOpen(false);
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

    const handleWorkerSelect = async (option: WorkerOption) => {
        if (!selectedProject || !option.isSelectable || workerSwitchBusy || !effectiveSettings) return;
        setWorkerDropdownOpen(false);
        setWorkerSwitchBusy(true);
        try {
            const nextSettings = dashboardSettingsToProjectSettings(effectiveSettings.settings);

            if (option.type === "virtual" && option.providerId) {
                const nextProvider = option.providerId;
                const providerChanged = nextSettings.workers.virtualWorkerProvider !== nextProvider;
                nextSettings.workers.executionMode = "VIRTUAL";
                nextSettings.workers.virtualWorkerProvider = nextProvider;
                if (providerChanged) {
                    nextSettings.workers.model = "default";
                }
                await saveProjectSettings(selectedProject.id, nextSettings);
            } else {
                nextSettings.workers.executionMode = "CONNECTED_MCP";
                await saveProjectSettings(selectedProject.id, nextSettings);
                await setProjectPreferredWorker(selectedProject.id, {
                    workerConnectionId: option.connectionId,
                    workerEndpointId: option.workerEndpointId,
                    workerEndpointKey: option.workerEndpointKey,
                });
            }
            await Promise.all([refreshExecution(), refreshEffectiveSettings()]);
        } catch (err) {
            console.error("Failed to update preferred worker:", err);
        } finally {
            setWorkerSwitchBusy(false);
        }
    };

    const workerStatusClass = (option: WorkerOption): string => {
        if (option.type === "virtual") {
            return "bg-signal-500";
        }
        if (option.status === "paused") {
            return "bg-amber-500";
        }
        return LIVE_WORKER_STATUSES.has(option.status) ? "bg-emerald-500" : "bg-slate-300";
    };

    return (
        <>
        <header
            ref={navRef}
            className="sticky top-0 z-50 flex items-center justify-between w-full h-[60px] px-8 md:px-12 bg-[#F9F8F4]/70 dark:bg-void-900/70 backdrop-blur-3xl border-b border-black/[0.05] dark:border-white/[0.04]"
        >
            <nav aria-label="Primary navigation" className="contents">
            <div className="flex items-center gap-10 flex-1">
                {/* Logo */}
                <div className="flex items-center gap-3 cursor-pointer group shrink-0">
                    <div className="relative w-8 h-8 flex items-center justify-center bg-void-900 dark:bg-white rounded-xl overflow-hidden shadow-[0_0_20px_rgba(0,224,160,0.25)]">
                        <div className="absolute inset-0 bg-signal-500 opacity-0 group-hover:opacity-20 transition-opacity duration-500" />
                        <Activity aria-hidden="true" className="w-4 h-4 text-signal-500 dark:text-void-900 relative z-10 group-hover:scale-110 transition-transform duration-500" strokeWidth={2.5} />
                    </div>
                    <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-0.5">
                        Sprint<span className="text-signal-500">OS</span>
                    </span>
                </div>

                {/* Search Bar */}
                <div className="relative group w-full max-w-xs">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <Search aria-hidden="true" className="w-3.5 h-3.5 text-slate-400 group-focus-within:text-signal-500 transition-colors" strokeWidth={2} />
                    </div>
                    <input
                        type="text"
                        aria-label="Search"
                        placeholder="Search projects, sprints, tasks..."
                        className="w-full h-9 pl-10 pr-12 bg-black/[0.04] dark:bg-white/[0.04] border border-transparent hover:border-black/[0.08] dark:hover:border-white/[0.08] focus:border-signal-500/40 dark:focus:border-signal-500/40 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:ring-2 focus:ring-signal-500/10 transition-all"
                    />
                    <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-mono font-medium text-slate-400 border border-black/10 dark:border-white/10 rounded-md">
                            <Command aria-hidden="true" className="w-2.5 h-2.5" /> K
                        </kbd>
                    </div>
                </div>
            </div>

            <div className="flex items-center gap-3">
                {/* Project Selector */}
                <div className="relative hidden md:block" ref={dropdownRef} onKeyDown={projectKb.onContainerKeyDown}>
                    <button
                        ref={projectKb.toggleRef}
                        onKeyDown={projectKb.onToggleKeyDown}
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        aria-haspopup="listbox"
                        aria-expanded={dropdownOpen}
                            aria-controls="project-dropdown"
                        className="flex items-center gap-2.5 px-3.5 py-2 bg-black/[0.04] dark:bg-white/[0.04] border border-transparent hover:border-black/[0.08] dark:hover:border-white/[0.08] rounded-xl transition-all group focus-visible:ring-2 focus-visible:ring-signal-500/50"
                    >
                        <StatusDot status={selectedProject?.status || "idle"} />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono">
                            {selectedProject?.name || (loading ? "Loading..." : "Select Project")}
                        </span>
                        <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Project Dropdown */}
                    {dropdownOpen && (
                        <div id="project-dropdown" role="listbox" aria-label="Project list" className="absolute right-0 top-full mt-2 w-56 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50">
                            <div className="px-3 pt-3 pb-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Projects</span>
                            </div>
                            {projects.map((source) => (
                                <button
                                    key={source.id}
                                    role="option"
                                    aria-selected={selectedProject?.id === source.id}
                                    onClick={() => {
                                        void selectProject(source.id);
                                        setDropdownOpen(false);
                                    }}
                                    className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-signal-500/5 transition-colors group ${selectedProject?.id === source.id ? 'bg-signal-500/8' : ''}`}
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
                                    className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
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
                            onClick={() => setSprintDropdownOpen(!sprintDropdownOpen)}
                            aria-haspopup="listbox"
                            aria-expanded={sprintDropdownOpen}
                            aria-controls="sprint-dropdown"
                            disabled={sprints.length === 0}
                            className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 flex items-center gap-2.5 px-3.5 py-2 bg-black/[0.04] dark:bg-white/[0.04] border border-transparent rounded-xl transition-all group ${
                                sprints.length > 0
                                    ? 'hover:border-black/[0.08] dark:hover:border-white/[0.08] cursor-pointer'
                                    : 'opacity-50 cursor-not-allowed'
                            }`}
                        >
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono">
                                {sprintsLoading ? "Loading..." : (selectedSprint ? selectedSprint.name : "All Sprints")}
                            </span>
                            {sprints.length > 0 && (
                                <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${sprintDropdownOpen ? 'rotate-180' : ''}`} />
                            )}
                        </button>

                        {/* Sprint Dropdown */}
                        {sprintDropdownOpen && sprints.length > 0 && (
                            <div id="sprint-dropdown" role="listbox" aria-label="Sprint list" className="absolute right-0 top-full mt-2 w-56 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50">
                                <div className="px-3 pt-3 pb-1.5">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Sprint Scope</span>
                                </div>
                                <button
                                    role="option"
                                    aria-selected={selectedSprintId === null}
                                    onClick={() => {
                                        void selectSprint(null);
                                        setSprintDropdownOpen(false);
                                    }}
                                    className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-signal-500/5 transition-colors group ${selectedSprintId === null ? 'bg-signal-500/8' : ''}`}
                                >
                                    <span className={`text-sm font-medium font-mono truncate transition-colors ${selectedSprintId === null ? 'text-signal-600 dark:text-signal-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                        All Sprints
                                    </span>
                                    {selectedSprintId === null && (
                                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-signal-500" />
                                    )}
                                </button>
                                {sprints.map((sprint) => (
                                    <button
                                        key={sprint.id}
                                        role="option"
                                        aria-selected={selectedSprintId === sprint.id}
                                        onClick={() => {
                                            void selectSprint(sprint.id);
                                            setSprintDropdownOpen(false);
                                        }}
                                        className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-signal-500/5 transition-colors group ${selectedSprintId === sprint.id ? 'bg-signal-500/8' : ''}`}
                                    >
                                        <StatusDot status={sprint.status as any} />
                                        <span className={`text-sm font-medium font-mono truncate transition-colors ${selectedSprintId === sprint.id ? 'text-signal-600 dark:text-signal-400 font-semibold' : 'text-slate-700 dark:text-slate-300'}`}>
                                            {sprint.name}
                                        </span>
                                        {selectedSprintId === sprint.id && (
                                            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-signal-500" />
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Worker Selector */}
                {selectedProject && (
                    <div className="relative hidden lg:block" ref={workerDropdownRef} onKeyDown={workerKb.onContainerKeyDown}>
                        <button
                            ref={workerKb.toggleRef}
                            onKeyDown={workerKb.onToggleKeyDown}
                            onClick={() => setWorkerDropdownOpen(!workerDropdownOpen)}
                            aria-haspopup="listbox"
                            aria-expanded={workerDropdownOpen}
                            aria-controls="worker-dropdown"
                            className="flex items-center gap-2.5 px-3.5 py-2 bg-black/[0.04] dark:bg-white/[0.04] border border-transparent hover:border-black/[0.08] dark:hover:border-white/[0.08] rounded-xl transition-all group focus-visible:ring-2 focus-visible:ring-signal-500/50"
                        >
                            <div className="flex items-center justify-center w-4 h-4 rounded-md bg-signal-500/10 text-signal-500">
                                <Cpu aria-hidden="true" className="w-3 h-3" strokeWidth={2.5} />
                            </div>
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono">
                                {selectedWorker?.label || (executionLoading ? "Loading..." : "Select Worker")}
                            </span>
                            <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${workerDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Worker Dropdown */}
                        {workerDropdownOpen && (
                            <div id="worker-dropdown" role="listbox" aria-label="Worker list" className="absolute right-0 top-full mt-2 w-64 bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.08] rounded-2xl shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)] overflow-hidden z-50">
                                <div className="px-3 pt-3 pb-1.5">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Available Workers</span>
                                </div>
                                <div className="max-h-64 overflow-y-auto">
                                    {workerOptions.map((option) => (
                                        <button
                                            key={option.id}
                                            role="option"
                                            aria-selected={selectedWorker?.id === option.id}
                                            onClick={() => handleWorkerSelect(option)}
                                            disabled={!option.isSelectable || workerSwitchBusy}
                                            className={`focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-3 px-3 py-3 text-left transition-colors group ${
                                                option.isPrimary ? 'bg-signal-500/8' : ''
                                            } ${
                                                option.isSelectable && !workerSwitchBusy
                                                    ? 'hover:bg-signal-500/5'
                                                    : 'cursor-not-allowed opacity-55'
                                            }`}
                                        >
                                            <div className="relative">
                                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${option.isPrimary ? 'bg-signal-500/20 text-signal-500' : 'bg-slate-100 dark:bg-white/5 text-slate-400'}`}>
                                                    <Cpu aria-hidden="true" className="w-4 h-4" />
                                                </div>
                                                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-void-800 ${workerStatusClass(option)}`} />
                                            </div>
                                            <div className="flex flex-col min-w-0">
                                                <span className={`text-sm font-bold truncate transition-colors ${option.isPrimary ? 'text-signal-600 dark:text-signal-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                                    {option.label}
                                                </span>
                                                <span className="text-[10px] font-medium text-slate-400 truncate uppercase tracking-wider">
                                                    {option.subLabel || (option.isSelectable ? "Available" : "Unavailable")}
                                                </span>
                                            </div>
                                            {option.isPrimary && (
                                                <Zap aria-hidden="true" className="ml-auto w-3 h-3 text-signal-500 fill-signal-500" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                                {!executionLoading && workerOptions.length === 0 && (
                                    <div className="px-4 py-6 text-center">
                                        <div className="w-10 h-10 rounded-full bg-slate-50 dark:bg-white/5 flex items-center justify-center mx-auto mb-2">
                                            <Cpu aria-hidden="true" className="w-5 h-5 text-slate-300" />
                                        </div>
                                        <p className="text-xs text-slate-400 font-medium">
                                            No workers available.
                                        </p>
                                    </div>
                                )}
                                <div className="p-2 border-t border-black/[0.04] dark:border-white/[0.04] mt-1">
                                    <Link
                                        to="/agents"
                                        onClick={() => setWorkerDropdownOpen(false)}
                                        className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
                                    >
                                        <span>Worker Management</span>
                                        <ArrowRight aria-hidden="true" className="w-3 h-3" strokeWidth={2} />
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <div className="w-px h-5 bg-black/10 dark:bg-white/10 hidden md:block" />

                {/* Docker Status */}
                <DockerStatusMenu />

                <BrowserSessionsMenu />

                {/* Notifications */}
                <button
                    aria-label="Notifications"
                    className="relative w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors group focus-visible:ring-2 focus-visible:ring-signal-500/50"
                >
                    <Bell aria-hidden="true" className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" strokeWidth={1.5} />
                    <span className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.8)] ring-1 ring-[#F9F8F4] dark:ring-void-900" />
                </button>

                {/* Theme Toggle */}
                <button
                    onClick={toggleTheme}
                    aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                    className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/50"
                >
                    {isDark
                        ? <Sun aria-hidden="true" className="w-4 h-4 text-slate-400 hover:text-white transition-colors" strokeWidth={1.5} />
                        : <Moon aria-hidden="true" className="w-4 h-4 text-slate-500 hover:text-slate-900 transition-colors" strokeWidth={1.5} />
                    }
                </button>

                <div className="w-px h-5 bg-black/10 dark:bg-white/10" />

                {/* Avatar */}
                <button aria-label="User menu" className="flex items-center gap-2.5 cursor-pointer group focus-visible:ring-2 focus-visible:ring-signal-500/50 rounded-full">
                    <div className="w-8 h-8 rounded-full bg-signal-500/20 dark:bg-signal-500/15 p-[1.5px] shadow-[0_0_12px_rgba(0,224,160,0.15)] group-hover:shadow-[0_0_16px_rgba(0,224,160,0.25)] transition-shadow">
                        <div className="w-full h-full rounded-full bg-white dark:bg-void-800 flex items-center justify-center overflow-hidden">
                            <img
                                src="https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=transparent"
                                alt="User avatar"
                                className="w-full h-full object-cover opacity-90 group-hover:scale-110 transition-transform duration-500"
                            />
                        </div>
                    </div>
                </button>
            </div>
            </nav>
        </header>

            {showAddProject && (
                <AddProjectModal
                    onClose={() => setShowAddProject(false)}
                    onAdd={(project) => { void handleCreateProject(project); }}
                />
            )}
        </>
    );
};
