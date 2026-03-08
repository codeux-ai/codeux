import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useMemo } from "preact/hooks";
import gsap from "gsap";
import { Link } from "@tanstack/react-router";
import {
    ListChecks, ChevronDown, CheckCircle2, Circle, PlayCircle,
    Clock, FolderGit2, AlertTriangle, ArrowUpRight, Flame,
    Target, Play, Square, Settings, Maximize2,
} from "lucide-preact";
import { mockTasks, mockSprints } from "./lib/mockData.js";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";
import type { Task, TaskStatus, TaskPriority } from "./types.js";

/* ─── Priority config ──────────────────────────────────────────────────── */

const PRIORITY_CFG: Record<TaskPriority, { label: string; color: string; dot: string; bg: string }> = {
    critical: { label: 'Critical', color: 'text-status-red',    dot: 'bg-status-red shadow-[0_0_8px_rgba(227,0,15,0.6)]',     bg: 'bg-status-red/[0.08] border-status-red/20' },
    high:     { label: 'High',     color: 'text-ember-500',     dot: 'bg-ember-500 shadow-[0_0_8px_rgba(255,184,0,0.5)]',      bg: 'bg-ember-500/[0.08] border-ember-500/20' },
    medium:   { label: 'Medium',   color: 'text-signal-500',    dot: 'bg-signal-500 shadow-[0_0_6px_rgba(0,224,160,0.4)]',     bg: 'bg-signal-500/[0.06] border-signal-500/15' },
    low:      { label: 'Low',      color: 'text-slate-400',     dot: 'bg-slate-400',                                            bg: 'bg-slate-400/[0.06] border-slate-400/15' },
};

const STATUS_CFG: Record<TaskStatus, { label: string; color: string; hex: string; icon: any }> = {
    pending:     { label: 'Queued',      color: 'text-slate-400 dark:text-slate-500', hex: '#64748b', icon: Circle },
    in_progress: { label: 'In Progress', color: 'text-signal-500',                    hex: '#00E0A0', icon: PlayCircle },
    completed:   { label: 'Completed',   color: 'text-status-green',                  hex: '#00AB84', icon: CheckCircle2 },
};

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'completed'];

type StatusFilter = 'all' | TaskStatus;
type PriorityFilter = 'all' | TaskPriority;

const timeAgo = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

/* ─── Task Card (Kanban) ────────────────────────────────────────────────── */

