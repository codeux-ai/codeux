import type { FunctionComponent, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bell, Moon, Sun, ChevronDown, FolderOpen, ArrowRight, Menu } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { StatusDot } from "./ui/StatusDot.js";

import { BrandSection } from "./top-nav/BrandSection.js";
import { GlobalSearch } from "./top-nav/GlobalSearch.js";
import { TelemetryStats } from "./top-nav/TelemetryStats.js";

import { AddProjectModal } from "./ui/AddProjectModal.js";
import { useProjectData } from "../context/project-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { formatSprintDisplay } from "../lib/format-sprint.js";
import { useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";
import { DockerStatusMenu } from "./DockerStatusMenu.js";
import { BrowserSessionsMenu } from "./browser/BrowserSessionsMenu.js";
import { NotificationPanel } from "./NotificationPanel.js";
import { Tooltip } from "./ui/Tooltip.js";
import { useNotifications } from "../hooks/use-notifications.js";

export function useDropdownKeyboard(
    isOpen: boolean,
    setIsOpen: (open: boolean) => void,
    containerRef: RefObject<HTMLElement>,
    onFilterChange?: (val: string) => void
) {
    const toggleRef = useRef<HTMLButtonElement>(null);

    const onToggleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
            e.preventDefault();
            setIsOpen(!isOpen);
        }
    }, [isOpen, setIsOpen]);

    const onContainerKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen || !containerRef.current) return;

        if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
            setTimeout(() => toggleRef.current?.focus(), 0);
            return;
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();

            const focusableElements = Array.from(
                containerRef.current.querySelectorAll<HTMLElement>(
                    'button, a[href], input'
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
                        'button, a[href], input'
                    )
                ).filter(el => el !== toggleRef.current);

                if (focusableElements.length > 0) {
                    focusableElements[0]?.focus();
                }
            }, 0);
        } else if (!isOpen) {
            onFilterChange?.("");
            if (toggleRef.current && document.activeElement && containerRef.current?.contains(document.activeElement)) {
                toggleRef.current.focus();
            }
        }
    }, [isOpen, containerRef, onFilterChange]);

    return { toggleRef, onToggleKeyDown, onContainerKeyDown };
}

interface TopNavProps {
    isDark: boolean;
    toggleTheme: () => void;
    onMenuToggle?: () => void;
    isMobile?: boolean;
    hideLogo?: boolean;
}

