import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useMemo } from "preact/hooks";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { Activity } from "lucide-preact";
import { SectionHeader } from "./ui/SectionHeader.js";
import { SourceCell } from "./ui/SourceCell.js";
import { SkeletonCard } from "./ui/ListSkeletons.js";
import { useProjectData } from "../context/project-data.js";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";

gsap.registerPlugin(Flip);

export const SourcesGrid: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { projects, loading: projectsLoading } = useProjectData();
    const prefersReducedMotion = useReducedMotion();
    const lastFlipState = useRef<any>(null);

    const recentSources = useMemo(() => {
        // Record state before change
        if (containerRef.current && !prefersReducedMotion) {
            lastFlipState.current = Flip.getState(containerRef.current.children);
        }

        return [...projects].sort((a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        ).slice(0, 6);
    }, [projects, prefersReducedMotion]);

    useLayoutEffect(() => {
        if (!containerRef.current) return;

        if (prefersReducedMotion) {
            gsap.set(containerRef.current.children, { y: 0, opacity: 1, scale: 1 });
            return;
        }

        if (lastFlipState.current) {
            Flip.from(lastFlipState.current, {
                duration: 0.6,
                ease: "power3.inOut",
                stagger: 0.05,
                absolute: true,
                onComplete: () => {
                    lastFlipState.current = null;
                }
            });
        } else {
            // Entrance animation if no flip state
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
    }, [recentSources, prefersReducedMotion]);

    return (
        <div className="w-full relative z-10" tabIndex={0}>
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
