import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
    Bot, Plus, Brain, Check, X, Pencil, ArrowRight,
    Activity, PauseCircle, Clock, Zap,
} from "lucide-preact";
import { Link } from "@tanstack/react-router";
import { WaveFluid } from "./components/ui/WaveFluid.js";
import { BorderTrace } from "./components/ui/BorderTrace.js";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type AgentStatus = 'active' | 'idle' | 'paused';

interface Agent {
    id: string;
    name: string;
    role: string;
    instruction: string;
    status: AgentStatus;
    model: string;
    projectName: string;
    memoryCount: number;
    tasksRun: number;
    lastActive: string;
}

/* ─── Mock data ──────────────────────────────────────────────────────────── */

const MOCK_AGENTS: Agent[] = [
    {
        id: 'agt-01',
        name: 'Architect',
        role: 'System Design',
        instruction: 'You are a senior software architect. Evaluate code for architectural patterns, scalability concerns, and adherence to SOLID principles. Always prioritise maintainability, extensibility, and performance. Flag any tight coupling or violation of the separation of concerns principle.',
        status: 'active',
        model: 'claude-opus-4-6',
        projectName: 'jules-cli',
        memoryCount: 24,
        tasksRun: 142,
        lastActive: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    },
    {
        id: 'agt-02',
        name: 'Debugger',
        role: 'Root Cause Analysis',
        instruction: 'Specialise in tracing execution paths and root cause analysis. Identify race conditions, null pointer exceptions, and state corruption. Produce minimal reproducible test cases for every confirmed bug.',
        status: 'active',
        model: 'claude-sonnet-4-6',
        projectName: 'auth-service',
        memoryCount: 41,
        tasksRun: 287,
        lastActive: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    },
    {
        id: 'agt-03',
        name: 'Reviewer',
        role: 'Code Quality',
        instruction: 'Conduct thorough code reviews focusing on security vulnerabilities, performance bottlenecks, and code clarity. Provide actionable feedback with specific line references and concrete improvement suggestions.',
        status: 'idle',
        model: 'claude-sonnet-4-6',
        projectName: 'payment-gateway',
        memoryCount: 17,
        tasksRun: 98,
        lastActive: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    },
    {
        id: 'agt-04',
        name: 'Planner',
        role: 'Sprint Strategy',
        instruction: 'Break down complex features into actionable sprint tasks. Estimate complexity using T-shirt sizing, identify dependency chains, and surface potential blockers before implementation begins. Keep task scope tight.',
        status: 'idle',
        model: 'claude-haiku-4-5',
        projectName: 'user-dashboard',
        memoryCount: 9,
        tasksRun: 55,
        lastActive: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
    },
    {
        id: 'agt-05',
        name: 'Tester',
        role: 'Quality Assurance',
        instruction: 'Generate comprehensive test suites including unit, integration, and edge case tests. Achieve above 90% code coverage. Prioritise testing critical user paths and payment flows above all else.',
        status: 'paused',
        model: 'claude-haiku-4-5',
        projectName: 'email-templates',
        memoryCount: 6,
        tasksRun: 33,
        lastActive: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    },
];

/* ─── Status config ──────────────────────────────────────────────────────── */

const STATUS_CFG = {
    active: {
        label:    'Active',
        hex:      '#00E0A0',
        icon:     Activity,
        dot:      'bg-status-green shadow-[0_0_10px_rgba(0,171,132,0.7)] animate-pulse',
        ring:     'border-signal-500/50 shadow-[0_0_28px_rgba(0,224,160,0.35)]',
        blobBg:   'bg-signal-500/[0.15] dark:bg-signal-500/[0.2]',
        text:     'text-signal-500',
        tint:     'group-hover:bg-signal-500/[0.025]',
    },
    idle: {
        label:    'Idle',
        hex:      '#FFB800',
        icon:     Clock,
        dot:      'bg-status-amber shadow-[0_0_8px_rgba(245,158,11,0.5)]',
        ring:     'border-ember-500/50 shadow-[0_0_24px_rgba(255,184,0,0.3)]',
        blobBg:   'bg-ember-500/[0.12] dark:bg-ember-500/[0.18]',
        text:     'text-ember-500',
        tint:     'group-hover:bg-ember-500/[0.025]',
    },
    paused: {
        label:    'Paused',
        hex:      '#64748b',
        icon:     PauseCircle,
        dot:      'bg-slate-400',
        ring:     '',
        blobBg:   'bg-slate-400/[0.08] dark:bg-slate-500/[0.12]',
        text:     'text-slate-400',
        tint:     '',
    },
} as const;

