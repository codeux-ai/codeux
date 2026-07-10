import type { FunctionComponent, RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Bell, CalendarClock, Moon, Sun, ChevronDown, FolderOpen, ArrowRight, Code2, Palette, Plus, Target } from "lucide-preact";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { StatusDot } from "./ui/StatusDot.js";
import type { DesignGuidanceSettings } from "../../types.js";

import { BrandSection } from "./top-nav/BrandSection.js";
import { GlobalSearch } from "./top-nav/GlobalSearch.js";
import { TelemetryStats } from "./top-nav/TelemetryStats.js";

import { AddProjectModal, type AddProjectModalSubmission } from "./ui/AddProjectModal.js";
import { AddSprintModal, type AddSprintModalSubmission } from "./ui/AddSprintModal.js";
import { buildProjectCreationSettingsOverride } from "../../lib/settings-updaters.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../lib/settings.js";
import { useProjectData } from "../context/project-data.js";
import { useSprints } from "../../hooks/useSprints.js";
import { formatSprintDisplay } from "../lib/format-sprint.js";
import { clearProjectEffectiveSettingsCache, useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";
import { saveProjectDesignGuidanceSettings } from "../lib/settings-api.js";
import { DESIGN_GUIDANCE_NONE_ID } from "../../../../src/domain/settings/design-guidance-catalog.js";
import {
    getDesignGuidanceActiveLabel,
    getDesignGuidanceSelectedId,
    getVisibleDesignGuidanceEntries,
    type DesignGuidanceEntryKind,
} from "../lib/settings/design-guidance.js";
import { DockerStatusMenu } from "./DockerStatusMenu.js";
import { BrowserSessionsMenu } from "./browser/BrowserSessionsMenu.js";
import { NotificationPanel } from "./NotificationPanel.js";
import { Tooltip } from "./ui/Tooltip.js";
import { useNotifications } from "../hooks/use-notifications.js";
import { useThemeSetting } from "../hooks/useThemeSetting.js";
import { useIsDark } from "../hooks/use-is-dark.js";
import type { AgentSchedulerSummaryEntry } from "../lib/scheduler-api.js";

export function useDropdownKeyboard(
    isOpen: boolean,
    setIsOpen: (open: boolean) => void,
    containerRef: RefObject<HTMLElement>,
    onFilterChange?: (val: string) => void
) {
    const toggleRef = useRef<HTMLButtonElement>(null);
    const [activeDescendantId, setActiveDescendantId] = useState<string | undefined>(undefined);

    const getOptions = useCallback((): HTMLElement[] => {
        if (!containerRef.current) return [];
        return Array.from(containerRef.current.querySelectorAll<HTMLElement>('[role="option"]'))
            .filter((el) => !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true");
    }, [containerRef]);

    const focusOption = useCallback((index: number) => {
        const options = getOptions();
        const nextOption = options[index];
        if (!nextOption) return;
        nextOption.focus();
        if (nextOption.id) {
            setActiveDescendantId(nextOption.id);
        }
    }, [getOptions]);

    const focusInitialOption = useCallback((placement: "first" | "last" | "selected" = "selected") => {
        const options = getOptions();
        if (options.length === 0) {
            setActiveDescendantId(undefined);
            const filterInput = containerRef.current?.querySelector<HTMLInputElement>('input:not([disabled])');
            filterInput?.focus();
            return;
        }
        const selectedIndex = options.findIndex((el) => el.getAttribute("aria-selected") === "true");
        const index = placement === "first"
            ? 0
            : placement === "last"
                ? options.length - 1
                : selectedIndex >= 0 ? selectedIndex : 0;
        focusOption(index);
    }, [containerRef, focusOption, getOptions]);

    const onToggleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
            e.preventDefault();
            if (!isOpen) {
                setIsOpen(true);
                const placement = e.key === "ArrowUp" || e.key === "End" ? "last" : "selected";
                setTimeout(() => focusInitialOption(placement), 0);
                return;
            }
            if (e.key === "Enter" || e.key === " ") {
                setIsOpen(false);
                setTimeout(() => toggleRef.current?.focus(), 0);
            }
        }
    }, [focusInitialOption, isOpen, setIsOpen]);

    const onContainerKeyDown = useCallback((e: KeyboardEvent) => {
        if (!isOpen || !containerRef.current) return;

        if (e.key === "Escape") {
            e.preventDefault();
            setIsOpen(false);
            setTimeout(() => toggleRef.current?.focus(), 0);
            return;
        }

        if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
            e.preventDefault();

            const options = getOptions();
            if (options.length === 0) return;
            const currentIndex = options.indexOf(document.activeElement as HTMLElement);

            let nextIndex = 0;
            if (e.key === "ArrowDown") {
                nextIndex = currentIndex >= 0 && currentIndex < options.length - 1 ? currentIndex + 1 : 0;
            } else if (e.key === "ArrowUp") {
                nextIndex = currentIndex > 0 ? currentIndex - 1 : options.length - 1;
            } else if (e.key === "Home") {
                nextIndex = 0;
            } else if (e.key === "End") {
                nextIndex = options.length - 1;
            }

            focusOption(nextIndex);
            return;
        }

        if ((e.key === "Enter" || e.key === " ") && (document.activeElement as HTMLElement | null)?.getAttribute("role") === "option") {
            e.preventDefault();
            (document.activeElement as HTMLElement).click();
        }
    }, [containerRef, focusOption, getOptions, isOpen, setIsOpen]);

    useEffect(() => {
        if (!isOpen || !containerRef.current) return;
        const handleFocusIn = (e: FocusEvent) => {
            const target = e.target as HTMLElement;
            if (target.id && target.role === 'option') {
                setActiveDescendantId(target.id);
            } else if (target.tagName === 'INPUT') {
                // If focus goes back to input, we might want to clear active descendant if we are using activedescendant on the input natively,
                // but actually if we arrow down we might want to keep it? Let's just track the focused ID.
                setActiveDescendantId(target.id);
            }
        };
        const container = containerRef.current;
        container.addEventListener('focusin', handleFocusIn);
        return () => container.removeEventListener('focusin', handleFocusIn);
    }, [isOpen, containerRef]);

    useEffect(() => {
        if (isOpen && containerRef.current) {
            setTimeout(() => focusInitialOption("selected"), 0);
        } else if (!isOpen) {
            onFilterChange?.("");
            setActiveDescendantId(undefined);
            if (toggleRef.current && document.activeElement && containerRef.current?.contains(document.activeElement)) {
                toggleRef.current.focus();
            }
        }
    }, [focusInitialOption, isOpen, containerRef, onFilterChange]);

    return { toggleRef, onToggleKeyDown, onContainerKeyDown, activeDescendantId };
}

