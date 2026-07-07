import type { FunctionComponent, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import { prefetchRoute } from "../../router/route-prefetch.js";
import gsap from "gsap";
import { BookOpen, Hexagon, Layers, ListChecks, Zap, Settings, Inbox, Cpu, BarChart3, Compass, MessageCircle, ChevronLeft, ChevronRight, CalendarDays, FolderTree, Library } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { NavItem } from "./NavItem.js";
import { useAnimatedActiveIndicator, useGsapInteractionTokens, useInteractionTokens } from "../../lib/motion/index.js";
import { useLayoutEffect } from "preact/hooks";
import { RobotLogo } from "../brand/RobotLogo.js";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";

const ALL_NAV_ITEMS = [
    { icon: MessageCircle, label: "Chat",     path: "/chat" },
    { icon: Hexagon,    label: "Overview", path: "/" },
    { icon: Layers,     label: "Sprints",  path: "/sprints" },
    { icon: ListChecks, label: "Tasks",    path: "/tasks" },
    { icon: Cpu,        label: "Agents",   path: "/agents" },
    { icon: BarChart3,  label: "Stats",    path: "/stats" },
    { icon: CalendarDays, label: "Schedule", path: "/scheduler" },
    { icon: Inbox,    label: "Memory",   path: "/memory" },
    { icon: Library,  label: "Knowledge", path: "/knowledge" },
    { icon: Compass,  label: "Browser",  path: "/browser" },
    { icon: FolderTree, label: "Files",  path: "/files" },
    { icon: Zap,      label: "Live",     path: "/live" },
];

type SidebarNavItem = (typeof ALL_NAV_ITEMS)[number] & {
    unavailableReason?: string;
};

interface SidebarProps {
    isMobile?: boolean;
    isOpen?: boolean;
    onClose?: () => void;
}

export const Sidebar: FunctionComponent<SidebarProps> = ({ isMobile, isOpen, onClose }) => {
    const sidebarRef = useRef<HTMLElement>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const [brandActive, setBrandActive] = useState(false);
    const { selectedProject } = useProjectData();
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

    const indicatorRef = useRef<HTMLDivElement>(null);
    const navItemRefs = useRef<(HTMLElement | null)[]>([]);

    const [isMinimized, setIsMinimized] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('codeux:sidebar:minimized') === 'true';
        }
        return false;
    });

    const trapRef = useFocusTrap(!!isMobile && !!isOpen, { onClose: isMobile ? onClose : undefined, restoreFocus: true, initialFocusRef: undefined });

    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );

    const navItems: SidebarNavItem[] = ALL_NAV_ITEMS.map((item) => item.path === "/browser" && !browserVisible
        ? { ...item, unavailableReason: "Enable sprint preview and the in-app browser for this project" }
        : item
    );

    const prefersReducedMotion = useReducedMotion();
    const interactionTokens = useInteractionTokens();
    const gsapTokens = useGsapInteractionTokens();
    const controlTransitionStyle: JSX.CSSProperties = {
        transitionDuration: interactionTokens.controlFeedback.duration,
        transitionTimingFunction: interactionTokens.controlFeedback.ease,
    };
    const selectionTransitionStyle: JSX.CSSProperties = {
        transitionDuration: interactionTokens.selectionMovement.duration,
        transitionTimingFunction: interactionTokens.selectionMovement.ease,
    };
    const enterExitTransitionStyle: JSX.CSSProperties = {
        transitionDuration: interactionTokens.enterExit.duration,
        transitionTimingFunction: interactionTokens.enterExit.ease,
    };

    const matches = useRouterState({ select: (s) => s.matches });
    const currentPath = (matches && matches.length > 0) ? (matches[matches.length - 1]?.pathname || "/") : "/";
    const activeIndex = navItems.findIndex(i => (i.path === currentPath || (i.path !== "/" && currentPath.startsWith(`${i.path}/`))) && !i.unavailableReason);

    useLayoutEffect(() => {
        const activeElement = navItemRefs.current[activeIndex];
        if (indicatorRef.current && activeElement) {
            const offsetTop = activeElement.offsetTop;
            const offsetHeight = activeElement.offsetHeight;
            const y = offsetTop + (offsetHeight / 2) - 12;
            if (!indicatorRef.current.dataset.initialized) {
                gsap.set(indicatorRef.current, { y, height: 24 });
                indicatorRef.current.dataset.initialized = "true";
            } else {
                gsap.to(indicatorRef.current, {
                    y,
                    height: 24,
                    duration: gsapTokens.selectionMovement.duration,
                    ease: gsapTokens.selectionMovement.ease
                });
            }
        }
    }, [activeIndex, isMinimized, gsapTokens.selectionMovement.duration, gsapTokens.selectionMovement.ease]);

    const indicator = useAnimatedActiveIndicator(navRef, activeIndex, '[data-nav-item]', 'vertical');

    useEffect(() => {
        if (!isMobile && sidebarRef.current) {
            if (prefersReducedMotion) {
                gsap.set(sidebarRef.current, { x: 0, opacity: 1 });
            } else {
                gsap.fromTo(sidebarRef.current, { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: gsapTokens.enterExit.duration, ease: gsapTokens.enterExit.ease });
            }
        }
    }, [isMobile, prefersReducedMotion, gsapTokens.enterExit.duration, gsapTokens.enterExit.ease]);

    useEffect(() => {
        if (!isMobile) {
            // Reset transforms if returning to desktop
            gsap.set(sidebarRef.current, { x: 0, opacity: 1 });
        }
    }, [isMobile, isOpen]);

    // Auto-minimize on click outside (Desktop only)
    useEffect(() => {
        if (isMobile) return;
        const handleDocumentClick = (e: MouseEvent) => {
            if (!isMinimized && sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
                setIsMinimized(true);
                if (typeof window !== 'undefined') {
                    localStorage.setItem('codeux:sidebar:minimized', 'true');
                }
            }
        };
        document.addEventListener('mousedown', handleDocumentClick);
        return () => document.removeEventListener('mousedown', handleDocumentClick);
    }, [isMobile, isMinimized]);

    const toggleMinimize = () => {
        setIsMinimized(prev => {
            const next = !prev;
            if (typeof window !== 'undefined') {
                localStorage.setItem('codeux:sidebar:minimized', next.toString());
            }
            return next;
        });
    };

    return (
        <>
        {isMobile && (
            <div
                className={`fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity motion-reduce:transition-none lg:hidden ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                style={enterExitTransitionStyle}
                aria-hidden="true"
                onClick={onClose}
            />
        )}
        <aside
            id="primary-navigation"
            aria-label={isMobile ? "Mobile primary navigation" : "Primary navigation"}
            role={isMobile && isOpen ? "dialog" : undefined}
            aria-modal={isMobile && isOpen ? "true" : undefined}
            tabIndex={-1}
            ref={(el) => { (sidebarRef as any).current = el; (trapRef as any).current = el; }}
            className={`${isMobile ? 'h-dvh' : 'h-full'} shrink-0 border-r border-black/[0.06] dark:border-white/[0.06] bg-[#F9F8F4]/80 dark:bg-void-900/80 backdrop-blur-xl flex flex-col justify-between pt-8 pb-[max(2rem,env(safe-area-inset-bottom))] z-50 transition-[width,transform,opacity] motion-reduce:transition-none ${
                isMobile 
                    ? `fixed left-0 top-0 w-[260px] shadow-2xl bg-[#F9F8F4] dark:bg-void-900 overflow-y-auto overflow-x-hidden ${isOpen ? 'translate-x-0' : '-translate-x-full'}`
                    : (isMinimized ? 'relative w-[88px]' : 'relative w-[260px]')
            }`}
            style={isMobile ? enterExitTransitionStyle : selectionTransitionStyle}
        >
            {/* Logo */}
            <a
                href="/"
                aria-label="Code UX home"
                onMouseEnter={() => setBrandActive(true)}
                onMouseLeave={() => setBrandActive(false)}
                onFocus={() => setBrandActive(true)}
                onBlur={() => setBrandActive(false)}
                className={`mb-10 flex items-center group cursor-pointer relative z-10 w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 rounded-xl transition-[width,box-shadow,transform] motion-reduce:transition-none ${isMinimized && !isMobile ? 'px-0 w-full justify-center' : 'px-7 gap-3'}`}
                style={controlTransitionStyle}
            >
                <div aria-hidden="true" className="relative w-10 h-10 rounded-2xl overflow-hidden ring-1 ring-inset ring-white/[0.06] dark:ring-white/[0.08] shadow-[0_0_22px_rgba(0,224,160,0.22)] group-hover:shadow-[0_0_34px_rgba(0,224,160,0.42)] transition-shadow motion-reduce:transition-none shrink-0" style={controlTransitionStyle}>
                    <RobotLogo size={40} rounded={false} active={brandActive} className="transition-transform motion-reduce:transition-none group-hover:scale-[1.06]" />
                </div>
                <div className={`overflow-hidden transition-[width,opacity] motion-reduce:transition-none ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'w-auto opacity-100'}`} style={selectionTransitionStyle}>
                    <span className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-0.5 whitespace-nowrap">
                        Code<span className="text-signal-500">UX</span>
                    </span>
                </div>
            </a>

            {/* Navigation */}
            <nav ref={navRef} aria-label={isMobile ? "Mobile workspace navigation" : "Workspace navigation"} className="flex-1 flex flex-col relative z-10 overflow-y-auto scrollbar-hide pb-4">
                <h2 className={`px-8 text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.16em] mb-3 transition-[width,height,opacity,margin] motion-reduce:transition-none overflow-hidden ${isMinimized && !isMobile ? 'w-0 h-0 opacity-0 m-0' : 'opacity-100'}`} style={selectionTransitionStyle}>
                    Workspace
                </h2>

                {/* Sliding Active Indicator */}
                <div
                    className="absolute left-4 right-4 z-0 rounded-2xl bg-signal-500/[0.10] dark:bg-signal-500/[0.10] pointer-events-none transition-[transform,width,height,opacity] motion-reduce:transition-none"
                    style={{ ...(indicator.style as any), ...selectionTransitionStyle }}
                >
                </div>
                {/* Shared Vertical Indicator */}
                <div
                    ref={indicatorRef}
                    className="absolute left-0 w-0.5 bg-signal-500 rounded-r-full pointer-events-none z-10 transition-[transform,height,opacity] motion-reduce:transition-none"
                    style={{ height: "24px", ...selectionTransitionStyle }}
                />

                {navItems.map((item, idx) => (
                    <NavItem
                        key={item.label}
                        elementRef={(el) => { navItemRefs.current[idx] = el as HTMLElement | null; }}
                        item={item}
                        isActive={activeIndex === idx}
                        isMinimized={isMinimized}
                        isMobile={isMobile}
                        onClose={onClose}
                    />
                ))}
            </nav>

            {/* Settings & Toggle */}
            <div className="relative z-10 flex flex-col">
                <Link
                    to="/docs"
                    onClick={isMobile ? onClose : undefined}
                    onMouseEnter={() => prefetchRoute("/docs")}
                    onPointerDown={() => prefetchRoute("/docs")}
                    onFocus={() => prefetchRoute("/docs")}
                    aria-label="Docs"
                    aria-describedby={isMinimized && !isMobile ? "nav-tooltip-docs" : undefined}
                    aria-current={currentPath === "/docs" || currentPath.startsWith("/docs/") ? "page" : undefined}
                    data-tour-id="nav-docs"
                    className={`relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-2 min-h-[40px] rounded-2xl transition-[background-color,border-color,box-shadow,color,opacity,transform] motion-reduce:transition-none group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-2xl focus-visible:z-10 no-underline decoration-transparent`}
                    style={controlTransitionStyle}
                >
                    <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-[opacity,transform,background-color] motion-reduce:transition-none pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" style={controlTransitionStyle} />
                    <BookOpen aria-hidden="true" className={`relative z-10 w-4 h-4 shrink-0 transition-[color,transform] motion-reduce:transition-none ${currentPath === "/docs" || currentPath.startsWith("/docs/") ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} strokeWidth={currentPath === "/docs" || currentPath.startsWith("/docs/") ? 2 : 1.5} style={selectionTransitionStyle} />
                    <div className={`relative z-10 overflow-hidden transition-[width,opacity] motion-reduce:transition-none ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`} style={selectionTransitionStyle}>
                        <span className={`font-medium text-sm tracking-wide transition-colors whitespace-nowrap ${currentPath === "/docs" || currentPath.startsWith("/docs/") ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} style={controlTransitionStyle}>
                            Docs
                        </span>
                    </div>
                    {isMinimized && !isMobile && (
                        <div id="nav-tooltip-docs" aria-hidden="true" className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-white/95 dark:bg-void-800/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs font-bold tracking-wide rounded-2xl opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] motion-reduce:transition-none pointer-events-none shadow-2xl z-[100] max-w-[calc(100vw-6rem)] text-wrap break-words whitespace-normal flex items-center gap-2" style={controlTransitionStyle}>
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500/80 shadow-[0_0_6px_rgba(0,224,160,0.6)] shrink-0"></span>
                            Docs
                        </div>
                    )}
                </Link>

                <Link
                    to="/config"
                    onClick={isMobile ? onClose : undefined}
                    onMouseEnter={() => prefetchRoute("/config")}
                    onPointerDown={() => prefetchRoute("/config")}
                    onFocus={() => prefetchRoute("/config")}
                    aria-label="Settings"
                    aria-describedby={isMinimized && !isMobile ? "nav-tooltip-settings" : undefined}
                    aria-current={currentPath === "/config" ? "page" : undefined}
                    data-tour-id="nav-config" 
                    className={`relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-2 min-h-[40px] rounded-2xl transition-[background-color,border-color,box-shadow,color,opacity,transform] motion-reduce:transition-none group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-2xl focus-visible:z-10 no-underline decoration-transparent`}
                    style={controlTransitionStyle}
                >
                    <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-[opacity,transform,background-color] motion-reduce:transition-none pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" style={controlTransitionStyle} />
                    <Settings aria-hidden="true" className={`relative z-10 w-4 h-4 shrink-0 group-hover:rotate-90 transition-[color,transform] motion-reduce:transition-none ${currentPath === "/config" ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} strokeWidth={currentPath === "/config" ? 2 : 1.5} style={selectionTransitionStyle} />
                    <div className={`relative z-10 overflow-hidden transition-[width,opacity] motion-reduce:transition-none ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`} style={selectionTransitionStyle}>
                        <span className={`font-medium text-sm tracking-wide transition-colors whitespace-nowrap ${currentPath === "/config" ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} style={controlTransitionStyle}>
                            Settings
                        </span>
                    </div>
                    {isMinimized && !isMobile && (
                        <div id="nav-tooltip-settings" aria-hidden="true" className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-white/95 dark:bg-void-800/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs font-bold tracking-wide rounded-2xl opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] motion-reduce:transition-none pointer-events-none shadow-2xl z-[100] max-w-[calc(100vw-6rem)] text-wrap break-words whitespace-normal flex items-center gap-2" style={controlTransitionStyle}>
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500/80 shadow-[0_0_6px_rgba(0,224,160,0.6)] shrink-0"></span>
                            Settings
                        </div>
                    )}
                </Link>

                {!isMobile && (
                    <button
                        onClick={toggleMinimize}
                        className={`mt-2 relative flex items-center ${isMinimized ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-2 min-h-[40px] rounded-2xl transition-[background-color,border-color,box-shadow,color,opacity,transform] motion-reduce:transition-none group focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:rounded-2xl focus-visible:z-10 bg-transparent border-0 cursor-pointer`}
                        style={controlTransitionStyle}
                        aria-label={isMinimized ? "Expand sidebar" : "Collapse sidebar"}
                        aria-describedby={isMinimized ? "nav-tooltip-sidebar-toggle" : undefined}
                        aria-expanded={!isMinimized}
                        aria-controls="primary-navigation"
                    >
                        <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-[opacity,transform,background-color] motion-reduce:transition-none pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100" style={controlTransitionStyle} />
                        {isMinimized ? (
                            <ChevronRight aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-signal-500 transition-colors motion-reduce:transition-none" strokeWidth={1.5} style={controlTransitionStyle} />
                        ) : (
                            <ChevronLeft aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-signal-500 transition-colors motion-reduce:transition-none" strokeWidth={1.5} style={controlTransitionStyle} />
                        )}
                        <div className={`relative z-10 overflow-hidden transition-[width,opacity] motion-reduce:transition-none text-left ${isMinimized ? 'w-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'}`} style={selectionTransitionStyle}>
                            <span className="font-medium text-sm tracking-wide text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors whitespace-nowrap" style={controlTransitionStyle}>
                                Collapse
                            </span>
                        </div>
                        {isMinimized && (
                            <div id="nav-tooltip-sidebar-toggle" aria-hidden="true" className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-white/95 dark:bg-void-800/95 backdrop-blur-xl border border-black/[0.08] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs font-bold tracking-wide rounded-2xl opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 group-focus-visible:opacity-100 group-focus-visible:translate-x-0 transition-[opacity,transform] motion-reduce:transition-none pointer-events-none shadow-2xl z-[100] max-w-[calc(100vw-6rem)] text-wrap break-words whitespace-normal flex items-center gap-2" style={controlTransitionStyle}>
                                <span className="w-1.5 h-1.5 rounded-full bg-signal-500/80 shadow-[0_0_6px_rgba(0,224,160,0.6)] shrink-0"></span>
                                Expand sidebar
                            </div>
                        )}
                    </button>
                )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#F9F8F4] dark:from-void-900 to-transparent pointer-events-none z-0" />
        </aside>
        </>
    );
};
