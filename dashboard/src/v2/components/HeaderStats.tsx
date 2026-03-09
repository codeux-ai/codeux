import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { mockStats } from "../lib/mockData.js";
import { MetricCard } from "./ui/MetricCard.js";
import { Sparkline } from "./ui/Sparkline.js";

export const HeaderStats: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (containerRef.current) {
            gsap.fromTo(
                containerRef.current.children,
                { y: 24, opacity: 0, scale: 0.97 },
                { y: 0, opacity: 1, scale: 1, duration: 0.9, stagger: 0.12, ease: "power3.out", delay: 0.15 }
            );
        }
    }, []);

    const formatTokens = (n: number) => (n / 1_000_000).toFixed(1) + "M";

    return (
        <div ref={containerRef} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">

            {/* Card 1: Daily Tokens */}
            <MetricCard hoverTint="group-hover:bg-signal-500/[0.025]" accentHex="#00E0A0">
                <Sparkline points={[20, 30, 25, 45, 60, 50, 80]} color="#00E0A0" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-signal-600 dark:group-hover:text-signal-400 transition-colors">Daily Tokens</h3>
                    <div className="w-2 h-2 rounded-full bg-signal-500 shadow-[0_0_10px_rgba(0,224,160,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {formatTokens(mockStats.dailyTokens)}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">IN</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTokens(mockStats.dailyTokens * 0.4)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OUT</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTokens(mockStats.dailyTokens * 0.6)}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 2: Weekly Volume */}
            <MetricCard hoverTint="group-hover:bg-ember-500/[0.025]" accentHex="#FFB800">
                <Sparkline points={[60, 50, 55, 45, 60, 40, 50]} color="#FFB800" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-ember-600 dark:group-hover:text-ember-400 transition-colors">Weekly Volume</h3>
                    <div className="w-2 h-2 rounded-full bg-ember-500 shadow-[0_0_10px_rgba(255,184,0,0.6)]" />
                </div>
                <div className="relative z-10">
                    <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">
                        {formatTokens(mockStats.weeklyTokens)}
                    </span>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">IN</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTokens(mockStats.weeklyTokens * 0.42)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OUT</span>
                            <span className="text-slate-700 dark:text-slate-300">{formatTokens(mockStats.weeklyTokens * 0.58)}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 3: Succeeded Jobs */}
            <MetricCard hoverTint="group-hover:bg-status-green/[0.04]" accentHex="#00AB84">
                <Sparkline points={[60, 75, 80, 85, 95, 90, 110]} color="#00AB84" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-status-green transition-colors">Succeeded Jobs</h3>
                    <div className="w-2 h-2 rounded-full bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">6,842</span>
                        <span className="text-status-green text-xs font-bold font-mono">{mockStats.successRate}%</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-black/[0.06] dark:border-white/[0.06] pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">DAILY</span>
                            <span className="text-slate-700 dark:text-slate-300">{mockStats.dailySuccess.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">WEEKLY</span>
                            <span className="text-slate-700 dark:text-slate-300">{mockStats.weeklySuccess.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

            {/* Card 4: Failed Jobs */}
            <MetricCard hoverTint="group-hover:bg-status-red/[0.03]" accentHex="#E3000F">
                <Sparkline points={[5, 2, 8, 4, 12, 10, 15]} color="#E3000F" />
                <div className="relative z-10 flex items-center justify-between mb-6">
                    <h3 className="text-slate-500 dark:text-slate-500 font-medium text-xs tracking-widest uppercase group-hover:text-status-red transition-colors">Failed Jobs</h3>
                    <div className="relative w-2 h-2">
                        <div className="w-full h-full rounded-full bg-status-red relative z-10 shadow-[0_0_10px_rgba(227,0,15,0.7)]" />
                        <div className="absolute inset-0 bg-status-red rounded-full animate-ping opacity-60" />
                    </div>
                </div>
                <div className="relative z-10">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-[2.25rem] font-semibold font-mono text-slate-900 dark:text-white tracking-tighter">{mockStats.failedJobs}</span>
                        <span className="text-status-red text-xs font-bold font-mono">{(100 - mockStats.successRate).toFixed(1)}%</span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-status-red/10 pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">DAILY</span>
                            <span className="text-slate-700 dark:text-slate-300">{mockStats.dailyFailed}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">WEEKLY</span>
                            <span className="text-slate-700 dark:text-slate-300">{mockStats.weeklyFailed}</span>
                        </div>
                    </div>
                </div>
            </MetricCard>

        </div>
    );
};