const getRenderedOptionActiveDescendantId = (
    optionIds: string[],
    selectedOptionId: string,
    activeDescendantId?: string,
): string | undefined => {
    if (optionIds.length === 0) {
        return undefined;
    }

    if (activeDescendantId && optionIds.includes(activeDescendantId)) {
        return activeDescendantId;
    }

    if (optionIds.includes(selectedOptionId)) {
        return selectedOptionId;
    }

    return optionIds[0];
};

interface TopNavProps {
    onMenuToggle?: () => void;
    isMobile?: boolean;
    hideLogo?: boolean;
    isMobileMenuOpen?: boolean;
}

const ScheduledAgentIndicator: FunctionComponent<{ entries: AgentSchedulerSummaryEntry[] }> = ({ entries }) => {
    const [detailsVisible, setDetailsVisible] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const detailsId = "scheduled-agent-details";

    if (entries.length === 0) {
        return null;
    }

    const countLabel = `${entries.length} active scheduled agent ${entries.length === 1 ? "entry" : "entries"}`;

    return (
        <div
            ref={containerRef}
            className="relative inline-block"
            onMouseEnter={() => setDetailsVisible(true)}
            onMouseLeave={() => setDetailsVisible(false)}
            onFocus={() => setDetailsVisible(true)}
            onBlur={(event) => {
                if (!containerRef.current?.contains(event.relatedTarget as Node)) {
                    setDetailsVisible(false);
                }
            }}
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    setDetailsVisible(false);
                    (event.currentTarget.querySelector("button") as HTMLButtonElement | null)?.focus({ preventScroll: true });
                }
            }}
        >
            <button
                type="button"
                aria-label={`Scheduled agent work: ${countLabel}`}
                aria-describedby={detailsVisible ? detailsId : undefined}
                className="relative flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-signal-500/20 bg-signal-500/10 px-2.5 text-signal-700 transition-colors hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:text-signal-300 dark:hover:bg-signal-500/20"
            >
                <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.1} aria-hidden="true" />
                <span className="min-w-4 text-center text-[11px] font-black tabular-nums leading-none">
                    {entries.length > 9 ? "9+" : entries.length}
                </span>
            </button>
            {detailsVisible ? (
                <div
                    id={detailsId}
                    role="tooltip"
                    className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/[0.08] bg-white/95 p-3 text-left shadow-2xl backdrop-blur-2xl dark:border-white/[0.08] dark:bg-void-800/95"
                >
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        Scheduled agent work
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        {countLabel}
                    </div>
                    <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                        {entries.map((entry) => (
                            <li key={entry.id} className="rounded-xl border border-black/[0.05] bg-black/[0.025] p-2.5 dark:border-white/[0.06] dark:bg-white/[0.04]">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">
                                            {entry.label}
                                        </div>
                                        <div className="mt-1 break-words text-xs font-bold text-slate-800 dark:text-slate-100">
                                            {entry.title}
                                        </div>
                                    </div>
                                    <span className="shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-slate-500 dark:bg-white/[0.06] dark:text-slate-400">
                                        {entry.statusLabel}
                                    </span>
                                </div>
                                <div className="mt-1.5 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                    {entry.targetSummary} · {entry.timingSummary}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    );
};

export const TopNav: FunctionComponent<TopNavProps> = ({ onMenuToggle, isMobile, hideLogo, isMobileMenuOpen }) => {
    const navRef = useRef<HTMLElement>(null);
    const navigate = useNavigate();

    const dropdownRef = useRef<HTMLDivElement>(null);

    const [dropdownOpen, setDropdownOpen] = useState(false);
    const [showAddProject, setShowAddProject] = useState(false);
    const isDark = useIsDark();
    const { setTheme } = useThemeSetting();

    const [projectSwitchBusy, setProjectSwitchBusy] = useState(false);
    const [sprintSwitchBusy, setSprintSwitchBusy] = useState(false);
    const [projectFilter, setProjectFilter] = useState('');
    const [navAnnouncement, setNavAnnouncement] = useState('');
    const routeMatches = useRouterState({ select: (state) => state.matches });
    const currentPath = routeMatches.length > 0 ? routeMatches[routeMatches.length - 1]?.pathname || "/" : "/";
    const previousPathRef = useRef(currentPath);
    const replaceWorkspaceScope = useCallback(async (nextProjectId: string, nextSprintId: string | null): Promise<void> => {
        if (currentPath !== "/tasks" && currentPath !== "/live") {
            return;
        }
        await navigate({
            to: currentPath,
            search: {
                projectId: nextProjectId,
                ...(nextSprintId ? { sprintId: nextSprintId } : {}),
            } as any,
            replace: true,
        });
    }, [currentPath, navigate]);

    // Notification Panel State
    const [notificationInteractionState, setNotificationInteractionState] = useState<'closed' | 'hover' | 'open'>('closed');
    const isNotificationMenuVisible = notificationInteractionState !== 'closed';
    const notificationHoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const notificationContainerRef = useRef<HTMLDivElement>(null);
    const notificationTriggerRef = useRef<HTMLButtonElement>(null);
    const suppressNotificationFocusOpenRef = useRef(false);

    const restoreNotificationFocus = useCallback(() => {
        const trigger = notificationTriggerRef.current;
        if (trigger && !trigger.disabled && trigger.isConnected) {
            suppressNotificationFocusOpenRef.current = true;
            trigger.focus({ preventScroll: true });
            return;
        }
        const fallback = document.querySelector<HTMLElement>('[data-overlay-focus-fallback], [data-focus-fallback], main, [role="main"], #root') || document.body;
        fallback.focus?.({ preventScroll: true });
    }, []);

    const closeNotificationMenu = useCallback((restoreFocus = true) => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState('closed');
        if (restoreFocus) {
            queueMicrotask(restoreNotificationFocus);
        }
    }, [restoreNotificationFocus]);

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
        if (suppressNotificationFocusOpenRef.current) {
            suppressNotificationFocusOpenRef.current = false;
            return;
        }
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState('open');
    };

    const handleNotificationBlur = (e: FocusEvent) => {
        if (!notificationContainerRef.current?.contains(e.relatedTarget as Node)) {
            closeNotificationMenu();
        }
    };

    const toggleNotificationMenu = () => {
        if (notificationHoverTimeout.current) clearTimeout(notificationHoverTimeout.current);
        setNotificationInteractionState((prev) => (prev === 'closed' || prev === 'hover' ? 'open' : 'closed'));
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isNotificationMenuVisible) {
                e.preventDefault();
                closeNotificationMenu();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [closeNotificationMenu, isNotificationMenuVisible]);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (isNotificationMenuVisible && notificationContainerRef.current && !notificationContainerRef.current.contains(e.target as Node)) {
                closeNotificationMenu();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [closeNotificationMenu, isNotificationMenuVisible]);
    const [sprintFilter, setSprintFilter] = useState('');
    const [sprintDropdownOpen, setSprintDropdownOpen] = useState(false);
    const sprintDropdownRef = useRef<HTMLDivElement>(null);
    const [sprintDropdownWidth, setSprintDropdownWidth] = useState<number>(0);
    const [showAddSprint, setShowAddSprint] = useState(false);
    const [techstackDropdownOpen, setTechstackDropdownOpen] = useState(false);
    const [styleguideDropdownOpen, setStyleguideDropdownOpen] = useState(false);
    const [guidanceSwitchBusy, setGuidanceSwitchBusy] = useState<DesignGuidanceEntryKind | null>(null);
    const techstackDropdownRef = useRef<HTMLDivElement>(null);
    const styleguideDropdownRef = useRef<HTMLDivElement>(null);

    const {
        projects,
        selectedProject,
        createProject,
        selectProject,
        loading,
    } = useProjectData();
    const projectId = selectedProject?.id || null;
    const { data: effectiveSettings, loading: effectiveSettingsLoading, refresh: refreshEffectiveSettings } = useProjectEffectiveSettings(projectId);
    const notifications = useNotifications(projectId);
    const sprintKeyPrefix = effectiveSettings?.settings?.git?.sprintKeyPrefix || "SPR";

    const {
        data: sprints,
        selectedSprintId,
        selectedSprint,
        selectSprint,
        createSprint,
        loading: sprintsLoading,
        refetch: refetchSprints,
    } = useSprints(selectedProject?.id || null);
    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );

    const projectKb = useDropdownKeyboard(dropdownOpen, setDropdownOpen, dropdownRef, setProjectFilter);
    const sprintKb = useDropdownKeyboard(sprintDropdownOpen, setSprintDropdownOpen, sprintDropdownRef, setSprintFilter);
    const techstackKb = useDropdownKeyboard(techstackDropdownOpen, setTechstackDropdownOpen, techstackDropdownRef);
    const styleguideKb = useDropdownKeyboard(styleguideDropdownOpen, setStyleguideDropdownOpen, styleguideDropdownRef);

    const filteredProjects = useMemo(() => projects.filter(p => p.name.toLowerCase().includes(projectFilter.toLowerCase())), [projects, projectFilter]);
    const filteredSprints = useMemo(() => sprints.filter(s => s.name.toLowerCase().includes(sprintFilter.toLowerCase())), [sprints, sprintFilter]);
    const designGuidance = effectiveSettings?.settings.designGuidance ?? DEFAULT_DASHBOARD_SETTINGS.designGuidance;
    const techstackOptions = useMemo(
        () => getVisibleDesignGuidanceEntries(designGuidance, "techStack"),
        [designGuidance],
    );
    const styleguideOptions = useMemo(
        () => getVisibleDesignGuidanceEntries(designGuidance, "styleguide"),
        [designGuidance],
    );
    const techstackSelectedId = getDesignGuidanceSelectedId(designGuidance, "techStack");
    const styleguideSelectedId = getDesignGuidanceSelectedId(designGuidance, "styleguide");
    const techstackOptionIds = useMemo(
        () => techstackOptions.map((option) => `techstack-option-${option.id}`),
        [techstackOptions],
    );
    const styleguideOptionIds = useMemo(
        () => styleguideOptions.map((option) => `styleguide-option-${option.id}`),
        [styleguideOptions],
    );
    const techstackActiveDescendantId = getRenderedOptionActiveDescendantId(
        techstackOptionIds,
        `techstack-option-${techstackSelectedId}`,
        techstackKb.activeDescendantId,
    );
    const styleguideActiveDescendantId = getRenderedOptionActiveDescendantId(
        styleguideOptionIds,
        `styleguide-option-${styleguideSelectedId}`,
        styleguideKb.activeDescendantId,
    );
    const techstackActiveLabel = getDesignGuidanceActiveLabel(designGuidance, "techStack");
    const styleguideActiveLabel = getDesignGuidanceActiveLabel(designGuidance, "styleguide");
    const guidanceSelectorLoading = !!selectedProject && effectiveSettingsLoading;
    const techstackSelectorDisabled = !selectedProject || guidanceSelectorLoading || guidanceSwitchBusy === "techStack";
    const styleguideSelectorDisabled = !selectedProject || guidanceSelectorLoading || guidanceSwitchBusy === "styleguide";
    const guidanceHelper = !selectedProject
        ? "Select a project first"
        : guidanceSelectorLoading
            ? "Loading settings"
            : "";
    const techstackHelper = guidanceHelper || (techstackSelectedId === DESIGN_GUIDANCE_NONE_ID
                ? "None"
                : "Assigned");
    const styleguideHelper = guidanceHelper || (styleguideSelectedId === DESIGN_GUIDANCE_NONE_ID
                ? "None"
                : "Assigned");
    const techstackTriggerLabel = !selectedProject
        ? techstackHelper
        : guidanceSwitchBusy === "techStack"
            ? "Saving..."
            : guidanceSelectorLoading
                ? "Loading..."
                : techstackActiveLabel;
    const styleguideTriggerLabel = !selectedProject
        ? styleguideHelper
        : guidanceSwitchBusy === "styleguide"
            ? "Saving..."
            : guidanceSelectorLoading
                ? "Loading..."
                : styleguideActiveLabel;

    useEffect(() => {
        if (previousPathRef.current !== currentPath) {
            previousPathRef.current = currentPath;
            setNavAnnouncement(`Route changed to ${currentPath === "/" ? "Overview" : currentPath.slice(1).replace(/-/g, " ")}`);
        }
    }, [currentPath]);

    useEffect(() => {
        if (loading) {
            setNavAnnouncement("Loading projects");
        } else if (projects.length === 0) {
            setNavAnnouncement("No projects connected yet");
        }
    }, [loading, projects.length]);

    useEffect(() => {
        if (!selectedProject) return;
        if (sprintsLoading) {
            setNavAnnouncement(`Loading sprints for ${selectedProject.name}`);
        } else if (sprints.length === 0) {
            setNavAnnouncement(`No sprints available for ${selectedProject.name}`);
        }
    }, [selectedProject, sprints.length, sprintsLoading]);

    useEffect(() => {
        if (dropdownOpen && !loading && filteredProjects.length === 0) {
            setNavAnnouncement(projectFilter ? `No projects match ${projectFilter}` : "No projects connected yet");
        }
    }, [dropdownOpen, filteredProjects.length, loading, projectFilter]);

    useEffect(() => {
        if (sprintDropdownOpen && !sprintsLoading && filteredSprints.length === 0) {
            setNavAnnouncement(sprintFilter ? `No sprints match ${sprintFilter}` : "No sprints available");
        }
    }, [filteredSprints.length, sprintDropdownOpen, sprintFilter, sprintsLoading]);

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
            if (techstackDropdownRef.current && !techstackDropdownRef.current.contains(e.target as Node)) {
                setTechstackDropdownOpen(false);
            }
            if (styleguideDropdownRef.current && !styleguideDropdownRef.current.contains(e.target as Node)) {
                setStyleguideDropdownOpen(false);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, []);

    const handleGuidanceSelection = async (
        kind: DesignGuidanceEntryKind,
        nextId: string,
        label: string,
    ) => {
        const currentSelectedId = getDesignGuidanceSelectedId(designGuidance, kind);
        if (!projectId || guidanceSwitchBusy || nextId === currentSelectedId) {
            setTechstackDropdownOpen(false);
            setStyleguideDropdownOpen(false);
            return;
        }

        const selectorLabel = kind === "techStack" ? "tech stack guidance" : "styleguide";
        setGuidanceSwitchBusy(kind);
        setNavAnnouncement(`Saving ${selectorLabel} ${label}...`);
        try {
            const nextGuidance: DesignGuidanceSettings = kind === "techStack"
                ? { ...designGuidance, selectedTechStackId: nextId }
                : { ...designGuidance, selectedStyleguideId: nextId };
            await saveProjectDesignGuidanceSettings(projectId, nextGuidance);
            clearProjectEffectiveSettingsCache(projectId);
            await refreshEffectiveSettings();
            setNavAnnouncement(nextId === DESIGN_GUIDANCE_NONE_ID
                ? `${kind === "techStack" ? "Tech stack guidance" : "Styleguide"} set to None.`
                : `${kind === "techStack" ? "Tech stack guidance" : "Styleguide"} switched to ${label}`);
            setTechstackDropdownOpen(false);
            setStyleguideDropdownOpen(false);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            setNavAnnouncement(`Could not save ${selectorLabel}. ${message}`);
        } finally {
            setGuidanceSwitchBusy(null);
        }
    };

    const handleCreateSprint = async (sprint: AddSprintModalSubmission) => {
        if (!projectId) return;
        setNavAnnouncement(`Creating sprint ${sprint.name}...`);
        const created = await createSprint({
            name: sprint.name,
            goal: sprint.goal,
            originalPrompt: null,
            status: "idle",
            showcasePinned: true,
            startDate: null,
            endDate: null,
        });
        if (!created) {
            return;
        }
        await refetchSprints();
        await replaceWorkspaceScope(projectId, created.id);
        await selectSprint(created.id);
        setNavAnnouncement(`Sprint ${created.name} created and selected.`);
    };

    const openAddProjectModal = () => {
        setShowAddProject(true);
    };

    const handleCreateProject = async (project: AddProjectModalSubmission) => {
        if (project.type === 'new_project') {
            const isLocalProject = project.initMode === 'new-local';
            const sourceRef = project.initMode === 'new-local'
                ? (project.path || project.name)
                : (project.repoSlug || project.name);

            await createProject({
                name: project.name,
                sourceType: isLocalProject ? 'local' : 'git',
                sourceRef,
                initMode: project.initMode,
                remoteProvider: project.remoteProvider,
                isPrivate: project.isPrivate,
                settingsOverrides: buildProjectCreationSettingsOverride({
                    ...(isLocalProject ? { githubMode: "LOCAL" as const } : {}),
                    selectedTechstackId: project.selectedTechstackId ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog.defaultTechstackId,
                    applicationKind: project.applicationKind ?? null,
                }),
            });
            return;
        }

        await createProject({
            name: project.name,
            sourceType: project.type,
            sourceRef: project.path,
            cloneDir: project.cloneDir,
            ...(project.type === "local" ? { settingsOverrides: buildProjectCreationSettingsOverride({ githubMode: "LOCAL" }) } : {}),
        });
    };

    return (
        <>
        <header
            ref={navRef}
            data-glass
            className="sticky top-0 z-50 flex items-center justify-between flex-wrap md:flex-nowrap gap-x-4 gap-y-2 w-full min-h-[60px] py-2 md:py-0 px-4 sm:px-6 md:px-12 bg-[#F9F8F4]/90 dark:bg-void-900/90 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.06]"
        >
            <nav aria-label="Primary navigation" className="contents">
            <div className="flex flex-1 min-w-0 flex-wrap items-center gap-2 sm:gap-3 md:gap-4">
                <BrandSection isMobile={isMobile} onMenuToggle={onMenuToggle} hideLogo={hideLogo} isMobileMenuOpen={isMobileMenuOpen} />

                <GlobalSearch projectId={projectId} selectedProject={selectedProject} sprints={sprints} sprintKeyPrefix={sprintKeyPrefix} />

                {/* Tech stack guidance selector */}
                <div className="relative min-w-0" ref={techstackDropdownRef} onKeyDown={techstackKb.onContainerKeyDown}>
                    <button
                        ref={techstackKb.toggleRef}
                        onKeyDown={(e) => {
                            if (techstackSelectorDisabled) {
                                if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
                                    e.preventDefault();
                                    setNavAnnouncement(techstackHelper);
                                }
                                return;
                            }
                            techstackKb.onToggleKeyDown(e);
                        }}
                        onClick={(e) => {
                            if (techstackSelectorDisabled) {
                                e.preventDefault();
                                setNavAnnouncement(techstackHelper);
                                return;
                            }
                            setTechstackDropdownOpen(!techstackDropdownOpen);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={techstackDropdownOpen}
                        id="techstack-selector-button"
                        aria-label={`Tech stack guidance selector, active tech stack: ${!selectedProject ? "No project selected" : guidanceSelectorLoading ? "Loading settings" : techstackActiveLabel}`}
                        aria-controls={techstackDropdownOpen ? "techstack-listbox" : undefined}
                        aria-activedescendant={techstackDropdownOpen ? techstackActiveDescendantId : undefined}
                        aria-busy={guidanceSwitchBusy === "techStack" || guidanceSelectorLoading ? "true" : "false"}
                        aria-disabled={techstackSelectorDisabled}
                        disabled={techstackSelectorDisabled}
                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex h-9 min-w-0 max-w-[10rem] items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.04] px-3 py-0 transition-all group dark:border-white/[0.06] dark:bg-white/[0.04] sm:max-w-[13rem] md:max-w-[15rem] ${
                            techstackSelectorDisabled
                                ? "opacity-60 cursor-not-allowed"
                                : "hover:border-black/[0.08] dark:hover:border-white/[0.08] cursor-pointer"
                        }`}
                    >
                        <Code2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.8} />
                        <span className="min-w-0 truncate font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {techstackTriggerLabel}
                        </span>
                        {!techstackSelectorDisabled && (
                            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${techstackDropdownOpen ? "rotate-180" : ""}`} />
                        )}
                    </button>

                    {techstackDropdownOpen && !techstackSelectorDisabled && (
                        <div id="techstack-listbox" role="listbox" aria-label="Tech stack guidance list" className="absolute top-full right-0 mt-2 min-w-[14rem] w-72 max-w-[calc(100vw-2rem)] bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50">
                            <div className="px-3 pt-3 pb-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Tech Stack Guidance</span>
                            </div>
                            <div className="max-h-64 sm:max-h-72 md:max-h-80 overflow-y-auto dropdown-scrollbar">
                                {techstackOptions.map((option) => {
                                    const selected = option.id === techstackSelectedId;
                                    return (
                                        <button
                                            key={option.id}
                                            id={`techstack-option-${option.id}`}
                                            role="option"
                                            aria-selected={selected}
                                            onClick={() => void handleGuidanceSelection("techStack", option.id, option.name)}
                                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-start gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selected ? "bg-signal-500/8" : ""}`}
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className={`block truncate text-sm font-semibold font-mono transition-colors ${selected ? "text-signal-600 dark:text-signal-400" : "text-slate-700 dark:text-slate-300"}`}>
                                                    {option.name}
                                                </span>
                                                <span className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-slate-500 dark:text-slate-400">
                                                    {option.summary}
                                                </span>
                                            </span>
                                            {selected && (
                                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="p-2 border-t border-black/[0.04] dark:border-white/[0.04] mt-1 flex flex-col gap-1">
                                <a
                                    href="/config?category=guidance#guidance"
                                    onClick={() => setTechstackDropdownOpen(false)}
                                    className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ember-600 dark:text-ember-400 hover:bg-ember-500/[0.06] rounded-xl transition-colors"
                                >
                                    <Plus aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
                                    Add Tech Stack
                                </a>
                                <a
                                    href="/config?category=guidance#guidance"
                                    onClick={() => setTechstackDropdownOpen(false)}
                                    className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
                                >
                                    <span>Manage Guidance</span>
                                    <ArrowRight aria-hidden="true" className="w-3 h-3" strokeWidth={2} />
                                </a>
                            </div>
                        </div>
                    )}
                </div>

                {/* Styleguide selector */}
                <div className="relative min-w-0" ref={styleguideDropdownRef} onKeyDown={styleguideKb.onContainerKeyDown}>
                    <button
                        ref={styleguideKb.toggleRef}
                        onKeyDown={(e) => {
                            if (styleguideSelectorDisabled) {
                                if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
                                    e.preventDefault();
                                    setNavAnnouncement(styleguideHelper);
                                }
                                return;
                            }
                            styleguideKb.onToggleKeyDown(e);
                        }}
                        onClick={(e) => {
                            if (styleguideSelectorDisabled) {
                                e.preventDefault();
                                setNavAnnouncement(styleguideHelper);
                                return;
                            }
                            setStyleguideDropdownOpen(!styleguideDropdownOpen);
                        }}
                        aria-haspopup="listbox"
                        aria-expanded={styleguideDropdownOpen}
                        id="styleguide-selector-button"
                        aria-label={`Styleguide selector, active styleguide: ${!selectedProject ? "No project selected" : guidanceSelectorLoading ? "Loading settings" : styleguideActiveLabel}`}
                        aria-controls={styleguideDropdownOpen ? "styleguide-listbox" : undefined}
                        aria-activedescendant={styleguideDropdownOpen ? styleguideActiveDescendantId : undefined}
                        aria-busy={guidanceSwitchBusy === "styleguide" || guidanceSelectorLoading ? "true" : "false"}
                        aria-disabled={styleguideSelectorDisabled}
                        disabled={styleguideSelectorDisabled}
                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex h-9 min-w-0 max-w-[10rem] items-center gap-2 rounded-xl border border-black/[0.06] bg-black/[0.04] px-3 py-0 transition-all group dark:border-white/[0.06] dark:bg-white/[0.04] sm:max-w-[13rem] md:max-w-[15rem] ${
                            styleguideSelectorDisabled
                                ? "opacity-60 cursor-not-allowed"
                                : "hover:border-black/[0.08] dark:hover:border-white/[0.08] cursor-pointer"
                        }`}
                    >
                        <Palette aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" strokeWidth={1.8} />
                        <span className="min-w-0 truncate font-mono text-sm font-semibold text-slate-700 dark:text-slate-200">
                            {styleguideTriggerLabel}
                        </span>
                        {!styleguideSelectorDisabled && (
                            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform duration-300 ${styleguideDropdownOpen ? "rotate-180" : ""}`} />
                        )}
                    </button>

                    {styleguideDropdownOpen && !styleguideSelectorDisabled && (
                        <div id="styleguide-listbox" role="listbox" aria-label="Styleguide list" className="absolute top-full right-0 mt-2 min-w-[14rem] w-72 max-w-[calc(100vw-2rem)] bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50">
                            <div className="px-3 pt-3 pb-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Styleguide</span>
                            </div>
                            <div className="max-h-64 sm:max-h-72 md:max-h-80 overflow-y-auto dropdown-scrollbar">
                                {styleguideOptions.map((option) => {
                                    const selected = option.id === styleguideSelectedId;
                                    return (
                                        <button
                                            key={option.id}
                                            id={`styleguide-option-${option.id}`}
                                            role="option"
                                            aria-selected={selected}
                                            onClick={() => void handleGuidanceSelection("styleguide", option.id, option.name)}
                                            className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-start gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selected ? "bg-signal-500/8" : ""}`}
                                        >
                                            <span className="min-w-0 flex-1">
                                                <span className={`block truncate text-sm font-semibold font-mono transition-colors ${selected ? "text-signal-600 dark:text-signal-400" : "text-slate-700 dark:text-slate-300"}`}>
                                                    {option.name}
                                                </span>
                                                <span className="mt-0.5 line-clamp-2 text-[11px] font-medium leading-snug text-slate-500 dark:text-slate-400">
                                                    {option.summary}
                                                </span>
                                            </span>
                                            {selected && (
                                                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal-500" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="p-2 border-t border-black/[0.04] dark:border-white/[0.04] mt-1 flex flex-col gap-1">
                                <a
                                    href="/config?category=guidance#guidance"
                                    onClick={() => setStyleguideDropdownOpen(false)}
                                    className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ember-600 dark:text-ember-400 hover:bg-ember-500/[0.06] rounded-xl transition-colors"
                                >
                                    <Plus aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
                                    Add Styleguide
                                </a>
                                <a
                                    href="/config?category=guidance#guidance"
                                    onClick={() => setStyleguideDropdownOpen(false)}
                                    className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
                                >
                                    <span>Manage Guidance</span>
                                    <ArrowRight aria-hidden="true" className="w-3 h-3" strokeWidth={2} />
                                </a>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-2 md:gap-3 shrink-0 min-w-0 flex-wrap justify-end">
                {/* Project Selector */}
                <div className="relative -order-2 min-w-0" ref={dropdownRef} onKeyDown={projectKb.onContainerKeyDown}>
                    <button
                        ref={projectKb.toggleRef}
                        onKeyDown={projectKb.onToggleKeyDown}
                        onClick={() => setDropdownOpen(!dropdownOpen)}
                        data-tour-id="project-selector"
                        aria-haspopup="listbox"
                        aria-expanded={dropdownOpen}
                        id="project-selector-button"
                        aria-label={`Project selector, selected project: ${selectedProject?.name || "None"}`}
                        aria-controls={dropdownOpen ? "project-listbox" : undefined}
                        aria-activedescendant={dropdownOpen && filteredProjects.length > 0 ? (projectKb.activeDescendantId || `project-option-${selectedProject?.id || 'none'}`) : undefined}
                        aria-busy={projectSwitchBusy || loading ? "true" : "false"}
                        className="flex h-9 min-w-0 max-w-[12rem] sm:max-w-[16rem] md:max-w-none items-center gap-2.5 rounded-xl border border-black/[0.06] bg-black/[0.04] px-3.5 py-0 transition-all group hover:border-black/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 dark:border-white/[0.06] dark:bg-white/[0.04] dark:hover:border-white/[0.08]"
                    >
                        <StatusDot status={selectedProject?.status || "idle"} />
                        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono truncate max-w-[80px] sm:max-w-[140px] md:max-w-[200px]">
                            {projectSwitchBusy ? "Switching..." : (selectedProject?.name || (loading ? "Loading..." : "Select Project"))}
                        </span>
                        <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${dropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Project Dropdown */}
                    {dropdownOpen && (
                        <div id="project-listbox" role="listbox" aria-label="Project list" className="absolute top-full right-0 mt-2 min-w-[12rem] w-56 max-w-[calc(100vw-2rem)] bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50">
                            <div className="px-3 pt-3 pb-1.5">
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Projects</span>
                            </div>
                            <div className="px-2 pb-2">
                                <input
                                    type="text"
                                    id="project-filter-input"
                                    aria-label="Filter projects"
                                    aria-controls="project-listbox"
                                    placeholder="Filter projects..."
                                    value={projectFilter}
                                    onInput={(e) => setProjectFilter(e.currentTarget.value)}
                                    aria-describedby="project-filter-desc"
                                    aria-activedescendant={projectKb.activeDescendantId}
                                    className="w-full px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                                />
                                <span id="project-filter-desc" className="sr-only">Use arrow keys to navigate options.</span>
                            </div>
                            <div className="max-h-64 sm:max-h-72 md:max-h-80 overflow-y-auto dropdown-scrollbar">
                            {filteredProjects.length === 0 && (
                                <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                                    No projects found.
                                </div>
                            )}
                            {filteredProjects.map((source) => (
                                <button
                                    key={source.id}
                                    id={`project-option-${source.id}`}
                                    role="option"
                                    aria-selected={selectedProject?.id === source.id}
                                    onClick={async () => {
                                        setProjectSwitchBusy(true);
                                        setNavAnnouncement(`Switching project to ${source.name}...`);
                                        try {
                                            await replaceWorkspaceScope(source.id, null);
                                            await selectProject(source.id);
                                            setNavAnnouncement(`Project switched to ${source.name}`);
                                            setDropdownOpen(false);
                                        } finally {
                                            setProjectSwitchBusy(false);
                                        }
                                    }}
                                    className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selectedProject?.id === source.id ? 'bg-signal-500/8' : ''}`}
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
                                    onClick={() => { setDropdownOpen(false); openAddProjectModal(); }}
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
                    <div className="relative -order-1 min-w-0" ref={sprintDropdownRef} onKeyDown={sprintKb.onContainerKeyDown}>
                        <button
                            ref={sprintKb.toggleRef}
                            onKeyDown={sprintKb.onToggleKeyDown}
                            aria-haspopup="listbox"
                            aria-expanded={sprintDropdownOpen}
                            id="sprint-selector-button"
                            aria-label={`Sprint selector, selected sprint: ${sprintsLoading ? "Loading..." : selectedSprint ? formatSprintDisplay(selectedSprint, sprintKeyPrefix) : "All Sprints"}`}
                            aria-controls={sprintDropdownOpen ? "sprint-listbox" : undefined}
                            aria-activedescendant={sprintDropdownOpen && sprints.length > 0 ? (sprintKb.activeDescendantId || (selectedSprintId ? `sprint-option-${selectedSprintId}` : undefined)) : undefined}
                            aria-busy={sprintSwitchBusy || sprintsLoading ? "true" : "false"}
                            onClick={() => setSprintDropdownOpen(!sprintDropdownOpen)}
                            aria-disabled={false}
                            className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 flex h-9 min-w-0 max-w-[11rem] sm:max-w-[15rem] md:max-w-none items-center gap-2.5 rounded-xl border border-transparent bg-black/[0.04] px-3.5 py-0 transition-all group dark:bg-white/[0.04] hover:border-black/[0.08] dark:hover:border-white/[0.08] cursor-pointer"
                        >
                            {selectedSprint && (
                                <StatusDot status={selectedSprint.status} />
                            )}
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 font-mono truncate max-w-[60px] sm:max-w-[120px] md:max-w-[180px]">
                                {sprintSwitchBusy ? "Switching..." : (sprintsLoading ? "Loading..." : formatSprintDisplay(selectedSprint, sprintKeyPrefix))}
                            </span>
                            <ChevronDown aria-hidden="true" className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${sprintDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {/* Sprint Dropdown */}
                        {sprintDropdownOpen && (
                            <div id="sprint-listbox" role="listbox" aria-label="Sprint list" className="absolute top-full right-0 mt-2 max-w-[calc(100vw-2rem)] min-w-[10rem] bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl border border-black/[0.08] dark:border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden z-50" style={{ minWidth: Math.max(sprintDropdownWidth, 224) + 'px' }}>
                                <div className="px-3 pt-3 pb-1.5">
                                    <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Sprint Scope</span>
                                </div>
                                <div className="px-2 pb-2">
                                    <input
                                        type="text"
                                        id="sprint-filter-input"
                                        aria-label="Filter sprints"
                                        aria-controls="sprint-listbox"
                                        placeholder="Filter sprints..."
                                        value={sprintFilter}
                                        onInput={(e) => setSprintFilter(e.currentTarget.value)}
                                        aria-describedby="sprint-filter-desc"
                                        aria-activedescendant={sprintKb.activeDescendantId}
                                        className="w-full px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-signal-500/30"
                                    />
                                    <span id="sprint-filter-desc" className="sr-only">Use arrow keys to navigate options.</span>
                                </div>
                                <div className="max-h-64 sm:max-h-72 md:max-h-80 overflow-y-auto dropdown-scrollbar">
                                {filteredSprints.length === 0 && (
                                    <div className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">
                                        {sprints.length === 0 ? "No sprints yet." : "No sprints found."}
                                    </div>
                                )}
                                {filteredSprints.map((sprint) => (
                                    <button
                                        key={sprint.id}
                                        id={`sprint-option-${sprint.id}`}
                                        role="option"
                                        aria-selected={selectedSprintId === sprint.id}
                                        onClick={async () => {
                                            setSprintSwitchBusy(true);
                                            setNavAnnouncement(`Switching sprint to ${sprint.name}...`);
                                            try {
                                                await replaceWorkspaceScope(selectedProject.id, sprint.id);
                                                await selectSprint(sprint.id);
                                                setNavAnnouncement(`Sprint switched to ${sprint.name}`);
                                                setSprintDropdownOpen(false);
                                            } finally {
                                                setSprintSwitchBusy(false);
                                            }
                                        }}
                                        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2.5 px-3 py-3 min-h-[44px] text-left hover:bg-signal-500/5 transition-colors group ${selectedSprintId === sprint.id ? 'bg-signal-500/8' : ''}`}
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
                                <div className="p-2 border-t border-black/[0.04] dark:border-white/[0.04] mt-1 flex flex-col gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSprintDropdownOpen(false);
                                            setShowAddSprint(true);
                                        }}
                                        className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-ember-600 dark:text-ember-400 hover:bg-ember-500/[0.06] rounded-xl transition-colors"
                                    >
                                        <Target aria-hidden="true" className="w-3.5 h-3.5" strokeWidth={2} />
                                        Add Sprint
                                    </button>
                                    <Link
                                        to="/sprints"
                                        onClick={() => setSprintDropdownOpen(false)}
                                        className="focus-visible:ring-2 focus-visible:ring-signal-500/50 w-full flex items-center justify-between gap-2 px-3 py-2 min-h-[44px] text-xs font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.04] dark:hover:bg-white/[0.04] rounded-xl transition-colors"
                                    >
                                        <span>Manage Sprints</span>
                                        <ArrowRight aria-hidden="true" className="w-3 h-3" strokeWidth={2} />
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>
                )}


                <TelemetryStats projectId={projectId} sprints={sprints} />

                <div className="w-px h-5 bg-black/10 dark:bg-white/10 hidden sm:block" />

                {/* Docker Status */}
                <DockerStatusMenu />

                <BrowserSessionsMenu enabled={browserVisible} />

                <ScheduledAgentIndicator entries={notifications.agentSchedules ?? []} />

                {/* Notifications */}
                <div
                    className="relative inline-block"
                    ref={notificationContainerRef}
                    onMouseEnter={handleNotificationMouseEnter}
                    onMouseLeave={handleNotificationMouseLeave}
                >
                    <Tooltip content="Notifications">
                        <button
                            ref={notificationTriggerRef}
                            type="button"
                            onClick={toggleNotificationMenu}
                            onFocus={handleNotificationFocus}
                            onBlur={handleNotificationBlur}
                            aria-haspopup="menu"
                            aria-expanded={isNotificationMenuVisible}
                            aria-label={`Notifications: ${notifications.unreadCount} unread`}
                            className="relative w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
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
                        onClick={() => setTheme(isDark ? "LIGHT" : "DARK")}
                        aria-label={`Current theme: ${isDark ? "Dark" : "Light"}. ${isDark ? "Switch to light mode" : "Switch to dark mode"}`}
                        className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl hover:bg-black/[0.05] dark:hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
                    >
                        {isDark
                            ? <Sun aria-hidden="true" className="w-4 h-4 text-slate-400 hover:text-white transition-colors" strokeWidth={1.5} />
                            : <Moon aria-hidden="true" className="w-4 h-4 text-slate-500 hover:text-slate-900 transition-colors" strokeWidth={1.5} />
                        }
                    </button>
                </Tooltip>
            </div>
            </nav>
            <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
                {navAnnouncement}
            </div>
        </header>

            {showAddProject && (
                <AddProjectModal
                    onClose={() => {
                        setShowAddProject(false);
                    }}
                    onAdd={(project) => { void handleCreateProject(project); }}
                />
            )}
            {showAddSprint && (
                <AddSprintModal
                    projectName={selectedProject?.name}
                    onClose={() => {
                        setShowAddSprint(false);
                    }}
                    onAdd={(sprint) => { void handleCreateSprint(sprint); }}
                />
            )}
        </>
    );
};
