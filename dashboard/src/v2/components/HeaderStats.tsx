import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { mockStats } from "../lib/mockData.js";

// Mini Sparkline Chart Component using GSAP
const Sparkline = ({ points, color }: { points: number[], color: string }) => {
    const pathRef = useRef<SVGPathElement>(null);

    useEffect(() => {
        if (pathRef.current) {
            const length = pathRef.current.getTotalLength();
            gsap.set(pathRef.current, { strokeDasharray: length, strokeDashoffset: length });
            gsap.to(pathRef.current, { strokeDashoffset: 0, duration: 1.5, ease: "power3.inOut", delay: 0.5 });
        }
    }, [points]);

    const max = Math.max(...points);
    const min = Math.min(...points);
    const range = max - min || 1;
    const pathD = points.map((p, i) => {
        const x = (i / (points.length - 1)) * 100;
        const y = 100 - ((p - min) / range) * 80; // Leaving some padding
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');

    return (
        <svg className="absolute bottom-0 left-0 w-full h-24 opacity-20 pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path ref={pathRef} d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

            {/* Soft gradient fill below the line */}
            <path d={`${pathD} L 100 100 L 0 100 Z`} fill={`url(#gradient-${color})`} />
            <defs>
                <linearGradient id={`gradient-${color}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                    <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
            </defs>
        </svg>
    );
};

export const HeaderStats: FunctionComponent = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (containerRef.current) {
            gsap.fromTo(
                containerRef.current.children,
                { y: 30, opacity: 0, scale: 0.95 },
                {
                    y: 0,
                    opacity: 1,
                    scale: 1,
                    duration: 1,
                    stagger: 0.15,
                    ease: "elastic.out(1, 0.8)",
                    delay: 0.2
                }
            );
        }
    }, []);

    const formatTokens = (tokens: number) => {
        return (tokens / 1000000).toFixed(1) + "M";
    };

    return (
        <div
            ref={containerRef}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 w-full"
        >
            {/* Elegant Metric Card: Daily Tokens */}
            <div className="relative overflow-hidden bg-white/60 dark:bg-black/40 backdrop-blur-3xl border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col justify-between group">
                <div className="absolute inset-0 bg-transparent group-hover:bg-indigo-50/30 dark:group-hover:bg-indigo-500/[0.02] transition-colors duration-500 pointer-events-none" />
                <Sparkline points={[20, 30, 25, 45, 60, 50, 80]} color="#6366f1" />
                <div className="relative z-10 flex items-center justify-between mb-8">
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium text-sm tracking-wide group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">Daily Tokens</h3>
                    <div className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_12px_#6366f1]" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-baseline gap-3 mb-1">
                        <span className="text-4xl font-semibold font-mono text-slate-900 dark:text-white tracking-tighter group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-all">
                            {formatTokens(mockStats.dailyTokens)}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-slate-200 dark:border-white/10 pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">IN</span>
                            <span className="text-slate-900 dark:text-white">{formatTokens(mockStats.dailyTokens * 0.4)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OUT</span>
                            <span className="text-slate-900 dark:text-white">{formatTokens(mockStats.dailyTokens * 0.6)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Elegant Metric Card: Weekly Volume */}
            <div className="relative overflow-hidden bg-white/60 dark:bg-black/40 backdrop-blur-3xl border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col justify-between group">
                <div className="absolute inset-0 bg-transparent group-hover:bg-purple-50/30 dark:group-hover:bg-purple-500/[0.02] transition-colors duration-500 pointer-events-none" />
                <Sparkline points={[60, 50, 55, 45, 60, 40, 50]} color="#a855f7" />
                <div className="relative z-10 flex items-center justify-between mb-8">
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium text-sm tracking-wide group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">Weekly Volume</h3>
                    <div className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_12px_#a855f7]" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-baseline gap-3 mb-1">
                        <span className="text-4xl font-semibold font-mono text-slate-900 dark:text-white tracking-tighter group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-all">
                            {formatTokens(mockStats.weeklyTokens)}
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-slate-200 dark:border-white/10 pt-4">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">IN</span>
                            <span className="text-slate-900 dark:text-white">{formatTokens(mockStats.weeklyTokens * 0.42)}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">OUT</span>
                            <span className="text-slate-900 dark:text-white">{formatTokens(mockStats.weeklyTokens * 0.58)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Avant-Garde Metric Card: Succeeded Jobs */}
            <div className="relative overflow-hidden bg-white/60 dark:bg-black/40 backdrop-blur-3xl border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col justify-between group">
                <div className="absolute inset-0 bg-transparent group-hover:bg-[#00AB84]/5 transition-colors duration-500 pointer-events-none" />
                <Sparkline points={[60, 75, 80, 85, 95, 90, 110]} color="#00AB84" />
                <div className="flex items-center justify-between mb-8 relative z-10">
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium text-sm tracking-wide group-hover:text-pantone-green transition-colors">Succeeded Jobs</h3>
                    <div className="w-2 h-2 rounded-full bg-[#00AB84] shadow-[0_0_12px_#00AB84] animate-pulse" />
                </div>
                <div className="relative z-10 flex flex-col w-full">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-4xl font-semibold font-mono text-slate-900 dark:text-white tracking-tighter group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-all">
                            6,842
                        </span>
                        <span className="text-[#00AB84] text-sm font-bold flex items-center gap-1 group-hover:drop-shadow-[0_0_8px_rgba(0,171,132,0.5)] transition-all font-mono">
                            {mockStats.successRate}% <span className="text-[10px] text-slate-400 uppercase ml-1">Success</span>
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-slate-200 dark:border-white/10 pt-4 w-full">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">DAILY</span>
                            <span className="text-slate-900 dark:text-white">{mockStats.dailySuccess.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">WEEKLY</span>
                            <span className="text-slate-900 dark:text-white">{mockStats.weeklySuccess.toLocaleString()}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Avant-Garde Metric Card: Failed Jobs */}
            <div className="relative overflow-hidden bg-white/60 dark:bg-black/40 backdrop-blur-3xl border border-slate-200 dark:border-white/10 rounded-[2rem] p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.12)] flex flex-col justify-between group cursor-pointer border-[#E3000F]/10 dark:border-[#E3000F]/20">
                <div className="absolute inset-0 bg-transparent group-hover:bg-[#E3000F]/5 transition-colors duration-500 pointer-events-none" />
                <Sparkline points={[5, 2, 8, 4, 12, 10, 15]} color="#E3000F" />
                <div className="flex items-center justify-between mb-8 relative z-10">
                    <h3 className="text-slate-500 dark:text-slate-400 font-medium text-sm tracking-wide group-hover:text-pantone-red transition-colors">Failed Jobs</h3>
                    <div className="relative">
                        <div className="w-2 h-2 rounded-full bg-[#E3000F] relative z-10 shadow-[0_0_12px_#E3000F]" />
                        <div className="absolute inset-0 bg-[#E3000F] rounded-full animate-ping opacity-75" />
                    </div>
                </div>
                <div className="relative z-10 flex flex-col w-full">
                    <div className="flex items-end justify-between mb-1">
                        <span className="text-4xl font-semibold font-mono text-slate-900 dark:text-white tracking-tighter group-hover:drop-shadow-[0_0_8px_rgba(255,255,255,0.2)] transition-all">
                            {mockStats.failedJobs}
                        </span>
                        <span className="text-[#E3000F] text-sm font-bold flex items-center gap-1 group-hover:drop-shadow-[0_0_8px_rgba(227,0,15,0.5)] transition-all font-mono">
                            {(100 - mockStats.successRate).toFixed(1)}% <span className="text-[10px] text-slate-400 uppercase ml-1">Fail</span>
                        </span>
                    </div>
                    <div className="flex flex-col gap-1 mt-4 border-t border-[#E3000F]/10 dark:border-[#E3000F]/20 pt-4 w-full">
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">DAILY</span>
                            <span className="text-slate-900 dark:text-white">{mockStats.dailyFailed}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs font-mono font-medium">
                            <span className="text-slate-400">WEEKLY</span>
                            <span className="text-slate-900 dark:text-white">{mockStats.weeklyFailed}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
