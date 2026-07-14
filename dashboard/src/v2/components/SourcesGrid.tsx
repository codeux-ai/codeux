import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef, useMemo, useState } from "preact/hooks";
import gsap from "gsap";
import { Activity } from "lucide-preact";
import { SectionHeader } from "./ui/SectionHeader.js";
import { SourceCell } from "./ui/SourceCell.js";
import { SkeletonCard } from "./layout/SkeletonLoader.js";
import { useProjectData } from "../context/project-data.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

const DEFAULT_VISIBLE_SOURCE_CELLS = 5;
const COMPACT_VISIBLE_SOURCE_CELLS = 4;
const SOURCE_CELL_SIZE_PX = 224;
const SOURCE_CELL_GAP_PX = 24;

export interface SourcesGridLayoutPlan {
    visibleCount: number;
    columns: number;
}

export const planSourcesGridLayout = (availableColumns: number, projectCount: number): SourcesGridLayoutPlan => {
    if (projectCount <= 0) {
        return { visibleCount: 0, columns: 1 };
    }

    if (availableColumns >= 3) {
        const visibleCount = Math.min(DEFAULT_VISIBLE_SOURCE_CELLS, availableColumns, projectCount);
        return { visibleCount, columns: visibleCount };
    }

    if (projectCount === 1) {
        return { visibleCount: 1, columns: 1 };
    }

    const visibleCount = Math.min(projectCount === 3 ? 2 : COMPACT_VISIBLE_SOURCE_CELLS, projectCount);
    return { visibleCount, columns: 2 };
};

const getAvailableColumns = (width: number): number => {
    if (width <= 0) {
        return DEFAULT_VISIBLE_SOURCE_CELLS;
    }

    return Math.max(1, Math.floor((width + SOURCE_CELL_GAP_PX) / (SOURCE_CELL_SIZE_PX + SOURCE_CELL_GAP_PX)));
};

const getGridTemplateColumns = (columns: number): string => {
    const totalGap = Math.max(0, columns - 1) * SOURCE_CELL_GAP_PX;
    return `repeat(${columns}, minmax(0, min(14rem, calc((100% - ${totalGap}px) / ${columns}))))`;
};

export const SourcesGrid: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [availableColumns, setAvailableColumns] = useState(DEFAULT_VISIBLE_SOURCE_CELLS);
    const { projects, loading: projectsLoading } = useProjectData();
    const prefersReducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        if (containerRef.current) {
            if (prefersReducedMotion) {
                gsap.set(containerRef.current.children, { y: 0, opacity: 1, scale: 1 });
            } else {
                gsap.fromTo(
                    containerRef.current.children,
                    { y: 50, opacity: 0, scale: 0.9 },
                    {
                        y: 0,
                        opacity: 1,
                        scale: 1,
                        duration: 1.1,
                        stagger: { amount: 0.7, from: "center" },
                        ease: "elastic.out(1, 0.7)",
                        delay: 0.1
                    }
                );
            }
        }
    }, [prefersReducedMotion]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || typeof ResizeObserver === "undefined") {
            return;
        }

        const updateAvailableColumns = () => {
            setAvailableColumns(getAvailableColumns(container.clientWidth));
        };

        updateAvailableColumns();
        const observer = new ResizeObserver(updateAvailableColumns);
        observer.observe(container);
        return () => observer.disconnect();
    }, []);

    const layoutPlan = useMemo(
        () => planSourcesGridLayout(availableColumns, projects.length),
        [availableColumns, projects.length],
    );

    const recentSources = useMemo(() => {
        return [...projects].sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ).slice(0, layoutPlan.visibleCount);
    }, [layoutPlan.visibleCount, projects]);

    return (
        <div className="w-full relative z-10" tabIndex={0}>
            <SectionHeader
                watermark="DATA"
                icon={<Activity className="w-5 h-5 text-signal-500" strokeWidth={2.5} />}
                title="Projects & Sources"
            />

            <div
                ref={containerRef}
                className="grid w-full gap-6 overflow-visible"
                style={projectsLoading ? undefined : {
                    gridTemplateColumns: getGridTemplateColumns(layoutPlan.columns),
                    justifyContent: layoutPlan.columns === 1 ? "center" : "space-between",
                }}
                data-source-count={projectsLoading ? undefined : recentSources.length}
                data-source-columns={projectsLoading ? undefined : layoutPlan.columns}
            >
                {projectsLoading ? (
                    <>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                    </>
                ) : (
                    recentSources.map((source, index) => (
                        <div
                            key={source.id}
                            className="flex min-w-0 justify-center"
                            data-source-cell-frame
                        >
                            <SourceCell
                                source={source}
                                isEven={index % 2 === 0}
                                animDelay={index * 0.5}
                            />
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};
