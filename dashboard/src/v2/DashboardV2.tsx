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
import { PageHeader } from "./components/layout/PageHeader.js";
import { Hexagon } from "lucide-preact";

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
        <PageContainer containerRef={mainContentRef} padding="overview" className="gap-10 md:gap-14" aria-label="Dashboard Overview">
            {/* Page Header */}
            <PageHeader
                icon={Hexagon}
                eyebrow="Mission Control"
                title="Overview"
                subtitle="Real-time metrics and operational intelligence across your cluster."
                actions={
                    <div role="status" aria-live="polite" aria-label="Status: Cluster Optimal" className="px-4 md:px-5 py-2 md:py-2.5 text-[10px] md:text-xs font-bold uppercase tracking-[0.14em] rounded-full bg-signal-500/8 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border border-signal-500/15 dark:border-signal-500/20 flex items-center gap-2.5 shadow-[0_0_14px_rgba(0,224,160,0.06)] backdrop-blur-md">
                        <span aria-hidden="true" className="w-2 h-2 rounded-full bg-signal-500 relative">
                            <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-60" />
                        </span>
                        Cluster Optimal
                    </div>
                }
            />

            {/* Metrics Section */}
            <section aria-label="Overview metrics" className="w-full relative z-20">
                <HeaderStats pageData={pageData} />
            </section>

            {/* Section Divider */}
            <SectionDivider label="Data Streams" className="py-1 md:py-2" />

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-10 xl:gap-8 2xl:gap-10 flex-grow relative z-20 items-start">
                {/* Sources and Tasks */}
                <div className="xl:col-span-8 flex flex-col gap-10 md:gap-12">
                    <section aria-label="Project sources" className="w-full relative">
                        <SourcesGrid />
                    </section>

                    <section aria-label="Active task streams" className="w-full relative">
                        <TasksList pageData={pageData} />
                    </section>
                </div>

                {/* Live Telemetry */}
                <aside aria-label="Live telemetry rail" className="xl:col-span-4 h-full relative order-last xl:order-none">
                    <Suspense fallback={<SkeletonPanel />}>
                        <OverviewTelemetry />
                    </Suspense>
                </aside>
            </div>
        </PageContainer>
    );
};