export const TopNav: FunctionComponent<TopNavProps> = ({ isDark, toggleTheme, onMenuToggle, isMobile, hideLogo }) => {
    const navRef = useRef<HTMLElement>(null);

    const dropdownRef = useRef<HTMLDivElement>(null);

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showAddProject, setShowAddProject] = useState(false);
    const notifications = useNotifications();

    const [projectSwitchBusy, setProjectSwitchBusy] = useState(false);
    const [sprintSwitchBusy, setSprintSwitchBusy] = useState(false);
    const [projectFilter, setProjectFilter] = useState('');

    // Notification Panel State
    const [notificationInteractionState, setNotificationInteractionState] = useState<'closed' | 'hover' | 'open'>('closed');
    const isNotificationMenuVisible = notificationInteractionState !== 'closed';
    const notificationHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notificationContainerRef = useRef<HTMLDivElement>(null);

    const handleNotificationMouseEnter = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        if (notificationInteractionState === 'closed') {
            setNotificationInteractionState('hover');
        }
    };

    const handleNotificationMouseLeave = () => {
        if (notificationInteractionState === 'hover') {
            notificationHoverTimeout.current = setTimeout(() => {
                setNotificationInteractionState((prev) => (prev === 'hover' ? 'closed' : prev));
            }, 150);
        }
    };

    const handleNotificationFocus = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState('open');
    };

    const handleNotificationBlur = (e: FocusEvent) => {
        if (!notificationContainerRef.current?.contains(e.relatedTarget as Node)) {
            setNotificationInteractionState('closed');
        }
    };

    const toggleNotificationMenu = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState((prev) => (prev === 'closed' || prev === 'hover' ? 'open' : 'closed'));
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isNotificationMenuVisible) {
                setNotificationInteractionState('closed');
                const triggerBtn = notificationContainerRef.current?.querySelector('button');
                setTimeout(() => triggerBtn?.focus(), 0);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isNotificationMenuVisible]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isNotificationMenuVisible && notificationContainerRef.current && !notificationContainerRef.current.contains(e.target as Node)) {
                setNotificationInteractionState('closed');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isNotificationMenuVisible]);
    const [sprintFilter, setSprintFilter] = useState('');
    const [sprintDropdownOpen, setSprintDropdownOpen] = useState(false);
    const sprintDropdownRef = useRef<HTMLDivElement>(null);
    const [sprintDropdownWidth, setSprintDropdownWidth] = useState<number>(0);

    const {
        projects,
        selectedProject,
        createProject,
        selectProject,
        loading,
    } = useProjectData();
    const projectId = selectedProject?.id || null;
    const settings = useProjectEffectiveSettings(projectId);
    const sprintKeyPrefix = settings.data?.settings.git.sprintKeyPrefix || "SPR";

    const { data: sprints, selectedSprintId, selectedSprint, selectSprint, loading: sprintsLoading } = useSprints(selectedProject?.id || null);

    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);
    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );

    const projectKb = useDropdownKeyboard(dropdownOpen, setDropdownOpen, dropdownRef, setProjectFilter);
    const sprintKb = useDropdownKeyboard(sprintDropdownOpen, setSprintDropdownOpen, sprintDropdownRef, setSprintFilter);

    const filteredProjects = useMemo(() => projects.filter(p => p.name.toLowerCase().includes(projectFilter.toLowerCase())), [projects, projectFilter]);
    const filteredSprints = useMemo(() => sprints.filter(s => s.name.toLowerCase().includes(sprintFilter.toLowerCase())), [sprints, sprintFilter]);

    useLayoutEffect(() => {
        if (sprintDropdownOpen && sprintDropdownRef.current) {
            setSprintDropdownWidth(sprintDropdownRef.current.offsetWidth);
        }
    }, [sprintDropdownOpen]);

    useLayoutEffect(() => {
        if (navRef.current) {
            gsap.fromTo(navRef.current, { y: -20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, ease: "power3.out" });
        }
    }, []);

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
        <>
        <header
            ref={navRef}
            className="sticky top-0 z-50 flex items-center justify-between w-full h-[60px] px-8 md:px-12 bg-[#F9F8F4]/82 dark:bg-void-900/82 backdrop-blur-xl border-b border-black/[0.05] dark:border-white/[0.04]"
        >
            <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-white dark:focus:bg-void-800 focus:text-signal-600 dark:focus:text-signal-400 focus:rounded-lg focus:shadow-lg focus:text-sm focus:font-semibold">
                Skip to main content
            </a>
            <nav aria-label="Primary navigation" className="contents">
            <div className="flex items-center gap-4 md:gap-10 flex-1">
                <BrandSection isMobile={isMobile} onMenuToggle={onMenuToggle} hideLogo={hideLogo} />

                <GlobalSearch projectId={projectId} selectedProject={selectedProject} sprints={sprints} />
            </div>

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


                <TelemetryStats projectId={projectId} sprints={sprints} />

                <div className="w-px h-5 bg-black/10 dark:bg-white/10 hidden md:block" />

                {/* Docker Status */}
                <DockerStatusMenu />

                <BrowserSessionsMenu enabled={browserVisible} />

                {/* Notifications */}
                <div
                    className="relative hidden md:inline-block"
                    ref={notificationContainerRef}
                    onMouseEnter={handleNotificationMouseEnter}
                    onMouseLeave={handleNotificationMouseLeave}
                >
                    <Tooltip content="Notifications">
                        <button
                            type="button"
                            onClick={toggleNotificationMenu}
                            onFocus={handleNotificationFocus}
                            onBlur={handleNotificationBlur}
                            aria-haspopup="menu"
                            aria-expanded={isNotificationMenuVisible}
                            aria-label="Notifications"
                            className="relative w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors group focus-visible:ring-2 focus-visible:ring-signal-500/30"
                        >
                            <Bell aria-hidden="true" className="w-4 h-4 text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white transition-colors" strokeWidth={1.5} />
                            {notifications.unreadCount > 0 && (
                                <span className="absolute top-2.5 right-2.5 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-status-red px-1 text-[9px] font-black leading-none text-white shadow-[0_0_10px_rgba(211,47,47,0.35)] ring-1 ring-[#F9F8F4] dark:ring-void-900">
                                    {notifications.unreadCount > 9 ? "9+" : notifications.unreadCount}
                                </span>
                            )}
                        </button>
                    </Tooltip>
                    {isNotificationMenuVisible && (
                        <NotificationPanel
                            notifications={notifications.notifications}
                            unreadCount={notifications.unreadCount}
                            onMarkAllRead={notifications.markAllRead}
                            onMarkRead={notifications.markRead}
                            onDismiss={notifications.dismiss}
                            onRefresh={() => void notifications.refresh()}
                        />
                    )}
                </div>

                {/* Theme Toggle */}
                <Tooltip content={isDark ? "Switch to light mode" : "Switch to dark mode"}>
                    <button
                        onClick={toggleTheme}
                        aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
                        className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:ring-2 focus-visible:ring-signal-500/30"
                    >
                        {isDark
                            ? <Sun aria-hidden="true" className="w-4 h-4 text-slate-400 hover:text-white transition-colors" strokeWidth={1.5} />
                            : <Moon aria-hidden="true" className="w-4 h-4 text-slate-500 hover:text-slate-900 transition-colors" strokeWidth={1.5} />
                        }
                    </button>
                </Tooltip>
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