const TaskCard: FunctionComponent<{ task: Task }> = ({ task }) => {
    const cardRef = useRef<HTMLDivElement>(null);
    const pri = PRIORITY_CFG[task.priority];

    const handleMouseMove = (e: MouseEvent) => {
        const el = cardRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width - 0.5);
        const y = ((e.clientY - r.top) / r.height - 0.5);
        gsap.to(el, {
            rotationY: x * 10,
            rotationX: -y * 8,
            z: 12,
            transformPerspective: 800,
            duration: 0.4,
            ease: "power2.out",
            overwrite: "auto",
        });
    };

    const handleMouseLeave = () => {
        const el = cardRef.current;
        if (!el) return;
        gsap.to(el, {
            rotationY: 0, rotationX: 0, z: 0,
            transformPerspective: 800,
            duration: 0.8,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
    };

    return (
        <div
            ref={cardRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            className="group relative flex flex-col
                       bg-white/70 dark:bg-void-800/60
                       backdrop-blur-2xl
                       border border-black/[0.06] dark:border-white/[0.06]
                       rounded-[1.25rem] p-5
                       shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
                       overflow-hidden cursor-default"
            style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
            {/* Hover tint */}
            <div className="absolute inset-0 pointer-events-none transition-colors duration-300 group-hover:bg-signal-500/[0.02]" />

            {/* Wave + trace */}
            <WaveFluid accentHex={STATUS_CFG[task.status].hex} />
            <BorderTrace accentHex={STATUS_CFG[task.status].hex} />

            {/* Header: ID + Priority */}
            <div className="flex items-center justify-between mb-3 relative z-10">
                <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-[0.1em]">
                    {task.id.toUpperCase()}
                </span>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-widest ${pri.bg} ${pri.color}`}>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pri.dot}`} />
                    {pri.label}
                </div>
            </div>

            {/* Title */}
            <h4 className={`text-[15px] font-bold tracking-tight leading-snug mb-4 relative z-10 group-hover:translate-x-0.5 transition-transform duration-300
                ${task.status === 'completed' ? 'text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-700' : 'text-slate-900 dark:text-white'}`}>
                {task.title}
            </h4>

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-auto relative z-10">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                    <FolderGit2 className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors" strokeWidth={2} />
                    <span className="font-mono truncate max-w-[100px]">{task.source}</span>
                </div>

                <span className="text-slate-200 dark:text-slate-700 text-[9px]">·</span>

                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                    <div className={`w-6 h-6 rounded-lg flex items-center justify-center
                        bg-black/[0.03] dark:bg-white/[0.03]`}>
                        <span className="text-[9px] font-black font-display text-slate-500 dark:text-slate-400">
                            {task.assignee[0]}
                        </span>
                    </div>
                    <span className="font-medium">{task.assignee}</span>
                </div>
            </div>

            {/* Footer: time */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-black/[0.04] dark:border-white/[0.04] relative z-10">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-300 dark:text-slate-600">
                    <Clock className="w-3 h-3" strokeWidth={2} />
                    <span className="font-mono">{task.time === '--' ? 'Not started' : task.time}</span>
                </div>
                <span className="text-[9px] font-mono text-slate-300 dark:text-slate-700">
                    {timeAgo(task.createdAt)}
                </span>
            </div>

            {/* Quick actions on hover */}
            <div className="absolute top-3 right-3 flex items-center gap-1 p-1
                            bg-white/90 dark:bg-void-700/95 backdrop-blur-md rounded-full
                            shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]
                            border border-black/[0.05] dark:border-white/[0.08]
                            translate-y-[-8px] opacity-0 group-hover:translate-y-0 group-hover:opacity-100
                            transition-all duration-300 ease-[cubic-bezier(0.175,0.885,0.32,1.275)] z-20">
                <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-signal-600 dark:hover:text-signal-400 rounded-full transition-colors" title="Play/Stop">
                    {task.status === 'in_progress' ? <Square className="w-3 h-3" fill="currentColor" /> : <Play className="w-3 h-3" fill="currentColor" />}
                </button>
                <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-full transition-colors" title="Configure">
                    <Settings className="w-3 h-3" />
                </button>
                <button className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-status-green rounded-full transition-colors" title="Expand">
                    <Maximize2 className="w-3 h-3" />
                </button>
            </div>
        </div>
    );
};

/* ─── Column Header ─────────────────────────────────────────────────────── */

const ColumnHeader: FunctionComponent<{ status: TaskStatus; count: number }> = ({ status, count }) => {
    const cfg = STATUS_CFG[status];
    const Icon = cfg.icon;
    return (
        <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2.5">
                {status === 'in_progress' ? (
                    <div className="relative flex items-center justify-center w-5 h-5">
                        <div className="absolute inset-0 rounded-full bg-signal-500 animate-[spin_3s_linear_infinite] opacity-30 shadow-[0_0_10px_rgba(0,224,160,0.6)] pointer-events-none"
                             style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-2px)' }} />
                        <Icon className={`w-5 h-5 ${cfg.color} relative z-10`} strokeWidth={2} />
                    </div>
                ) : (
                    <Icon className={`w-5 h-5 ${cfg.color}`} strokeWidth={2} />
                )}
                <span className={`text-sm font-bold tracking-tight ${cfg.color}`}>{cfg.label}</span>
            </div>
            <span className={`text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg
                bg-black/[0.04] dark:bg-white/[0.04] ${cfg.color}`}>
                {count}
            </span>
        </div>
    );
};

/* ─── Sprint Selector Dropdown ──────────────────────────────────────────── */

