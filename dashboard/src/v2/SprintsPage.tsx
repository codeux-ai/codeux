import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Target, Plus } from "lucide-preact";
import { mockSprints } from "./lib/mockData.js";
import type { Sprint } from "./types.js";
import { SprintBubble } from "./components/ui/SprintBubble.js";
import { AddSprintModal } from "./components/ui/AddSprintModal.js";

const ACCENT_CYCLE = ['text-signal-500', 'text-ember-500', 'text-status-green'] as const;

export const SprintsPage: FunctionComponent = () => {
    const mainRef      = useRef<HTMLDivElement>(null);
    const bubblesRef   = useRef<HTMLDivElement>(null);
    const [showModal, setShowModal] = useState(false);
    const [sprints, setSprints]     = useState<Sprint[]>(mockSprints);

    useLayoutEffect(() => {
        if (mainRef.current) {
            gsap.fromTo(mainRef.current.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.12, duration: 1, ease: "power4.out", delay: 0.15 }
            );
        }
    }, []);

    const nextId = `spr-${String(parseInt(sprints[sprints.length - 1]?.id.split('-')[1] ?? '45') + 1).padStart(2, '0')}`;

    const handleAddSprint = (sprint: Sprint) => {
        setSprints(prev => [...prev, sprint]);
        // Animate the new cell in
        requestAnimationFrame(() => {
            if (!bubblesRef.current) return;
            const cells = Array.from(bubblesRef.current.children);
            const newCell = cells[cells.length - 2]; // second-to-last (last is the add-cell)
            if (newCell) {
                gsap.fromTo(newCell,
                    { scale: 0.7, opacity: 0, rotation: -8 },
                    { scale: 1, opacity: 1, rotation: 0, duration: 0.8, ease: "elastic.out(1, 0.6)" }
                );
            }
        });
    };

    return (
        <>
            <div ref={mainRef} className="max-w-[1920px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-20 relative z-10">

                {/* Page Header */}
                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-2.5 text-signal-500 font-bold tracking-[0.15em] uppercase text-xs font-mono">
                            <Target className="w-4 h-4" strokeWidth={2.5} />
                            Iteration Cycles
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display">
                            Active <br />
                            <span className="text-signal-500">Sprints.</span>
                        </h1>
                        <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-2 leading-relaxed">
                            Liquid execution streams mapping your source integrations in real-time.
                        </p>
                    </div>

                    {/* New Sprint button */}
                    <button
                        onClick={() => setShowModal(true)}
                        className="group flex items-center gap-2.5 px-6 py-3.5 bg-signal-500 hover:bg-signal-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(0,224,160,0.25)] hover:shadow-[0_8px_32px_rgba(0,224,160,0.45)] hover:-translate-y-px shrink-0"
                    >
                        <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                        New Sprint
                    </button>
                </div>

                {/* Organic Sprint Bubbles */}
                <div ref={bubblesRef} className="flex flex-wrap gap-14 justify-center lg:justify-start">
                    {sprints.map((sprint, index) => (
                        <SprintBubble
                            key={sprint.id}
                            sprint={sprint}
                            isEven={index % 2 === 0}
                            accentColor={ACCENT_CYCLE[index % 3]}
                        />
                    ))}

                    {/* Ghost "Add Sprint" cell */}
                    <button
                        onClick={() => setShowModal(true)}
                        className="group relative cursor-pointer perspective-1000 flex items-center justify-center shrink-0 w-72 h-72 lg:w-80 lg:h-80"
                    >
                        {/* Morphing dashed border */}
                        <div
                            className="absolute inset-0 border-2 border-dashed border-signal-500/25 group-hover:border-signal-500/60 transition-all duration-500 animate-organic"
                            style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }}
                        />
                        {/* Subtle glow fill on hover */}
                        <div
                            className="absolute inset-0 bg-signal-500/0 group-hover:bg-signal-500/[0.04] transition-all duration-500 animate-organic-reverse"
                            style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%' }}
                        />

                        {/* Center content */}
                        <div className="relative z-10 flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-full border-2 border-dashed border-signal-500/30 group-hover:border-signal-500 group-hover:bg-signal-500/10 flex items-center justify-center transition-all duration-400">
                                <Plus className="w-6 h-6 text-signal-500/40 group-hover:text-signal-500 group-hover:scale-110 group-hover:rotate-90 transition-all duration-400" />
                            </div>
                            <div className="flex flex-col items-center gap-1">
                                <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors duration-300">
                                    New Sprint
                                </span>
                                <span className="text-[9px] font-mono text-slate-200 dark:text-slate-700 group-hover:text-slate-400 transition-colors duration-300">
                                    {nextId.toUpperCase()}
                                </span>
                            </div>
                        </div>
                    </button>
                </div>
            </div>

            {/* Modal */}
            {showModal && (
                <AddSprintModal
                    nextId={nextId}
                    onClose={() => setShowModal(false)}
                    onAdd={handleAddSprint}
                />
            )}
        </>
    );
};
