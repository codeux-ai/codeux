import type { FunctionComponent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import gsap from "gsap";
import { Hexagon, Layers, ListChecks, Zap, Settings, Inbox, Cpu, BarChart3, Compass, MessageCircle, ChevronLeft, ChevronRight, CalendarDays, FolderTree } from "lucide-preact";
import { useProjectData } from "../../context/project-data.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { RobotLogo } from "../brand/RobotLogo.js";

const ALL_NAV_ITEMS = [
    { icon: MessageCircle, label: "Chat",     path: "/chat" },
    { icon: Hexagon,    label: "Overview", path: "/" },
    { icon: Layers,     label: "Sprints",  path: "/sprints" },
    { icon: ListChecks, label: "Tasks",    path: "/tasks" },
    { icon: Cpu,        label: "Agents",   path: "/agents" },
    { icon: BarChart3,  label: "Stats",    path: "/stats" },
    { icon: CalendarDays, label: "Schedule", path: "/scheduler" },
    { icon: Inbox,    label: "Memory",   path: "/memory" },
    { icon: Compass,  label: "Browser",  path: "/browser" },
    { icon: FolderTree, label: "Files",  path: "/files" },
    { icon: Zap,      label: "Live",     path: "/live" },
];

interface SidebarProps {
    isMobile?: boolean;
    isOpen?: boolean;
    onClose?: () => void;
}

export const Sidebar: FunctionComponent<SidebarProps> = ({ isMobile, isOpen, onClose }) => {
    const sidebarRef = useRef<HTMLElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const [brandActive, setBrandActive] = useState(false);
    const { selectedProject } = useProjectData();
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

    const [isMinimized, setIsMinimized] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('codeux:sidebar:minimized') === 'true';
        }
        return false;
    });

    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );

    const navItems = browserVisible ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((item) => item.path !== "/browser");

    const prefersReducedMotion = useReducedMotion();

    const matches = useRouterState({ select: (s) => s.matches });
    const currentPath = (matches && matches.length > 0) ? (matches[matches.length - 1]?.pathname || "/") : "/";
    const activeIndex = Math.max(0, navItems.findIndex(i => i.path === currentPath));

    const indicatorLineRef = useRef<SVGSVGElement>(null);
    const updateLinePosition = () => {
        if (!navRef.current || !indicatorLineRef.current) return;

        // Target links directly to avoid index shifting due to headers or other injected non-link items
        const linkNodes = navRef.current.querySelectorAll('.nav-item-link');
        const activeLink = linkNodes[activeIndex] as HTMLElement;

        if (!activeLink) return;

        const navTop = navRef.current.getBoundingClientRect().top;
        const activeLinkTop = activeLink.getBoundingClientRect().top;
        const relativeOffset = activeLinkTop - navTop;

        const duration = prefersReducedMotion ? 0 : 0.5;

        gsap.to(indicatorLineRef.current, {
            y: relativeOffset,
            duration,
            ease: "power2.out",
        });
    };

    useEffect(() => {
        updateLinePosition();
    }, [activeIndex, isMinimized, isMobile, prefersReducedMotion]);

    useEffect(() => {
        window.addEventListener('resize', updateLinePosition);
        return () => window.removeEventListener('resize', updateLinePosition);
    }, [activeIndex, isMinimized, isMobile, prefersReducedMotion]);

    useEffect(() => {
        if (!isMobile && sidebarRef.current) {
            if (prefersReducedMotion) {
                gsap.set(sidebarRef.current, { x: 0, opacity: 1 });
            } else {
                gsap.fromTo(sidebarRef.current, { x: -50, opacity: 0 }, { x: 0, opacity: 1, duration: 1.2, ease: "power4.out" });
            }
        }
    }, [isMobile, prefersReducedMotion]);

    useEffect(() => {
        if (isMobile) {
            const animDuration = prefersReducedMotion ? 0 : 0.4;
            const overlayDuration = prefersReducedMotion ? 0 : 0.3;

            if (isOpen) {
                gsap.to(sidebarRef.current, { x: 0, opacity: 1, duration: animDuration, ease: "power3.out" });
                if (overlayRef.current) {
                    gsap.to(overlayRef.current, { opacity: 1, duration: overlayDuration, ease: "power2.out", display: "block" });
                }
            } else {
                gsap.to(sidebarRef.current, { x: "-100%", opacity: 0, duration: animDuration, ease: "power3.in" });
                if (overlayRef.current) {
                    gsap.to(overlayRef.current, { opacity: 0, duration: overlayDuration, ease: "power2.in", display: "none" });
                }
            }
        } else {
            // Reset transforms if returning to desktop
            gsap.set(sidebarRef.current, { x: 0, opacity: 1 });
            if (overlayRef.current) {
                gsap.set(overlayRef.current, { display: "none", opacity: 0 });
            }
        }
    }, [isMobile, isOpen, prefersReducedMotion]);

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
                ref={overlayRef}
                className="fixed inset-0 bg-black/50 z-40 hidden cursor-pointer backdrop-blur-sm"
                aria-hidden="true"
                onClick={onClose}
            />
        )}
        <aside
            aria-label="Primary Navigation"
            ref={sidebarRef}
            className={`h-full shrink-0 border-r border-black/[0.05] dark:border-white/[0.04] bg-[#F5F3EF]/60 dark:bg-void-900 flex flex-col justify-between py-8 z-50 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                isMobile 
                    ? 'fixed left-0 top-0 w-[280px] max-w-[85vw] -translate-x-full opacity-0 shadow-2xl bg-[#F5F3EF] dark:bg-void-900'
                    : (isMinimized ? 'relative w-[88px]' : 'relative w-[260px]')
            }`}
        >
            {/* Logo */}
            <a
                href="/"
                onMouseEnter={() => setBrandActive(true)}
                onMouseLeave={() => setBrandActive(false)}
                onFocus={() => setBrandActive(true)}
                onBlur={() => setBrandActive(false)}
                className={`mb-10 flex items-center group cursor-pointer relative z-10 w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 rounded-xl transition-all duration-500 ${isMinimized && !isMobile ? 'px-0 w-full justify-center' : 'px-7 gap-3'}`}
            >
                <div aria-hidden="true" className="relative w-10 h-10 rounded-2xl overflow-hidden ring-1 ring-inset ring-white/[0.06] dark:ring-white/[0.08] shadow-[0_0_22px_rgba(0,224,160,0.22)] group-hover:shadow-[0_0_34px_rgba(0,224,160,0.42)] transition-shadow duration-500 shrink-0">
                    <RobotLogo size={40} rounded={false} active={brandActive} className="transition-transform duration-500 ease-out group-hover:scale-[1.06]" />
                </div>
                <div className={`overflow-hidden transition-all duration-500 ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>
                    <h1 className="font-display font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-0.5 whitespace-nowrap">
                        Code<span className="text-signal-500">UX</span>
                    </h1>
                </div>
            </a>

            {/* Navigation */}
            <nav ref={navRef} className="flex-1 flex flex-col relative z-10">
                <svg
                    ref={indicatorLineRef}
                    className="absolute left-0 w-2 h-10 pointer-events-none drop-shadow-[0_0_8px_rgba(0,224,160,0.6)]"
                    style={{ top: 0, zIndex: 10 }}
                    viewBox="0 0 8 40"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <path
                        d="M 0 0 C 8 10, 8 30, 0 40"
                        className="fill-signal-500"
                    />
                </svg>

                <h2 className={`px-8 text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.16em] mb-3 transition-all duration-500 overflow-hidden ${isMinimized && !isMobile ? 'w-0 h-0 opacity-0 m-0' : 'opacity-100'}`}>
                    Workspace
                </h2>
                {navItems.map((item, idx) => {
                    const isActive = activeIndex === idx;
                    return (
                        <Link
                            key={item.label}
                            to={item.path}
                            onClick={isMobile ? onClose : undefined}
                            aria-current={isActive ? "page" : undefined}
                            data-tour-id={`nav-${item.label.toLowerCase()}`}
                            className={`nav-item-link relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-3 min-h-[44px] rounded-2xl transition-all duration-300 group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 decoration-none`}
                        >
                            <div className={`absolute inset-0 rounded-2xl transition-all duration-300 pointer-events-none origin-left ${isActive ? 'bg-signal-500/[0.10] dark:bg-signal-500/[0.10] opacity-100 translate-x-0' : 'bg-black/[0.05] dark:bg-white/[0.05] opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100'}`} />
                            <div className={`absolute inset-0 rounded-2xl pointer-events-none transition-all duration-300 ${isActive ? 'shadow-[inset_0_0_0_1px_rgba(0,224,160,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(0,224,160,0.1)]' : 'shadow-none'}`} />

                            <item.icon aria-hidden="true" className={`relative z-10 w-4 h-4 transition-all duration-300 shrink-0 ${isActive ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 group-hover:translate-x-1'}`} strokeWidth={isActive ? 2 : 1.5} />

                            <div className={`relative z-10 overflow-hidden transition-all duration-500 ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`}>
                                <span className={`font-medium text-sm tracking-wide transition-all duration-300 whitespace-nowrap ${isActive ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 opacity-0 translate-x-4 group-hover:opacity-100 group-hover:translate-x-0'}`}>
                                    {item.label}
                                </span>
                            </div>

                            {/* Award Winning Tooltip for Minimized State */}
                            {isMinimized && !isMobile && (
                                <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold tracking-wide rounded-lg opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none shadow-xl z-[100] whitespace-nowrap flex items-center gap-2">
                                    <span className="w-1.5 h-1.5 rounded-full bg-signal-500/80 shadow-[0_0_6px_rgba(0,224,160,0.6)]"></span>
                                    {item.label}
                                </div>
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Settings & Toggle */}
            <div className="relative z-10 flex flex-col">
                <Link 
                    to="/config" 
                    onClick={isMobile ? onClose : undefined}
                    aria-label="Settings" 
                    data-tour-id="nav-config" 
                    className={`relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-3 min-h-[44px] rounded-2xl transition-all duration-300 group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 decoration-none`}
                >
                    <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-all duration-300 pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100" />
                    <Settings aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 group-hover:rotate-90 transition-all duration-700 ease-in-out" strokeWidth={1.5} />
                    <div className={`relative z-10 overflow-hidden transition-all duration-500 ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`}>
                        <span className="font-medium text-sm tracking-wide text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300 whitespace-nowrap">
                            Settings
                        </span>
                    </div>
                    {isMinimized && !isMobile && (
                        <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold tracking-wide rounded-lg opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none shadow-xl z-[100] whitespace-nowrap flex items-center gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-500/80"></span>
                            Settings
                        </div>
                    )}
                </Link>

                {!isMobile && (
                    <button
                        onClick={toggleMinimize}
                        className={`mt-2 relative flex items-center ${isMinimized ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-3 min-h-[44px] rounded-2xl transition-all duration-300 group focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 bg-transparent border-0 cursor-pointer`}
                        aria-label={isMinimized ? "Expand Sidebar" : "Minimize Sidebar"}
                    >
                        <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-all duration-300 pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100" />
                        {isMinimized ? (
                            <ChevronRight aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-signal-500 transition-colors duration-300" strokeWidth={1.5} />
                        ) : (
                            <ChevronLeft aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-signal-500 transition-colors duration-300" strokeWidth={1.5} />
                        )}
                        <div className={`relative z-10 overflow-hidden transition-all duration-500 text-left ${isMinimized ? 'w-0 opacity-0 pointer-events-none' : 'flex-1 opacity-100'}`}>
                            <span className="font-medium text-sm tracking-wide text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300 whitespace-nowrap">
                                Collapse
                            </span>
                        </div>
                        
                        {isMinimized && (
                            <div className="absolute left-[calc(100%+16px)] top-1/2 -translate-y-1/2 px-3 py-1.5 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold tracking-wide rounded-lg opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 pointer-events-none shadow-xl z-[100] whitespace-nowrap flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-slate-500/80"></span>
                                Expand
                            </div>
                        )}
                    </button>
                )}
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#F5F3EF] dark:from-void-900 to-transparent pointer-events-none z-0" />
        </aside>
        </>
    );
};
