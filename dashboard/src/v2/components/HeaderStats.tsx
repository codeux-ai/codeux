import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { MetricCard } from "./ui/MetricCard.js";
import { Sparkline } from "./ui/Sparkline.js";
import { useProjectData } from "../context/project-data.js";
import { useProjectSprints } from "../hooks/use-project-sprints.js";
import { useProjectTasks } from "../hooks/use-project-tasks.js";
import { computeOverviewStats } from "../lib/overview-stats.js";

export const HeaderStats: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);
    const { projects, selectedProject } = useProjectData();
    const { sprints } = useProjectSprints(selectedProject?.id || null);
    const { tasks } = useProjectTasks(selectedProject?.id || null, projects, sprints);

    useLayoutEffect(() => {
        if (containerRef.current) {
            gsap.fromTo(
                containerRef.current.children,
                { y: 24, opacity: 0, scale: 0.97 },
                { y: 0, opacity: 1, scale: 1, duration: 0.9, stagger: 0.12, ease: "power3.out", delay: 0.15 }
            );
        }
    }, []);

    const stats = computeOverviewStats(projects, sprints, tasks);

    return (
        <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">

            {/* Card 1: Projects */}
            <MetricCard hoverTint="group-hover:bg-signal-500/[0.025]" accentHex="#00E0A0">
                <Sparkline points={[20, 30, 25, 45, 60, 50, 80]} color="#00E0A0" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors">Projects</h3>
                    <div className="w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {stats.totalProjects}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">RUNNING</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.runningProjects}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">SELECTED</span>
                            <span className="text-slate-700 dark:text-slate-300">{selectedProject?.name || "None"}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 2: Sprints */}
            <MetricCard hoverTint="group-hover:bg-ember-500/[0.025]" accentHex="#FFB800">
                <Sparkline points={[60, 50, 55, 45, 60, 40, 50]} color="#FFB800" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-ember-600 dark:group-hover:text-ember-400 transition-colors">Sprints</h3>
                    <div className="w-2 h-2 rounded-full bg-ember-500 shadow-[0_0_10px_rgba(255,184,0,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {stats.totalSprints}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">ACTIVE</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.activeSprints}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">COMPLETE</span>
                            <span className="text-slate-700 dark:text-slate-300">{Math.max(stats.totalSprints - stats.activeSprints, 0)}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 3: Open Tasks */}
            <MetricCard hoverTint="group-hover:bg-status-green/[0.04]" accentHex="#00AB84">
                <Sparkline points={[60, 75, 80, 85, 95, 90, 110]} color="#00AB84" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-status-green transition-colors">Open Tasks</h3>
                    <div className="w-2 h-2 rounded-full bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">{stats.openTasks}</span>
                        <span className="text-status-green text-xs font-bold font-mono">{stats.runningTasks} live</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">RUNNING</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.runningTasks}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">CRITICAL</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.criticalTasks}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 4: Completed Tasks */}
            <MetricCard hoverTint="group-hover:bg-status-red/[0.03]" accentHex="#E3000F">
                <Sparkline points={[5, 2, 8, 4, 12, 10, 15]} color="#E3000F" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-status-red transition-colors">Completed Tasks</h3>
                    <div className="relative w-2 h-2">
                        <div className="w-full h-full rounded-full bg-status-red relative z-10 shadow-[0_0_10px_rgba(227,0,15,0.7)]" />
                        <div className="absolute inset-0 bg-status-red rounded-full animate-ping opacity-60" />
                    </div>
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">{stats.completedTasks}</span>
                        <span className="text-status-red text-xs font-bold font-mono">
                            {stats.completedTasks + stats.openTasks > 0
                                ? `${Math.round((stats.completedTasks / (stats.completedTasks + stats.openTasks)) * 100)}%`
                                : "0%"}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-status-red/10 pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OPEN</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.openTasks}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">TOTAL</span>
                            <span className="text-slate-700 dark:text-slate-300">{stats.completedTasks + stats.openTasks}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

        </div>
    );
};