const timeAgo = (iso: string) => {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
};

/* ─── Agent Card ─────────────────────────────────────────────────────────── */

const AgentCard: FunctionComponent<{
    agent: Agent;
    onUpdate: (id: string, instruction: string) => void;
}> = ({ agent, onUpdate }) => {
    const cardRef   = useRef<HTMLDivElement>(null);
    const cfg       = STATUS_CFG[agent.status];
    const anim      = agent.id.charCodeAt(5) % 2 === 1 ? 'animate-organic' : 'animate-organic-reverse';
    const [editing, setEditing]   = useState(false);
    const [draft, setDraft]       = useState(agent.instruction);

    /* 3-D tilt on mouse move */
    const handleMouseMove = (e: MouseEvent) => {
        const el = cardRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width  - 0.5);   // −0.5 … +0.5
        const y = ((e.clientY - r.top)  / r.height - 0.5);
        gsap.to(el, {
            rotationY:         x * 14,
            rotationX:        -y * 10,
            z:                  20,
            transformPerspective: 1000,
            duration: 0.45,
            ease: "power2.out",
            overwrite: "auto",
        });
    };

    const handleMouseLeave = () => {
        const el = cardRef.current;
        if (!el) return;
        gsap.to(el, {
            rotationY: 0,
            rotationX: 0,
            z: 0,
            transformPerspective: 1000,
            duration: 0.9,
            ease: "elastic.out(1, 0.5)",
            overwrite: "auto",
        });
    };

    const handleSave = () => {
        onUpdate(agent.id, draft);
        setEditing(false);
    };

    const handleCancel = () => {
        setDraft(agent.instruction);
        setEditing(false);
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
                       rounded-[1.75rem] p-7
                       shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]
                       overflow-hidden cursor-default"
            style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}
        >
            {/* Ghost letter watermark */}
            <div
                aria-hidden
                className="absolute -right-5 -bottom-10 font-black font-display
                           text-[11rem] leading-none tracking-tighter
                           text-black/[0.025] dark:text-white/[0.02]
                           pointer-events-none select-none"
            >
                {agent.name[0]}
            </div>

            {/* Hover tint */}
            <div className={`absolute inset-0 pointer-events-none transition-colors duration-300 ${cfg.tint}`} />

            {/* Wave + border trace */}
            <WaveFluid accentHex={cfg.hex} />
            <BorderTrace accentHex={cfg.hex} />

            {/* ── Header ──────────────────────────────────────────── */}
            <div className="flex items-start gap-4 mb-7 relative z-10">
                {/* Organic avatar blob */}
                <div className="relative w-[60px] h-[60px] shrink-0">
                    {/* Shadow underlay */}
                    <div className={`absolute inset-0 shadow-[0_12px_32px_rgba(0,0,0,0.07)] dark:shadow-[0_12px_32px_rgba(0,0,0,0.4)] pointer-events-none ${anim}`} />
                    {/* Liquid body */}
                    <div
                        className={`absolute inset-0 ${cfg.blobBg} backdrop-blur-xl overflow-hidden transform-gpu ${anim}`}
                        style={{ WebkitMaskImage: '-webkit-radial-gradient(white, black)', backfaceVisibility: 'hidden' }}
                    >
                        {/* Inset gloss */}
                        <div className={`absolute inset-0 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${anim}`} />
                        {/* Status ring */}
                        {cfg.ring && (
                            <div
                                className={`absolute inset-0 border-2 animate-[spin_6s_linear_infinite] scale-105 pointer-events-none mix-blend-screen ${cfg.ring}`}
                                style={{ borderRadius: '40% 60% 70% 30% / 40% 50% 60% 50%', clipPath: 'inset(-10px)' }}
                            />
                        )}
                        {/* Initial letter */}
                        <div className="absolute inset-0 flex items-center justify-center">
                            <span className={`text-2xl font-black font-display ${cfg.text} opacity-80`}>
                                {agent.name[0]}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Name + role + model */}
                <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-xl font-black font-display tracking-tight text-slate-900 dark:text-white leading-tight">
                        {agent.name}
                    </h3>
                    <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 mt-0.5">
                        {agent.role}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                        <span className="text-[9px] font-mono text-slate-400 uppercase tracking-[0.1em]">
                            {cfg.label}
                        </span>
                        <span className="text-slate-200 dark:text-slate-700 text-[9px]">·</span>
                        <span className="text-[9px] font-mono text-slate-400">{agent.model}</span>
                    </div>
                </div>
            </div>

            {/* ── Stats row ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-2 mb-6 relative z-10">
                {[
                    { label: 'Tasks run', value: agent.tasksRun },
                    { label: 'Memories',  value: agent.memoryCount },
                ].map(({ label, value }) => (
                    <div
                        key={label}
                        className="flex flex-col items-center py-3 rounded-[1rem]
                                   bg-black/[0.03] dark:bg-white/[0.03]
                                   border border-black/[0.04] dark:border-white/[0.04]"
                    >
                        <span className="text-[1.5rem] font-black font-mono text-slate-900 dark:text-white leading-none">
                            {value}
                        </span>
                        <span className="text-[8px] font-bold uppercase tracking-[0.16em] text-slate-400 mt-1.5">
                            {label}
                        </span>
                    </div>
                ))}
            </div>

            {/* ── Instruction ─────────────────────────────────────── */}
            <div className="flex-1 relative z-10 mb-6">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">
                        Instructions
                    </span>
                    {!editing && (
                        <button
                            onClick={() => setEditing(true)}
                            className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.12em]
                                       text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                                       transition-colors duration-200 group/edit"
                        >
                            <Pencil className="w-2.5 h-2.5 group-hover/edit:rotate-12 transition-transform duration-200" strokeWidth={2.5} />
                            Edit
                        </button>
                    )}
                </div>

                {editing ? (
                    <div className="flex flex-col gap-2">
                        <textarea
                            value={draft}
                            rows={5}
                            autoFocus
                            className="w-full bg-black/[0.03] dark:bg-white/[0.03]
                                       border border-signal-500/40 dark:border-signal-500/35
                                       rounded-[1rem] p-3.5
                                       text-[13px] font-mono text-slate-700 dark:text-slate-200
                                       leading-relaxed resize-none outline-none
                                       focus:ring-2 focus:ring-signal-500/10
                                       placeholder-slate-400
                                       shadow-[0_0_0_0_rgba(0,224,160,0)]
                                       focus:shadow-[0_0_20px_rgba(0,224,160,0.06)]
                                       transition-[box-shadow] duration-300"
                            onInput={(e) => setDraft(e.currentTarget.value)}
                        />
                        <div className="flex items-center gap-2 justify-end">
                            <button
                                onClick={handleCancel}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-lg
                                           text-[10px] font-bold text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                                           transition-colors duration-200"
                            >
                                <X className="w-3 h-3" strokeWidth={2.5} />
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg
                                           bg-signal-500 hover:bg-signal-400
                                           text-void-900 text-[10px] font-bold
                                           shadow-[0_0_16px_rgba(0,224,160,0.25)]
                                           hover:shadow-[0_0_24px_rgba(0,224,160,0.4)]
                                           transition-[background-color,box-shadow] duration-200"
                            >
                                <Check className="w-3 h-3" strokeWidth={2.5} />
                                Save
                            </button>
                        </div>
                    </div>
                ) : (
                    <p
                        onClick={() => setEditing(true)}
                        className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed
                                   line-clamp-4 cursor-text
                                   hover:text-slate-700 dark:hover:text-slate-300
                                   transition-colors duration-200"
                    >
                        {agent.instruction}
                    </p>
                )}
            </div>

            {/* ── Footer ──────────────────────────────────────────── */}
            <div className="flex items-center justify-between relative z-10 mt-auto pt-4
                            border-t border-black/[0.05] dark:border-white/[0.04]">
                {/* Memory link */}
                <Link
                    to="/memory"
                    className="flex items-center gap-2 group/mem"
                >
                    <div className="w-6 h-6 rounded-lg bg-ember-500/[0.08] dark:bg-ember-500/[0.12]
                                    flex items-center justify-center
                                    group-hover/mem:bg-ember-500/[0.2] transition-colors duration-200">
                        <Brain className="w-3 h-3 text-ember-500" strokeWidth={1.75} />
                    </div>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500
                                     group-hover/mem:text-ember-500 transition-colors duration-200">
                        {agent.memoryCount} memories
                    </span>
                    <ArrowRight
                        className="w-3 h-3 text-slate-300 dark:text-slate-600
                                   group-hover/mem:text-ember-500 group-hover/mem:translate-x-0.5
                                   transition-all duration-200"
                        strokeWidth={2}
                    />
                </Link>

                <span className="text-[9px] font-mono text-slate-300 dark:text-slate-700">
                    {timeAgo(agent.lastActive)}
                </span>
            </div>
        </div>
    );
};

