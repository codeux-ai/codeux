import type { FunctionComponent } from "preact";
import { useRef, useEffect, useState, useLayoutEffect, useCallback } from "preact/hooks";
import { Link, useRouterState } from "@tanstack/react-router";
import { MessageCircle, Hexagon, Layers, ListChecks, Zap, Settings, Inbox, Cpu, BarChart3, Compass, CalendarDays } from "lucide-preact";
import gsap from "gsap";
import { useProjectData } from "../context/project-data.js";
import { useProjectEffectiveSettings } from "../hooks/use-project-effective-settings.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

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
    { icon: CalendarDays, label: "Schedule", path: "/scheduler", color: "text-sky-500" },
    { icon: Inbox,    label: "Memory",   path: "/memory",  color: "text-ember-400"  },
    { icon: Compass,  label: "Browser",  path: "/browser", color: "text-sky-500"    },
    { icon: Zap,      label: "Live",     path: "/live",    color: "text-status-red" },
    { icon: Settings, label: "Config",   path: "/config",  color: "text-slate-400 dark:text-slate-400" },
] as const;

type DockItem = (typeof LEFT_ITEMS)[number] | (typeof RIGHT_ITEMS)[number];

const DockItemIcon: FunctionComponent<{ item: DockItem; isActive: boolean }> = ({ item, isActive }) => {
    return (
        <div className="relative w-full h-full flex items-center justify-center">
            {/*
              JS handles the hover magnetic fisheye effect via pointer events on the container.
              We still keep static active/focus transformations on the inner icon to avoid conflict with GSAP container.
            */}
            <div className="dock-item-icon-wrapper">
                <item.icon
                    className={`w-5 h-5 relative z-10 transition-all duration-300 ease-out group-focus-visible:-translate-y-1.5 group-focus-visible:scale-[1.15] group-active:-translate-y-1.5 group-active:scale-[1.15]
                        ${isActive
                            ? item.color
                            : 'text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200 group-focus-visible:text-slate-700 dark:group-focus-visible:text-slate-200'
                        }`}
                    strokeWidth={isActive ? 2 : 1.5}
                />
            </div>
        </div>
    );
};

