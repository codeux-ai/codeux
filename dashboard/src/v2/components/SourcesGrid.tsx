import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useMemo } from "preact/hooks";
import gsap from "gsap";
import { Activity } from "lucide-preact";
import { SectionHeader } from "./ui/SectionHeader.js";
import { SourceCell } from "./ui/SourceCell.js";
import { SkeletonCard } from "./layout/SkeletonLoader.js";
import { EmptyState } from "./ui/EmptyState.js";
import { useProjectData } from "../context/project-data.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

export const SourcesGrid: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
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
                        duration: 0.72,
                        stagger: { amount: 0.24, from: "start" },
                        ease: "power3.out",
                        delay: 0.1
                    }
                );
            }
        }
    }, [prefersReducedMotion]);

    const recentSources = useMemo(() => {
        return [...projects].sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ).slice(0, 6);
    }, [projects]);

    return (
        <div className="w-full relative z-10" tabIndex={0}>
            <SectionHeader
                watermark="DATA"
                icon={<Activity className="w-5 h-5 text-signal-500" strokeWidth={2.5} />}
                title="Projects & Sources"
                className="mb-8"
            />

            <div
                ref={containerRef}
                className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 md:gap-5 w-full"
            >
                {projectsLoading ? (
                    <div className="contents" role="status" aria-live="polite" aria-label="Loading project sources">
                        <SkeletonCard />
                        <SkeletonCard />
                        <SkeletonCard />
                    </div>
                ) : recentSources.length === 0 ? (
                    <div className="col-span-full rounded-[1.5rem] border border-black/[0.06] bg-white/55 backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/45" role="status" aria-live="polite">
                        <EmptyState
                            title="No Project Sources"
                            description="Project sources appear here after a repository is connected."
                            icon={<Activity className="w-8 h-8" strokeWidth={1.5} />}
                        />
                    </div>
                ) : (
                    recentSources.map((source, index) => (
                        <SourceCell
                            key={source.id}
                            source={source}
                            isEven={index % 2 === 0}
                            animDelay={index * 0.5}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
