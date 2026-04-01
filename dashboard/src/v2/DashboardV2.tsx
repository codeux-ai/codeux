import type { FunctionComponent } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { HeaderStats } from "./components/HeaderStats.js";
import { SourcesGrid } from "./components/SourcesGrid.js";
import { TasksList } from "./components/TasksList.js";
import { SkeletonPanel } from "./components/ui/ListSkeletons.js";
import { useOverviewPageData } from "./hooks/use-overview-page-data.js";

const OverviewTelemetry = lazy(() => import("./components/OverviewTelemetry.js").then(m => ({ default: m.OverviewTelemetry })));

export const DashboardV2: FunctionComponent = () => {
    const mainContentRef = useRef<HTMLElement>(null);
    const pageData = useOverviewPageData();

    useLayoutEffect(() => {
        if (mainContentRef.current) {
            gsap.fromTo(
                mainContentRef.current.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, duration: 1, stagger: 0.12, ease: "power4.out", delay: 0.05 }
            );
        }
    }, []);

    return (
        <main ref={mainContentRef} className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-24">
            {/* Page Header */}
            <header className="flex flex-col md:flex-row items-start md:items-end justify-between w-full gap-6">
                <div>
                    <h2 className="text-5xl md:text-6xl font-black tracking-tighter text-slate-900 dark:text-white mb-4 font-display leading-[0.95]">
                        Overview.
                    </h2>
                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl leading-relaxed">
                        Real-time metrics and operational intelligence across your cluster.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div role="status" aria-label="Status: Cluster Optimal" className="px-5 py-2.5 text-xs font-bold uppercase tracking-widest rounded-full bg-signal-500/8 dark:bg-signal-500/10 text-signal-600 dark:text-signal-400 border border-signal-500/15 dark:border-signal-500/20 flex items-center gap-2.5 shadow-[0_0_20px_rgba(0,224,160,0.08)] backdrop-blur-md">
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
            <div className="w-full flex items-center justify-center py-4 relative z-10 overflow-hidden">
                <div className="absolute inset-y-1/2 inset-x-0 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
                <div className="bg-[#F9F8F4] dark:bg-void-900 px-6 py-1.5 border border-black/[0.06] dark:border-white/[0.06] rounded-full shadow-sm relative z-10 text-[9px] font-bold uppercase tracking-[0.25em] text-slate-400 dark:text-slate-600">
                    Data Streams
                </div>
            </div>

            {/* Main Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-20 flex-grow relative z-20">
                {/* Sources and Tasks */}
                <div className="xl:col-span-8 flex flex-col gap-24">
                    <section aria-label="Sources" className="w-full relative">
                        {/* Subtle signal glow — very restrained */}
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-signal-500/3 dark:bg-signal-500/5 rounded-full blur-[100px] pointer-events-none -z-10" />
                        <SourcesGrid />
                    </section>

                    <section aria-label="Tasks" className="w-full relative">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-[130%] bg-ember-500/3 dark:bg-ember-500/4 rounded-full blur-[80px] pointer-events-none -z-10" />
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
        </main>
    );
};