/* ─── Add Agent Ghost Card ───────────────────────────────────────────────── */

const AddAgentCard: FunctionComponent<{ onClick: () => void }> = ({ onClick }) => (
    <button
        onClick={onClick}
        className="group relative flex flex-col items-center justify-center gap-6
                   border-2 border-dashed border-signal-500/20 hover:border-signal-500/50
                   rounded-[1.75rem] min-h-[420px]
                   transition-colors duration-500
                   hover:bg-signal-500/[0.02] cursor-pointer"
    >
        {/* Breathing glow */}
        <div
            className="absolute inset-0 rounded-[1.75rem]
                       bg-signal-500/0 group-hover:bg-signal-500/[0.03]
                       transition-colors duration-700 pointer-events-none"
        />

        {/* Organic plus icon */}
        <div
            className="relative w-20 h-20 flex items-center justify-center
                       border-2 border-dashed border-signal-500/20
                       group-hover:border-signal-500 group-hover:bg-signal-500/[0.08]
                       transition-all duration-500 animate-organic"
        >
            <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100
                           bg-signal-500/[0.06] transition-opacity duration-500
                           animate-organic-reverse"
            />
            <Bot
                className="w-8 h-8 text-signal-500/30 group-hover:text-signal-500
                           transition-colors duration-300 relative z-10"
                strokeWidth={1.5}
            />
        </div>

        <div className="flex flex-col items-center gap-2 relative z-10">
            <span className="text-sm font-black font-display tracking-tight
                             text-slate-300 dark:text-slate-600
                             group-hover:text-signal-500 transition-colors duration-300">
                Deploy Agent
            </span>
            <span className="text-[9px] font-mono text-slate-200 dark:text-slate-700
                             group-hover:text-slate-400 transition-colors duration-200">
                + new autonomous entity
            </span>
        </div>

        {/* Corner decorations */}
        {['top-4 left-4', 'top-4 right-4', 'bottom-4 left-4', 'bottom-4 right-4'].map(pos => (
            <div
                key={pos}
                className={`absolute ${pos} w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500`}
            >
                <div className="w-full h-[1px] bg-signal-500/40" />
                <div className="h-full w-[1px] bg-signal-500/40" />
            </div>
        ))}
    </button>
);

