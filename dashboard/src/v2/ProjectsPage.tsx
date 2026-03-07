import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { FolderOpen, Plus, Activity, AlertCircle, Clock, CheckCircle2, AlertTriangle, ExternalLink, Settings, Trash2 } from "lucide-preact";
import { mockSources } from "./lib/mockData.js";
import type { Source, SourceStatus } from "./types.js";
import { AddProjectModal } from "./components/ui/AddProjectModal.js";
import { StatusDot } from "./components/ui/StatusDot.js";

const statusMap: Record<SourceStatus, { label: string; icon: typeof Activity; color: string }> = {
    running:      { label: 'Running',      icon: Activity,      color: 'text-status-green' },
    failed:       { label: 'Failed',       icon: AlertCircle,   color: 'text-status-red'   },
    intervention: { label: 'Intervention', icon: AlertTriangle, color: 'text-status-amber'  },
    idle:         { label: 'Idle',         icon: Clock,         color: 'text-slate-400'     },
};

const timeAgo = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

const ProjectCard: FunctionComponent<{ source: Source }> = ({ source }) => {
    const { label, icon: Icon, color } = statusMap[source.status];
    const completion = source.completedTasks + source.openTasks > 0
        ? Math.round((source.completedTasks / (source.completedTasks + source.openTasks)) * 100)
        : 0;

    return (
        <div className="group relative flex flex-col bg-white/60 dark:bg-void-800/60 backdrop-blur-sm border border-black/[0.06] dark:border-white/[0.06] rounded-3xl p-6 hover:border-black/[0.12] dark:hover:border-white/[0.1] hover:shadow-[0_24px_48px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_24px_48px_rgba(0,0,0,0.4)] transition-all duration-500 overflow-hidden cursor-pointer">

            {/* Subtle hover glow */}
            <div className="absolute inset-0 bg-gradient-to-br from-ember-500/0 to-ember-500/0 group-hover:from-ember-500/[0.02] group-hover:to-transparent transition-all duration-500 rounded-3xl pointer-events-none" />

            {/* Header row */}
            <div className="flex items-start justify-between mb-4 relative z-10">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-ember-500/[0.08] dark:bg-ember-500/[0.1] flex items-center justify-center group-hover:bg-ember-500/[0.15] transition-colors duration-300">
                        <FolderOpen className="w-4.5 h-4.5 text-ember-600 dark:text-ember-400" strokeWidth={1.75} />
                    </div>
                    <div>
                        <h3 className="font-mono font-bold text-sm text-slate-900 dark:text-white tracking-tight">{source.name}</h3>
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.12em]">{source.id}</span>
                    </div>
                </div>

                <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em] ${color}`}>
                    <StatusDot status={source.status} />
                    {label}
                </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-5 relative z-10">
                {[
                    { label: 'Sprints', value: source.sprintsCount },
                    { label: 'Open', value: source.openTasks },
                    { label: 'Done', value: source.completedTasks },
                ].map(({ label: l, value }) => (
                    <div key={l} className="flex flex-col items-center py-3 rounded-2xl bg-black/[0.03] dark:bg-white/[0.03]">
                        <span className="text-xl font-black text-slate-900 dark:text-white font-mono">{value}</span>
                        <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 mt-0.5">{l}</span>
                    </div>
                ))}
            </div>

            {/* Progress bar */}
            <div className="mb-5 relative z-10">
                <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400">Completion</span>
                    <span className="text-[9px] font-mono font-bold text-slate-600 dark:text-slate-400">{completion}%</span>
                </div>
                <div className="h-1 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                        className="h-full bg-ember-500 rounded-full transition-all duration-700"
                        style={{ width: `${completion}%` }}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between relative z-10 mt-auto">
                <span className="text-[9px] font-mono text-slate-400">
                    Updated {timeAgo(source.updatedAt)}
                </span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-1 group-hover:translate-y-0">
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <ExternalLink className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08] text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">
                        <Settings className="w-3 h-3" strokeWidth={2} />
                    </button>
                    <button className="w-7 h-7 flex items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.04] hover:bg-status-red/10 text-slate-400 hover:text-status-red transition-colors">
                        <Trash2 className="w-3 h-3" strokeWidth={2} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export const ProjectsPage: FunctionComponent = () => {
    const mainRef = useRef<HTMLDivElement>(null);
    const [showModal, setShowModal] = useState(false);
    const [sources, setSources] = useState<Source[]>(mockSources);

    useLayoutEffect(() => {
        if (mainRef.current) {
            gsap.fromTo(mainRef.current.children,
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.1 }
            );
        }
    }, []);

    const handleAddProject = (project: { name: string; type: 'local' | 'git'; path: string; cloneDir?: string }) => {
        const newSource: Source = {
            id: `src-${sources.length + 1}`,
            name: project.name,
            sprintsCount: 0,
            openTasks: 0,
            completedTasks: 0,
            isRunning: false,
            status: 'idle',
            updatedAt: new Date().toISOString(),
        };
        setSources(prev => [...prev, newSource]);
    };

    const runningCount = sources.filter(s => s.status === 'running').length;

    return (
        <>
            <div ref={mainRef} className="max-w-[1920px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">

                {/* Page Header */}
                <div className="flex items-end justify-between">
                    <div className="flex flex-col gap-5">
                        <div className="flex items-center gap-2.5 text-ember-500 font-bold tracking-[0.15em] uppercase text-xs font-mono">
                            <FolderOpen className="w-4 h-4" strokeWidth={2.5} />
                            Source Repositories
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display">
                            Manage <br />
                            <span className="text-ember-500">Projects.</span>
                        </h1>
                        <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-2 leading-relaxed">
                            All connected source repositories and local directories. Monitor health, tasks, and activity.
                        </p>
                    </div>

                    <div className="flex flex-col items-end gap-4 shrink-0">
                        {/* Quick stats */}
                        <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 px-3.5 py-2 bg-status-green/[0.08] rounded-xl">
                                <CheckCircle2 className="w-3.5 h-3.5 text-status-green" strokeWidth={2} />
                                <span className="text-xs font-bold font-mono text-status-green">{runningCount} Running</span>
                            </div>
                            <div className="flex items-center gap-2 px-3.5 py-2 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
                                <FolderOpen className="w-3.5 h-3.5 text-slate-400" strokeWidth={2} />
                                <span className="text-xs font-bold font-mono text-slate-500">{sources.length} Total</span>
                            </div>
                        </div>

                        <button
                            onClick={() => setShowModal(true)}
                            className="group flex items-center gap-2.5 px-6 py-3.5 bg-ember-500 hover:bg-ember-400 text-void-900 font-bold text-sm rounded-2xl transition-all duration-300 shadow-[0_4px_20px_rgba(255,184,0,0.25)] hover:shadow-[0_8px_32px_rgba(255,184,0,0.4)] hover:-translate-y-px"
                        >
                            <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" />
                            Add Project
                        </button>
                    </div>
                </div>

                {/* Filter strip */}
                <div className="flex items-center gap-2 -mt-4">
                    {(['All', 'Running', 'Idle', 'Failed'] as const).map(f => (
                        <button
                            key={f}
                            className="px-4 py-1.5 rounded-full text-xs font-bold uppercase tracking-[0.12em] bg-black/[0.04] dark:bg-white/[0.04] text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-black/[0.08] dark:hover:bg-white/[0.08] transition-colors first:bg-ember-500/[0.1] first:text-ember-600 dark:first:text-ember-400"
                        >
                            {f}
                        </button>
                    ))}
                </div>

                {/* Project Cards Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {sources.map(source => (
                        <ProjectCard key={source.id} source={source} />
                    ))}

                    {/* Ghost add card */}
                    <button
                        onClick={() => setShowModal(true)}
                        className="group relative flex flex-col items-center justify-center gap-4 bg-transparent border-2 border-dashed border-ember-500/20 hover:border-ember-500/50 rounded-3xl p-6 min-h-[240px] transition-all duration-400 hover:bg-ember-500/[0.02] cursor-pointer"
                    >
                        <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-ember-500/25 group-hover:border-ember-500 group-hover:bg-ember-500/10 flex items-center justify-center transition-all duration-300">
                            <Plus className="w-5 h-5 text-ember-500/40 group-hover:text-ember-500 group-hover:rotate-90 transition-all duration-300" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300 dark:text-slate-600 group-hover:text-ember-500 transition-colors duration-300">Add Project</span>
                            <span className="text-[9px] font-mono text-slate-200 dark:text-slate-700 group-hover:text-slate-400 transition-colors">Local or Git</span>
                        </div>
                    </button>
                </div>
            </div>

            {showModal && (
                <AddProjectModal
                    onClose={() => setShowModal(false)}
                    onAdd={handleAddProject}
                />
            )}
        </>
    );
};