export const KineticDock: FunctionComponent = () => {
    const dockRef    = useRef<HTMLDivElement>(null);
    const itemRefs   = useRef<(HTMLAnchorElement | null)[]>([]);
    const [indicatorState, setIndicatorState] = useState({ left: 22, initialized: false });
    const indicatorRef = useRef<HTMLDivElement>(null);
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
    const updateIndicatorPosition = useCallback(() => {
        const el = itemRefs.current[activeIndex];
        if (!el || !dockRef.current) return;

        // Use offsetLeft to make calculation transformation-invariant (GSAP scaling won't affect it)
        const center = el.offsetLeft + (el.offsetWidth / 2);
        setIndicatorState({ left: center - 14, initialized: true });
    }, [activeIndex]);

    /* Entrance */
    useEffect(() => {
        if (dockRef.current) {
            if (prefersReducedMotion) {
                gsap.set(dockRef.current, { y: 0, opacity: 1, scale: 1 });
            } else {
                gsap.fromTo(dockRef.current,
                    { y: 100, opacity: 0, scale: 0.8 },
                    { y: 0, opacity: 1, scale: 1, duration: 1.4, ease: "elastic.out(1, 0.7)", delay: 0.2 },
                );
            }
        }
    }, [prefersReducedMotion]);

    /* Magnetic hover implementation */
    const handlePointerMove = useCallback((e: PointerEvent) => {
        if (prefersReducedMotion || !dockRef.current) return;

        const bounds = dockRef.current.getBoundingClientRect();
        // Calculate relative mouse position
        const mouseX = e.clientX;

        // Iterate over all items to compute distance from mouse and apply scale/translation
        itemRefs.current.forEach((el) => {
            if (!el) return;
            const itemBounds = el.getBoundingClientRect();
            const itemCenterX = itemBounds.left + (itemBounds.width / 2);
            const distance = Math.abs(mouseX - itemCenterX);

            // Fisheye logic: items within 100px get affected
            const maxDistance = 150;
            if (distance < maxDistance) {
                // Calculate scale (1.0 to 1.3)
                const scale = Math.min(1.2, 1 + (0.3 * (1 - (distance / maxDistance))));
                // Calculate Y translation (-12px to 0)
                const translateY = -12 * ((scale - 1) / 0.2); // proportional to scale change

                const iconWrapper = el.querySelector('.dock-item-icon-wrapper');
                if (iconWrapper) {
                    gsap.to(iconWrapper, {
                        scale,
                        y: translateY,
                        duration: 0.35,
                        ease: "power4.out",
                        overwrite: "auto"
                    });
                }
            } else {
                // Reset items out of range
                const iconWrapper = el.querySelector('.dock-item-icon-wrapper');
                if (iconWrapper) {
                    gsap.to(iconWrapper, {
                        scale: 1,
                        y: 0,
                        duration: 0.35,
                        ease: "power4.out",
                        overwrite: "auto"
                    });
                }
            }
        });
    }, [prefersReducedMotion]);

    const handlePointerLeave = useCallback(() => {
        if (prefersReducedMotion) return;

        itemRefs.current.forEach((el) => {
            if (!el) return;
            const iconWrapper = el.querySelector('.dock-item-icon-wrapper');
            if (iconWrapper) {
                gsap.to(iconWrapper, {
                    scale: 1,
                    y: 0,
                    duration: 0.35,
                    ease: "power4.out",
                    overwrite: "auto",
                    clearProps: "transform"
                });
            }
        });
    }, [prefersReducedMotion]);


    /* Active indicator — DOM-based so the divider doesn't break the math */
    useLayoutEffect(() => {
        updateIndicatorPosition();
    }, [updateIndicatorPosition]);




    useEffect(() => {
        window.addEventListener('resize', updateIndicatorPosition);
        // Also run once after a small delay to handle font loading/layout stabilization
        const timer = setTimeout(updateIndicatorPosition, 50);

        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => {
            updateIndicatorPosition();
        }) : null;
        if (observer && dockRef.current) {
            observer.observe(dockRef.current);
        }

        return () => {
            window.removeEventListener('resize', updateIndicatorPosition);
            if (observer) observer.disconnect();
            clearTimeout(timer);
        };
    }, [updateIndicatorPosition]);

    const renderItem = (item: DockItem, globalIndex: number) => {
        const isActive = activeIndex === globalIndex;
        return (
            <Link
                key={item.label}
                to={item.path}
                ref={(el: HTMLAnchorElement | null) => { itemRefs.current[globalIndex] = el; }}
                data-tour-id={`nav-${item.label.toLowerCase()}`}
                className="relative group flex flex-col items-center justify-center w-[52px] h-[52px] rounded-[1.4rem] transition-colors duration-300 decoration-none"
            >
                <div className="absolute inset-0 bg-transparent group-hover:bg-black/[0.04] dark:group-hover:bg-white/[0.05] group-focus-visible:bg-black/[0.04] dark:group-focus-visible:bg-white/[0.05] rounded-[1.4rem] pointer-events-none transition-colors duration-300" />

                <DockItemIcon item={item} isActive={isActive} />

                {/* Tooltip */}
                <span className="absolute -top-11 px-2.5 py-1
                                 bg-void-900/95 dark:bg-white/95
                                 text-white dark:text-void-900
                                 text-[11px] font-bold tracking-wide rounded-xl
                                 opacity-0 scale-75
                                 group-hover:opacity-100 group-hover:scale-100
                                 group-focus-visible:opacity-100 group-focus-visible:scale-100
                                 -translate-y-1 group-hover:-translate-y-0 group-focus-visible:-translate-y-0
                                 pointer-events-none
                                 transition-all duration-200 ease-out
                                 shadow-xl backdrop-blur-md whitespace-nowrap">
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
                onPointerMove={handlePointerMove}
                onPointerLeave={handlePointerLeave}
                data-glass
                className="relative pointer-events-auto flex items-center gap-1.5 p-2.5
                           bg-white/90 dark:bg-void-800/90 backdrop-blur-xl
                           border border-black/[0.06] dark:border-white/[0.08]
                           rounded-[2rem] max-w-full overflow-x-auto scrollbar-hide
                           shadow-[0_20px_50px_rgba(0,0,0,0.08)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.5)]
                           before:absolute before:inset-0 before:rounded-[2rem]
                           before:shadow-[inset_0_1px_1px_rgba(255,255,255,0.6)] dark:before:shadow-[inset_0_1px_1px_rgba(255,255,255,0.06)]"
            >
                {/* Active Signal Indicator */}
                <div
                    ref={indicatorRef}
                    style={{ left: `${indicatorState.left}px` }}
                    className={`absolute bottom-2 h-[3px] w-7 rounded-full
                               bg-signal-500 shadow-[0_0_12px_rgba(0,224,160,0.8)]
                               transition-[left,opacity] duration-[400ms] ease-[cubic-bezier(0.175,0.885,0.32,1.275)]
                               ${indicatorState.initialized ? "opacity-100" : "opacity-0"}`}

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