const SprintSelector: FunctionComponent<{
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}> = ({ selectedId, onSelect }) => {
    const [open, setOpen] = useState(false);
    const dropRef = useRef<HTMLDivElement>(null);
    const selected = selectedId ? mockSprints.find(s => s.id === selectedId) : null;

    const handleToggle = () => setOpen(!open);
    const handleSelect = (id: string | null) => {
        onSelect(id);
        setOpen(false);
    };

    return (
        <div className="relative" ref={dropRef}>
            <button
                onClick={handleToggle}
                className={`group flex items-center gap-3 px-5 py-3 rounded-2xl border
                    transition-all duration-300
                    ${selected
                        ? 'bg-ember-500/[0.06] dark:bg-ember-500/[0.08] border-ember-500/20 dark:border-ember-500/25 shadow-[0_0_20px_rgba(255,184,0,0.06)]'
                        : 'bg-black/[0.03] dark:bg-white/[0.03] border-black/[0.06] dark:border-white/[0.06]'
                    }
                    hover:border-ember-500/40 dark:hover:border-ember-500/40`}
            >
                <Target className={`w-4 h-4 ${selected ? 'text-ember-500' : 'text-slate-400'} transition-colors`} strokeWidth={2} />
                <span className={`text-sm font-bold tracking-tight ${selected ? 'text-ember-600 dark:text-ember-400' : 'text-slate-600 dark:text-slate-400'}`}>
                    {selected ? selected.name : 'All Sprints'}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} strokeWidth={2} />
            </button>

            {open && (
                <div className="absolute left-0 top-full mt-2 w-80 z-50
                                bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl
                                border border-black/[0.06] dark:border-white/[0.08]
                                rounded-2xl
                                shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)]
                                overflow-hidden">
                    {/* All sprints option */}
                    <button
                        onClick={() => handleSelect(null)}
                        className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200
                            ${!selectedId
                                ? 'bg-signal-500/[0.06] dark:bg-signal-500/[0.08]'
                                : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                            }`}
                    >
                        <ListChecks className="w-4 h-4 text-signal-500" strokeWidth={2} />
                        <div className="flex-1">
                            <span className="text-sm font-bold text-slate-800 dark:text-white">All Sprints</span>
                        </div>
                        <span className="text-[10px] font-mono text-slate-400">{mockTasks.length} tasks</span>
                    </button>

                    <div className="h-px bg-black/[0.04] dark:bg-white/[0.04]" />

                    {mockSprints.map((sprint) => {
                        const count = mockTasks.filter(t => t.sprintId === sprint.id).length;
                        const isActive = selectedId === sprint.id;
                        return (
                            <button
                                key={sprint.id}
                                onClick={() => handleSelect(sprint.id)}
                                className={`w-full flex items-center gap-3 px-5 py-3.5 text-left transition-colors duration-200
                                    ${isActive
                                        ? 'bg-ember-500/[0.06] dark:bg-ember-500/[0.08]'
                                        : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.03]'
                                    }`}
                            >
                                <div className={`w-2 h-2 rounded-full shrink-0 ${
                                    sprint.status === 'running' ? 'bg-status-green shadow-[0_0_8px_rgba(0,171,132,0.6)] animate-pulse' :
                                    sprint.status === 'completed' ? 'bg-signal-500' :
                                    'bg-slate-400 dark:bg-slate-600'
                                }`} />
                                <div className="flex-1 min-w-0">
                                    <span className={`text-sm font-bold tracking-tight ${isActive ? 'text-ember-600 dark:text-ember-400' : 'text-slate-800 dark:text-white'}`}>
                                        {sprint.name}
                                    </span>
                                    <div className="flex items-center gap-2 mt-0.5">
                                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.id.toUpperCase()}</span>
                                        <span className="text-slate-200 dark:text-slate-700 text-[9px]">·</span>
                                        <span className="text-[9px] text-slate-400">{sprint.date}</span>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-0.5">
                                    <span className="text-[10px] font-mono font-bold text-slate-500">{count}</span>
                                    {/* Mini progress bar */}
                                    <div className="w-12 h-1 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                                        <div
                                            className="h-full rounded-full bg-signal-500 transition-all duration-500"
                                            style={{ width: `${sprint.completion}%` }}
                                        />
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

/* ─── Sprint Progress Card ──────────────────────────────────────────────── */

const SprintProgressCard: FunctionComponent<{ sprintId: string; tasks: Task[] }> = ({ sprintId, tasks }) => {
    const sprint = mockSprints.find(s => s.id === sprintId);
    if (!sprint) return null;

    const completed = tasks.filter(t => t.status === 'completed').length;
    const inProgress = tasks.filter(t => t.status === 'in_progress').length;
    const pending = tasks.filter(t => t.status === 'pending').length;
    const total = tasks.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
        <div className="relative overflow-hidden bg-white/70 dark:bg-void-800/60
                        backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06]
                        rounded-[1.75rem] p-7
                        shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            {/* Ghost watermark */}
            <div aria-hidden className="absolute -right-4 -bottom-6 text-[6rem] font-black tracking-tighter
                                        text-black/[0.025] dark:text-white/[0.02] pointer-events-none select-none font-display leading-none">
                {pct}%
            </div>

            <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-ember-500/[0.1] dark:bg-ember-500/[0.15]
                                flex items-center justify-center">
                    <Target className="w-5 h-5 text-ember-500" strokeWidth={2} />
                </div>
                <div>
                    <h3 className="text-lg font-black font-display tracking-tight text-slate-900 dark:text-white">{sprint.name}</h3>
                    <p className="text-[10px] font-mono text-slate-400 uppercase tracking-[0.1em]">{sprint.id.toUpperCase()} · {sprint.date}</p>
                </div>
            </div>

            {/* Progress bar — segmented */}
            <div className="flex gap-1 h-2.5 rounded-full overflow-hidden mb-5">
                {completed > 0 && (
                    <div className="bg-status-green rounded-full transition-all duration-700"
                         style={{ width: `${(completed / total) * 100}%` }} />
                )}
                {inProgress > 0 && (
                    <div className="bg-signal-500 rounded-full transition-all duration-700 relative overflow-hidden"
                         style={{ width: `${(inProgress / total) * 100}%` }}>
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_2s_infinite]" />
                    </div>
                )}
                {pending > 0 && (
                    <div className="bg-slate-200 dark:bg-slate-700 rounded-full transition-all duration-700"
                         style={{ width: `${(pending / total) * 100}%` }} />
                )}
            </div>

            {/* Stat pills */}
            <div className="grid grid-cols-3 gap-2">
                {[
                    { label: 'Completed', value: completed, color: 'text-status-green' },
                    { label: 'Running',   value: inProgress, color: 'text-signal-500' },
                    { label: 'Queued',     value: pending,    color: 'text-slate-400' },
                ].map(({ label, value, color }) => (
                    <div key={label} className="flex flex-col items-center py-2.5 rounded-xl
                                                 bg-black/[0.03] dark:bg-white/[0.03]
                                                 border border-black/[0.04] dark:border-white/[0.04]">
                        <span className={`text-xl font-black font-mono leading-none ${color}`}>{value}</span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-1">{label}</span>
                    </div>
                ))}
            </div>

            {/* Link back to sprints */}
            <Link
                to="/sprints"
                className="flex items-center gap-1.5 mt-5 pt-4
                           border-t border-black/[0.05] dark:border-white/[0.04]
                           text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400
                           hover:text-ember-500 transition-colors duration-200 group/link"
            >
                <ArrowUpRight className="w-3 h-3 group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 transition-transform duration-200" strokeWidth={2.5} />
                View Sprint
            </Link>
        </div>
    );
};

/* ─── Tasks Page ────────────────────────────────────────────────────────── */

export const TasksPage: FunctionComponent = () => {
    const headerRef = useRef<HTMLDivElement>(null);
    const boardRef  = useRef<HTMLDivElement>(null);

    // Read sprint filter from URL search params
    const urlParams = new URLSearchParams(window.location.search);
    const initialSprint = urlParams.get('sprint');

    const [selectedSprint, setSelectedSprint]     = useState<string | null>(initialSprint);
    const [statusFilter, setStatusFilter]         = useState<StatusFilter>('all');
    const [priorityFilter, setPriorityFilter]     = useState<PriorityFilter>('all');

    /* GSAP entrance */
    useLayoutEffect(() => {
        if (headerRef.current) {
            gsap.fromTo(
                Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
    }, []);

    useLayoutEffect(() => {
        if (boardRef.current) {
            gsap.fromTo(
                Array.from(boardRef.current.children),
                { opacity: 0, y: 50, scale: 0.95 },
                {
                    opacity: 1, y: 0, scale: 1,
                    stagger: { amount: 0.4, from: "start" },
                    duration: 1,
                    ease: "elastic.out(1, 0.7)",
                    delay: 0.2,
                },
            );
        }
    }, [selectedSprint, statusFilter, priorityFilter]);

    /* Filtering */
    const filtered = useMemo(() => {
        return mockTasks.filter(task => {
            if (selectedSprint && task.sprintId !== selectedSprint) return false;
            if (statusFilter !== 'all' && task.status !== statusFilter) return false;
            if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
            return true;
        });
    }, [selectedSprint, statusFilter, priorityFilter]);

    /* Group by status for kanban columns — hide empty columns when a status filter is active */
    const columns = useMemo(() => {
        const all = STATUS_ORDER.map(status => ({
            status,
            tasks: filtered.filter(t => t.status === status),
        }));
        if (statusFilter !== 'all') return all.filter(col => col.tasks.length > 0);
        return all;
    }, [filtered, statusFilter]);

    /* Stats */
    const stats = useMemo(() => ({
        total:      filtered.length,
        inProgress: filtered.filter(t => t.status === 'in_progress').length,
        completed:  filtered.filter(t => t.status === 'completed').length,
        critical:   filtered.filter(t => t.priority === 'critical').length,
    }), [filtered]);

    return (
        <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">

            {/* ── Page header ───────────────────────────────────────── */}
            <div ref={headerRef} className="flex flex-col lg:flex-row lg:items-end justify-between gap-8">
                <div className="flex flex-col gap-5">
                    {/* Eyebrow */}
                    <div className="flex items-center gap-2.5 text-signal-500 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <ListChecks className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Task Pipeline
                    </div>

                    {/* Hero headline with ghost watermark */}
                    <div className="relative overflow-hidden">
                        <h2
                            aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none"
                        >
                            FLOW
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            Task <br />
                            <span className="text-signal-500">Board.</span>
                        </h1>
                    </div>

                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                        Kanban pipeline view across sprint iterations. Filter by sprint, status, or priority to focus your execution stream.
                    </p>
                </div>

                {/* Right: stats summary */}
                <div className="flex flex-col items-start lg:items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                        {stats.inProgress > 0 && (
                            <div className="flex items-center gap-2 px-4 py-2 rounded-full
                                           bg-signal-500/[0.08] border border-signal-500/20
                                           text-[10px] font-bold uppercase tracking-widest text-signal-600 dark:text-signal-400">
                                <span className="w-1.5 h-1.5 rounded-full bg-signal-500 relative">
                                    <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-70" />
                                </span>
                                {stats.inProgress} Running
                            </div>
                        )}
                        {stats.critical > 0 && (
                            <div className="flex items-center gap-2 px-4 py-2 rounded-full
                                           bg-status-red/[0.06] border border-status-red/20
                                           text-[10px] font-bold uppercase tracking-widest text-status-red">
                                <Flame className="w-3 h-3" strokeWidth={2.5} />
                                {stats.critical} Critical
                            </div>
                        )}
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full
                                       bg-black/[0.04] dark:bg-white/[0.04]
                                       border border-black/[0.06] dark:border-white/[0.06]
                                       text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <ListChecks className="w-3 h-3" strokeWidth={2} />
                            {stats.total} Total
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Filters bar ────────────────────────────────────────── */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 -mt-4">
                {/* Sprint selector */}
                <SprintSelector selectedId={selectedSprint} onSelect={setSelectedSprint} />

                {/* Status filter strip */}
                <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
                    {([
                        { key: 'all' as StatusFilter, label: 'All' },
                        { key: 'in_progress' as StatusFilter, label: 'Running' },
                        { key: 'pending' as StatusFilter, label: 'Queued' },
                        { key: 'completed' as StatusFilter, label: 'Done' },
                    ]).map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setStatusFilter(key)}
                            className={`text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200
                                ${statusFilter === key
                                    ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                    : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {/* Priority filter strip */}
                <div className="flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl">
                    {([
                        { key: 'all' as PriorityFilter, label: 'Any Priority' },
                        { key: 'critical' as PriorityFilter, label: 'Critical' },
                        { key: 'high' as PriorityFilter, label: 'High' },
                        { key: 'medium' as PriorityFilter, label: 'Medium' },
                        { key: 'low' as PriorityFilter, label: 'Low' },
                    ]).map(({ key, label }) => (
                        <button
                            key={key}
                            onClick={() => setPriorityFilter(key)}
                            className={`text-xs font-semibold tracking-wide px-3 py-1.5 rounded-lg transition-all duration-200
                                ${priorityFilter === key
                                    ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                    : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Sprint progress card (when a sprint is selected) ──── */}
            {selectedSprint && (
                <div className="-mt-6">
                    <SprintProgressCard sprintId={selectedSprint} tasks={filtered} />
                </div>
            )}

            {/* ── Kanban board ────────────────────────────────────────── */}
            <div ref={boardRef} className={`grid gap-6 ${
                columns.length === 1 ? 'grid-cols-1' :
                columns.length === 2 ? 'grid-cols-1 lg:grid-cols-2' :
                'grid-cols-1 lg:grid-cols-3'
            }`}>
                {columns.map(({ status, tasks: colTasks }) => (
                    <div key={status} className="flex flex-col">
                        <ColumnHeader status={status} count={colTasks.length} />

                        {/* Column body with subtle background */}
                        <div className={`flex-1 flex flex-col gap-4 p-4 rounded-[1.5rem] min-h-[200px]
                            bg-black/[0.015] dark:bg-white/[0.015]
                            border border-black/[0.03] dark:border-white/[0.03]`}>
                            {colTasks.length === 0 ? (
                                <div className="flex-1 flex items-center justify-center">
                                    <span className="text-xs font-medium text-slate-300 dark:text-slate-700">No tasks</span>
                                </div>
                            ) : (
                                colTasks.map(task => <TaskCard key={task.id} task={task} />)
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
