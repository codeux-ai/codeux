import type { FunctionComponent } from "preact";
import { useRef, useEffect, useState, useLayoutEffect, useCallback } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Hexagon, Layers, ListChecks, Zap, Settings, Inbox, Cpu, BarChart3, Compass } from "lucide-preact";
import gsap from "gsap";
import { useProjectData } from "../context/project-data.js";
import { useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { useMagnetic } from "../hooks/use-magnetic.js";

/* Chat sits left of the divider — the rest are standard nav */
const LEFT_ITEMS = [
    { icon: MessageCircle, label: "Chat",     path: "/chat",    color: "text-signal-400" },
] as const;

const RIGHT_ITEMS = [
    { icon: Hexagon,    label: "Overview", path: "/",        color: "text-signal-500" },
    { icon: Layers,     label: "Sprints",  path: "/sprints", color: "text-ember-500"  },
    { icon: ListChecks, label: "Tasks",    path: "/tasks",   color: "text-signal-400" },
    { icon: Cpu,        label: "Agents",   path: "/agents",  color: "text-signal-400" },
    { icon: BarChart3,  label: "Stats",    path: "/stats",   color: "text-amber-500"  },
    { icon: Inbox,    label: "Memory",   path: "/memory",  color: "text-ember-400"  },
    { icon: Compass,  label: "Browser",  path: "/browser", color: "text-sky-500"    },
    { icon: Zap,      label: "Live",     path: "/live",    color: "text-status-red" },
    { icon: Settings, label: "Config",   path: "/config",  color: "text-slate-400 dark:text-slate-400" },
] as const;

type DockItem = (typeof LEFT_ITEMS)[number] | (typeof RIGHT_ITEMS)[number];

const DockItemIcon: FunctionComponent<{ item: DockItem; isActive: boolean }> = ({ item, isActive }) => {
    const triggerRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLDivElement>(null);

    useMagnetic(triggerRef, targetRef, { maxDisplacement: 8 });

    return (
        <div ref={triggerRef} className="relative w-full h-full flex items-center justify-center">
            <div ref={targetRef} className="flex items-center justify-center">
                <item.icon
                    className={`w-5 h-5 relative z-10 transition-colors duration-300
                        ${isActive
                            ? item.color
                            : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200'
                        }`}
                    strokeWidth={isActive ? 2.5 : 1.5}
                />
            </div>
        </div>
    );
};

export const KineticDock: FunctionComponent = () => {
    const dockRef    = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLDivElement>(null);
    const itemRefs   = useRef<(HTMLAnchorElement | null)[]>([]);
    const tooltipRefs = useRef<(HTMLSpanElement | null)[]>([]);

    const { selectedProject } = useProjectData();
    const { data: effectiveSettings } = useProjectEffectiveSettings(selectedProject?.id || null);
    const browserVisible = !selectedProject || (
        (effectiveSettings?.settings.sprintPreview.enabled ?? true)
        && (effectiveSettings?.settings.sprintPreview.showInAppBrowser ?? true)
    );
    const rightItems = browserVisible ? RIGHT_ITEMS : RIGHT_ITEMS.filter((item) => item.path !== "/browser");
    const allItems = [...LEFT_ITEMS, ...rightItems];
    const prefersReducedMotion = useReducedMotion();

    const matches     = useRouterState({ select: (s) => s.matches });
    const currentPath = (matches && matches.length > 0) ? (matches[matches.length - 1]?.pathname || "/") : "/";
    const activeIndex = Math.max(0, allItems.findIndex(i => i.path === currentPath));

    /* Active indicator position update */
    const updateIndicatorPosition = useCallback((immediate = false) => {
        const el = itemRefs.current[activeIndex];
        if (!el || !dockRef.current || !indicatorRef.current) return;

        const center = el.offsetLeft + (el.offsetWidth / 2);
        const targetLeft = center - 14; // 14 = half of 28px indicator

        if (immediate || prefersReducedMotion) {
            gsap.set(indicatorRef.current, { left: targetLeft, scaleX: 1, opacity: 1 });
        } else {
            const currentLeft = parseFloat(gsap.getProperty(indicatorRef.current, "left") as string) || 0;
            const distance = Math.abs(targetLeft - currentLeft);

            // Only animate if it actually moved significantly
            if (distance > 1) {
                const stretch = Math.min(1.6, 1 + distance / 45);
                const duration = Math.min(0.6, 0.35 + distance / 400);

                const tl = gsap.timeline({ overwrite: "auto" });
                tl.to(indicatorRef.current, {
                    left: targetLeft,
                    duration: duration,
                    ease: "expo.out",
                }, 0);
                tl.to(indicatorRef.current, {
                    scaleX: stretch,
                    duration: duration * 0.4,
                    ease: "power2.out",
                }, 0);
                tl.to(indicatorRef.current, {
                    scaleX: 1,
                    duration: duration * 0.8,
                    ease: "elastic.out(1, 0.75)",
                }, duration * 0.3);
            } else {
                gsap.to(indicatorRef.current, { left: targetLeft, duration: 0.3, ease: "power2.out" });
            }
        }
    }, [activeIndex, prefersReducedMotion]);

    /* Entrance */
    useEffect(() => {
        if (dockRef.current) {
            if (prefersReducedMotion) {
                gsap.set(dockRef.current, { y: 0, opacity: 1, scale: 1 });
            } else {
                gsap.fromTo(dockRef.current,
                    { y: 100, opacity: 0, scale: 0.9 },
                    { y: 0, opacity: 1, scale: 1, duration: 1.2, ease: "expo.out", delay: 0.2 },
                );
            }
        }
    }, [prefersReducedMotion]);

    /* Active indicator update */
    useLayoutEffect(() => {
        updateIndicatorPosition();
    }, [updateIndicatorPosition]);

    useEffect(() => {
        const handleResize = () => updateIndicatorPosition(true);
        window.addEventListener('resize', handleResize);
        const timer = setTimeout(() => updateIndicatorPosition(true), 100);
        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(timer);
        };
    }, [updateIndicatorPosition]);

    /* Magnetic fisheye */
    const handleMouseMove = (e: MouseEvent) => {
        if (!dockRef.current || prefersReducedMotion) return;
        const mouseX = e.clientX;

        itemRefs.current.forEach((item) => {
            if (!item) return;
            const rect    = item.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const dist    = Math.abs(mouseX - centerX);
            const maxDist = 120;

            if (dist < maxDist) {
                const ratio = 1 - Math.pow(dist / maxDist, 1.4);
                gsap.to(item, {
                    scale: 1 + 0.38 * ratio,
                    y: -14 * ratio,
                    duration: 0.3,
                    ease: "power2.out",
                    overwrite: "auto",
                });
            } else {
                gsap.to(item, { scale: 1, y: 0, duration: 0.3, ease: "power2.out", overwrite: "auto" });
            }
        });
    };

    const handleMouseLeave = () => {
        itemRefs.current.forEach(item => {
            if (!item) return;
            gsap.to(item, { scale: 1, y: 0, duration: 0.5, ease: "back.out(1.7)", overwrite: "auto" });
        });
    };

    const handleItemMouseEnter = (index: number) => {
        const tooltip = tooltipRefs.current[index];
        if (!tooltip || prefersReducedMotion) return;

        gsap.fromTo(tooltip,
            { opacity: 0, scale: 0.5, y: 8 },
            {
                opacity: 1,
                scale: 1,
                y: 0,
                duration: 0.4,
                ease: "back.out(2.5)",
                overwrite: "auto"
            }
        );
    };

    const handleItemMouseLeave = (index: number) => {
        const tooltip = tooltipRefs.current[index];
        if (!tooltip || prefersReducedMotion) return;

        gsap.to(tooltip, {
            opacity: 0,
            scale: 0.8,
            y: 4,
            duration: 0.2,
            ease: "power2.in",
            overwrite: "auto"
        });
    };

    const renderItem = (item: DockItem, globalIndex: number) => {
        const isActive = activeIndex === globalIndex;
        return (
            <Link
                key={item.label}
                to={item.path}
                ref={(el: HTMLAnchorElement | null) => { itemRefs.current[globalIndex] = el; }}
                onMouseEnter={() => handleItemMouseEnter(globalIndex)}
                onMouseLeave={() => handleItemMouseLeave(globalIndex)}
                className="relative group flex flex-col items-center justify-center w-[52px] h-[52px] rounded-[1.4rem] transition-colors duration-300 decoration-none outline-none focus-visible:ring-2 focus-visible:ring-signal-500/50"
            >
                <div className="absolute inset-0 bg-transparent group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.05] rounded-[1.4rem] pointer-events-none transition-colors duration-300" />

                <DockItemIcon item={item} isActive={isActive} />

                {/* Tooltip */}
                <span
                    ref={(el: HTMLSpanElement | null) => { tooltipRefs.current[globalIndex] = el; }}
                    className={`absolute -top-11 px-2.5 py-1
                                 bg-void-900/95 dark:bg-white/95
                                 text-white dark:text-void-900
                                 text-[11px] font-bold tracking-wide rounded-xl
                                 pointer-events-none
                                 shadow-xl backdrop-blur-md whitespace-nowrap
                                 ${prefersReducedMotion ? 'hidden group-hover:block opacity-100 scale-100' : 'opacity-0'}`}
                >
                    {item.label}
                </span>
            </Link>
        );
    };

    return (
        <div className="fixed bottom-7 left-0 right-0 z-50 flex justify-center items-end h-28 pointer-events-none px-4">
            <nav
                aria-label="Dock navigation"
                ref={dockRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                className="relative pointer-events-auto flex items-center gap-1.5 p-2.5
                           bg-white/60 dark:bg-void-800/70 backdrop-blur-3xl
                           border border-black/[0.06] dark:border-white/[0.08]
                           rounded-[2rem] max-w-full overflow-x-auto scrollbar-hide
                           shadow-[0_20px_50px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]
                           before:absolute before:inset-0 before:rounded-[2rem]
                           before:shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)] dark:before:shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]"
            >
                {/* Active Signal Indicator */}
                <div
                    ref={indicatorRef}
                    className="absolute bottom-2 h-[3.5px] w-7 rounded-full
                               bg-signal-500 shadow-[0_0_12px_rgba(0,224,160,0.8)]
                               z-0 pointer-events-none"
                    style={{ left: `22px`, opacity: 0 }}
                />

                {/* Chat — left of divider */}
                {LEFT_ITEMS.map((item, i) => renderItem(item, i))}

                {/* Thin vertical divider */}
                <div className="w-px h-5 bg-black/[0.1] dark:bg-white/[0.1] mx-0.5 self-center shrink-0" />

                {/* Main nav items */}
                {rightItems.map((item, i) => renderItem(item, LEFT_ITEMS.length + i))}
            </nav>
        </div>
    );
};
