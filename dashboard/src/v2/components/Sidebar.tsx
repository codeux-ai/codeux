import type { FunctionComponent } from "preact";
import { useEffect, useRef, useLayoutEffect } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import gsap from "gsap";
import { Hexagon, Layers, ListChecks, Zap, Settings, Inbox, Cpu, BarChart3, Compass, MessageCircle } from "lucide-preact";
import { useProjectData } from "../context/project-data.js";
import { useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

const ALL_NAV_ITEMS = [
    { icon: MessageCircle, label: "Chat",     path: "/chat" },
    { icon: Hexagon,    label: "Overview", path: "/" },
    { icon: Layers,     label: "Sprints",  path: "/sprints" },
    { icon: ListChecks, label: "Tasks",    path: "/tasks" },
    { icon: Cpu,        label: "Agents",   path: "/agents" },
    { icon: BarChart3,  label: "Stats",    path: "/stats" },
    { icon: Inbox,    label: "Memory",   path: "/memory" },
    { icon: Compass,  label: "Browser",  path: "/browser" },
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
    const lineRef = useRef<SVGPathElement>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const { selectedProject } = useProjectData();
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);

    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );

    const navItems = browserVisible ? ALL_NAV_ITEMS : ALL_NAV_ITEMS.filter((item) => item.path !== "/browser");

    const prefersReducedMotion = useReducedMotion();

    const matches = useRouterState({ select: (s) => s.matches });
    const currentPath = (matches && matches.length > 0) ? (matches[matches.length - 1]?.pathname || "/") : "/";
    const activeIndex = Math.max(0, navItems.findIndex(i => i.path === currentPath));

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

    const updateLinePosition = () => {
        if (lineRef.current && navRef.current) {
            // navRef has h2 as children[0], so children[activeIndex + 1] is the correct item
            const button = navRef.current.children[activeIndex + 1] as HTMLElement;
            if (button) {
                const targetY = button.offsetTop + (button.offsetHeight / 2);
                const path = `M0,0 C10,${targetY - 30} 24,${targetY - 15} 24,${targetY} C24,${targetY + 15} 10,${targetY + 30} 0,800`;
                gsap.to(lineRef.current, {
                    attr: { d: path },
                    duration: 0.6,
                    ease: "power2.out",
                    overwrite: "auto",
                });
            }
        }
    };

    useLayoutEffect(() => {
        updateLinePosition();
    }, [activeIndex]);

    useEffect(() => {
        window.addEventListener('resize', updateLinePosition);
        const timer = setTimeout(updateLinePosition, 50);
        return () => {
            window.removeEventListener('resize', updateLinePosition);
            clearTimeout(timer);
        };
    }, [activeIndex]);

    return (
        <>
        {isMobile && (
            <div
                ref={overlayRef}
                className="fixed inset-0 bg-void-900/70 z-40 hidden backdrop-blur-md"
                aria-hidden="true"
                onClick={onClose}
            />
        )}
        <aside
            aria-label="Primary Navigation"
            ref={sidebarRef}
            className={`w-[260px] h-screen shrink-0 border-r border-black/[0.05] dark:border-white/[0.04] bg-[#F5F3EF]/60 dark:bg-void-900 flex flex-col justify-between py-8 z-50 ${isMobile ? 'fixed left-0 top-0 -translate-x-full opacity-0 shadow-2xl bg-[#F5F3EF] dark:bg-void-900' : 'relative'}`}
        >
            {/* Animated SVG Spline — signal jade to warm ember */}
            <svg
                aria-hidden="true"
                className="absolute left-[0px] top-[0] w-[40px] h-full pointer-events-none drop-shadow-[0_0_10px_rgba(0,224,160,0.5)]"
                viewBox="0 0 40 800"
                fill="none"
                preserveAspectRatio="none"
            >
                <path
                    ref={lineRef}
                    d="M0,0 C10,0 24,0 24,0 C24,0 10,0 0,800"
                    stroke="url(#sidebar-gradient)"
                    strokeWidth="3"
                    strokeLinecap="round"
                />
                <defs>
                    <linearGradient id="sidebar-gradient" x1="0" y1="0" x2="0" y2="800" gradientUnits="userSpaceOnUse">
                        <stop offset="0%" stopColor="#00E0A0" stopOpacity="0" />
                        <stop offset="25%" stopColor="#00E0A0" />
                        <stop offset="65%" stopColor="#33FFB8" />
                        <stop offset="85%" stopColor="#FFB800" stopOpacity="0.6" />
                        <stop offset="100%" stopColor="#FFB800" stopOpacity="0" />
                    </linearGradient>
                </defs>
            </svg>

            {/* Logo */}
            <a href="/" className="px-7 mb-10 flex items-center gap-3 group cursor-pointer relative z-10 w-fit focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 rounded-xl">
                <div aria-hidden="true" className="w-9 h-9 rounded-2xl bg-void-900 dark:bg-[#F9F8F4] p-[1px] shadow-[0_0_16px_rgba(0,224,160,0.2)] group-hover:shadow-[0_0_24px_rgba(0,224,160,0.35)] transition-shadow duration-500">
                    <div className="w-full h-full bg-[#F9F8F4] dark:bg-void-900 rounded-[14px] flex items-center justify-center">
                        <div className="w-4 h-4 rounded-full bg-void-900 dark:bg-[#F9F8F4] relative">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-signal-500 group-hover:scale-[2] transition-transform duration-500 ease-out shadow-[0_0_6px_rgba(0,224,160,0.8)]" />
                        </div>
                    </div>
                </div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex flex-col leading-none font-display">
                    Jules <span className="text-[9px] uppercase font-bold font-mono tracking-[0.2em] text-signal-500 mt-1 opacity-90">Agent OS</span>
                </h1>
            </a>

            {/* Navigation */}
            <nav ref={navRef} className="flex-1 px-4 flex flex-col relative z-10">
                <h2 className="px-4 text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.16em] mb-3">Workspace</h2>
                {navItems.map((item, idx) => {
                    const isActive = activeIndex === idx;
                    return (
                        <Link
                            key={item.label}
                            to={item.path}
                            aria-current={isActive ? "page" : undefined}
                            className="relative flex items-center gap-3.5 px-5 py-3 min-h-[44px] rounded-2xl transition-colors duration-200 w-full text-left group overflow-hidden mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 decoration-none"
                        >
                            <div className={`absolute inset-0 rounded-2xl transition-all duration-300 pointer-events-none origin-left ${isActive ? 'bg-signal-500/[0.10] dark:bg-signal-500/[0.10] opacity-100 translate-x-0' : 'bg-black/[0.05] dark:bg-white/[0.05] opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100'}`} />
                            <div className={`absolute inset-0 rounded-2xl pointer-events-none transition-all duration-300 ${isActive ? 'shadow-[inset_0_0_0_1px_rgba(0,224,160,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(0,224,160,0.1)]' : 'shadow-none'}`} />

                            {/* Vertical Accent Indicator */}
                            {isActive && (
                                <div className="absolute left-0 top-1/2 -translate-y-1/2 h-2/3 w-1 bg-signal-500 rounded-r-full shadow-[0_0_8px_rgba(0,224,160,0.6)]" />
                            )}

                            <item.icon aria-hidden="true" className={`relative z-10 w-4 h-4 transition-all duration-300 ${isActive ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`} strokeWidth={isActive ? 2 : 1.5} />

                            <span className={`relative z-10 font-medium text-sm tracking-wide transition-colors duration-300 ${isActive ? 'text-slate-900 dark:text-white font-semibold' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                                {item.label}
                            </span>
                        </Link>
                    );
                })}
            </nav>

            {/* Settings */}
            <div className="px-4 relative z-10">
                <Link to="/config" aria-label="Settings" className="relative w-full flex items-center gap-3.5 px-5 py-3 min-h-[44px] rounded-2xl transition-colors duration-200 text-left group overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 decoration-none">
                    <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-all duration-300 pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100" />
                    <Settings aria-hidden="true" className="relative z-10 w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 group-hover:rotate-90 transition-all duration-700 ease-in-out" strokeWidth={1.5} />
                    <span className="relative z-10 font-medium text-sm tracking-wide text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300">Settings</span>
                </Link>
            </div>

            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#F5F3EF] dark:from-void-900 to-transparent pointer-events-none z-0" />
        </aside>
        </>
    );
};
