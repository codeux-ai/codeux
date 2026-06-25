import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { HeaderStats } from "./components/HeaderStats.js";
import { SourcesGrid } from "./components/SourcesGrid.js";
import { TasksList } from "./components/TasksList.js";
import { SkeletonPanel } from "./components/layout/SkeletonLoader.js";
import { useOverviewPageData } from "./hooks/use-overview-page-data.js";
import { useReducedMotion } from "./hooks/use-reduced-motion.js";
import { PageContainer } from "./components/layout/PageContainer.js";

import { SectionDivider } from "./components/ui/SectionDivider.js";

const OverviewTelemetry = lazy(() => import("./components/OverviewTelemetry.js").then(m => ({ default: m.OverviewTelemetry })));

export const DashboardV2: FunctionComponent = () => {
    const mainContentRef = useRef<HTMLElement>(null);
    const pageData = useOverviewPageData();
    const prefersReducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            if (mainContentRef.current) {
                if (prefersReducedMotion) {
                    gsap.set(mainContentRef.current.children, { opacity: 1, y: 0 });
                } else {
                    gsap.fromTo(
                        mainContentRef.current.children,
                        { opacity: 0, y: 40 },
                        { opacity: 1, y: 0, duration: 1, stagger: 0.12, ease: "power4.out", delay: 0.05 }
                    );
                }
            }
        });
        return () => ctx.revert();
    }, [prefersReducedMotion]);

    return (
        <PageContainer containerRef={mainContentRef} padding="overview" className="gap-12 md:gap-24" aria-label="Dashboard Overview">
            {/* Page Header */}
            <header className="flex flex-col md:flex-row items-start md:items-end justify-between w-full gap-6">
                <div>
                    <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-slate-900 dark:text-white mb-2 font-display leading-[0.95]">
                        Overview.
                    </h1>
                    <p className="text-sm md:text-base text-slate-500 dark:text-slate-500 font-medium max-w-xl leading-relaxed">
                        Real-time metrics and operational intelligence across your cluster.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div role="status" aria-live="polite" aria-label="Status: Cluster Optimal" className="px-4 md:px-5 py-2 md:py-2.5 text-[10px] md:text-xs font-bold uppercase tracking-[0.14em] rounded-full bg-signal-500/8 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border border-signal-500/15 dark:border-signal-500/20 flex items-center gap-2.5 shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-md">
                        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-signal-500 relative">
                            <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />
                        </span>
                        Cluster Optimal
                    </div>
                </div>
            </header>

            {/* Metrics Section */}
            <section aria-label="Metrics" className="w-full relative z-20">
                <HeaderStats pageData={pageData} />
            </section>

            {/* Section Divider */}
            <SectionDivider label="Data Streams" />

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-12 md:gap-24 flex-grow relative z-20">
                {/* Sources and Tasks */}
                <div className="xl:col-span-8 flex flex-col gap-16">
                    <section aria-label="Sources" className="w-full relative">
                        <SourcesGrid />
                    </section>

                    <section aria-label="Tasks" className="w-full relative">
                        <TasksList pageData={pageData} />
                    </section>
                </div>

                {/* Live Telemetry */}
                <aside aria-label="Live Telemetry" className="xl:col-span-4 h-full relative">
                    <Suspense fallback={<SkeletonPanel />}>
                        <OverviewTelemetry />
                    </Suspense>
                </aside>
            </div>
        </PageContainer>
    );
};