/* ─── Agents Page ────────────────────────────────────────────────────────── */

type Filter = 'All' | 'Active' | 'Idle' | 'Paused';

export const AgentsPage: FunctionComponent = () => {
    const headerRef  = useRef<HTMLDivElement>(null);
    const gridRef    = useRef<HTMLDivElement>(null);

    const [agents, setAgents]           = useState<Agent[]>(MOCK_AGENTS);
    const [activeFilter, setFilter]     = useState<Filter>('All');

    useLayoutEffect(() => {
        /* Header stagger */
        if (headerRef.current) {
            gsap.fromTo(
                Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
        /* Cards: elastic entrance from center */
        if (gridRef.current) {
            gsap.fromTo(
                Array.from(gridRef.current.children),
                { opacity: 0, y: 60, scale: 0.92 },
                {
                    opacity: 1, y: 0, scale: 1,
                    stagger: { amount: 0.55, from: "start" },
                    duration: 1.1,
                    ease: "elastic.out(1, 0.7)",
                    delay: 0.25,
                },
            );
        }
    }, []);

    const handleUpdate = (id: string, instruction: string) => {
        setAgents(prev => prev.map(a => a.id === id ? { ...a, instruction } : a));
    };

    const filterMap: Record<Filter, AgentStatus | null> = {
        All: null, Active: 'active', Idle: 'idle', Paused: 'paused',
    };
    const filtered = activeFilter === 'All'
        ? agents
        : agents.filter(a => a.status === filterMap[activeFilter]);

    const counts: Record<Filter, number> = {
        All:    agents.length,
        Active: agents.filter(a => a.status === 'active').length,
        Idle:   agents.filter(a => a.status === 'idle').length,
        Paused: agents.filter(a => a.status === 'paused').length,
    };

    return (
        <div className="max-w-[1920px] mx-auto px-8 md:px-20 py-24 flex flex-col gap-16 relative z-10">

            {/* ── Ambient glows ────────────────────────────────────── */}
            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_-5%_-10%,rgba(0,224,160,0.05)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_70%_50%_at_-5%_-10%,rgba(0,224,160,0.07)_0%,transparent_60%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.03)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_110%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
            </div>

            {/* ── Page header ───────────────────────────────────────── */}
            <div ref={headerRef} className="flex items-end justify-between gap-8">
                <div className="flex flex-col gap-5">
                    {/* Eyebrow */}
                    <div className="flex items-center gap-2.5 text-signal-500 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <Zap className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Autonomous Agents
                    </div>

                    {/* Hero headline with ghost watermark */}
                    <div className="relative overflow-hidden">
                        <h2
                            aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none"
                        >
                            AGNT
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            Active <br />
                            <span className="text-signal-500">Agents.</span>
                        </h1>
                    </div>

                    <p className="text-lg text-slate-500 dark:text-slate-500 font-medium max-w-xl mt-1 leading-relaxed">
                        Autonomous AI entities with persistent memory and editable instructions. Each agent operates within its assigned project context.
                    </p>
                </div>

                {/* Right: status summary + CTA */}
                <div className="flex flex-col items-end gap-4 shrink-0">
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full
                                       bg-signal-500/[0.08] border border-signal-500/20
                                       text-[10px] font-bold uppercase tracking-widest text-signal-600 dark:text-signal-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 relative">
                                <span className="absolute inset-0 rounded-full animate-ping bg-signal-400 opacity-70" />
                            </span>
                            {counts.Active} Active
                        </div>
                        <div className="flex items-center gap-2 px-4 py-2 rounded-full
                                       bg-black/[0.04] dark:bg-white/[0.04]
                                       border border-black/[0.06] dark:border-white/[0.06]
                                       text-[10px] font-bold uppercase tracking-widest text-slate-500">
                            <Bot className="w-3 h-3" strokeWidth={2} />
                            {counts.All} Total
                        </div>
                    </div>

                    <button className="group flex items-center gap-2.5 px-6 py-3.5
                                      bg-signal-500 hover:bg-signal-400 text-void-900
                                      font-bold text-sm rounded-2xl
                                      shadow-[0_4px_20px_rgba(0,224,160,0.25)]
                                      hover:shadow-[0_8px_32px_rgba(0,224,160,0.45)]
                                      hover:-translate-y-px
                                      transition-[background-color,box-shadow,transform] duration-300">
                        <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" strokeWidth={2.5} />
                        Deploy Agent
                    </button>
                </div>
            </div>

            {/* ── Filter strip ──────────────────────────────────────── */}
            <div className="-mt-4 flex gap-1 p-1 bg-black/[0.04] dark:bg-white/[0.04] rounded-xl w-fit">
                {(['All', 'Active', 'Idle', 'Paused'] as Filter[]).map(f => (
                    <button
                        key={f}
                        onClick={() => setFilter(f)}
                        className={`text-xs font-semibold tracking-wide px-4 py-1.5 rounded-lg
                                   transition-all duration-200 flex items-center gap-2
                                   ${activeFilter === f
                                       ? 'bg-white dark:bg-void-700 text-slate-900 dark:text-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
                                       : 'text-slate-500 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                                   }`}
                    >
                        {f}
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md
                            ${activeFilter === f
                                ? 'bg-signal-500/[0.12] text-signal-600 dark:text-signal-400'
                                : 'bg-black/[0.06] dark:bg-white/[0.06] text-slate-400'
                            }`}>
                            {counts[f]}
                        </span>
                    </button>
                ))}
            </div>

            {/* ── Cards grid ────────────────────────────────────────── */}
            <div
                ref={gridRef}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
            >
                {filtered.map(agent => (
                    <AgentCard
                        key={agent.id}
                        agent={agent}
                        onUpdate={handleUpdate}
                    />
                ))}
                <AddAgentCard onClick={() => {}} />
            </div>
        </div>
    );
};
