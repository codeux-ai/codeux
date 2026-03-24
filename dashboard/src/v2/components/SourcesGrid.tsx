import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { Activity } from "lucide-preact";
import { SectionHeader } from "./ui/SectionHeader.js";
import { SourceCell } from "./ui/SourceCell.js";
import { SkeletonCard } from "./ui/ListSkeletons.js";
import { useProjectData } from "../context/project-data.js";

export const SourcesGrid: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { projects, loading: projectsLoading } = useProjectData();

    useLayoutEffect(() => {
        if (containerRef.current) {
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
    }, []);

    const recentSources = [...projects].sort((a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    ).slice(0, 6);

    return (
        <div className="w-full relative z-10">
            <SectionHeader
                watermark="DATA"
                icon={<Activity className="w-5 h-5 text-signal-500" strokeWidth={2.5} />}
                title="Projects & Sources"
            />

            <div
                ref={containerRef}
                className="flex flex-wrap justify-center gap-10 md:gap-14 lg:gap-20"
            >
                {projectsLoading ? (
                    <>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                        <div className="w-[18rem]"><SkeletonCard /></div>
                    </>
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
