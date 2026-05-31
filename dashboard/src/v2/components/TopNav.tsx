import type { FunctionComponent, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bell, Moon, Sun, ChevronDown, FolderOpen, ArrowRight, Menu } from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { StatusDot } from "./ui/StatusDot.js";

import { BrandSection } from "./top-nav/BrandSection.js";
import { GlobalSearch } from "./navigation/GlobalSearch.js";
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

import { ProjectSwitcher } from "./navigation/ProjectSwitcher.js";
import { NotificationIndicator } from "./navigation/NotificationIndicator.js";
import { UserMenu } from "./navigation/UserMenu.js";

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
            data-glass
            className="sticky top-0 z-50 flex items-center justify-between w-full h-[60px] px-8 md:px-12 bg-[#F9F8F4]/90 dark:bg-void-900/90 backdrop-blur-xl border-b border-black/[0.05] dark:border-white/[0.04]"
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
                <ProjectSwitcher />

                <TelemetryStats projectId={projectId} sprints={sprints} />

                <div className="w-px h-5 bg-black/10 dark:bg-white/10 hidden md:block" />

                <DockerStatusMenu />
                <BrowserSessionsMenu enabled={browserVisible} />
                <NotificationIndicator />
                <UserMenu isDark={isDark} toggleTheme={toggleTheme} />
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
