import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Brain, X, Save, AlertTriangle, Zap, Check, RotateCcw } from "lucide-preact";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type MemCat = 'architecture' | 'codebase' | 'context' | 'preferences' | 'patterns' | 'people';

interface Memory {
    id: string;
    content: string;
    category: MemCat;
    strength: number; // 0–1 — drives line opacity + node glow
    agent: string;
    // Position on canvas — fractions of container (0–1). Center is (0.5, 0.5).
    lx: number;
    ly: number;
}

/* ─── Category visual config ─────────────────────────────────────────────── */

const CAT: Record<MemCat, { label: string; hex: string; text: string; bg: string; border: string; dot: string }> = {
    architecture: { label: 'Architecture', hex: '#00E0A0', text: 'text-signal-500',  bg: 'bg-signal-500/[0.08]',   border: 'border-signal-500/25',   dot: 'bg-signal-500'  },
    codebase:     { label: 'Codebase',     hex: '#FFB800', text: 'text-ember-500',   bg: 'bg-ember-500/[0.08]',    border: 'border-ember-500/25',    dot: 'bg-ember-500'   },
    context:      { label: 'Context',      hex: '#00AB84', text: 'text-status-green',bg: 'bg-status-green/[0.08]', border: 'border-status-green/25', dot: 'bg-status-green'},
    preferences:  { label: 'Preferences',  hex: '#94a3b8', text: 'text-slate-400',   bg: 'bg-slate-400/[0.06]',    border: 'border-slate-400/20',    dot: 'bg-slate-400'   },
    patterns:     { label: 'Patterns',     hex: '#F59E0B', text: 'text-status-amber', bg: 'bg-amber-500/[0.08]',   border: 'border-amber-500/25',    dot: 'bg-status-amber'},
    people:       { label: 'People',       hex: '#33FFB8', text: 'text-signal-300',  bg: 'bg-signal-300/[0.07]',   border: 'border-signal-300/20',   dot: 'bg-signal-300'  },
};

/* ─── Mock memories with pre-computed canvas positions ───────────────────── */
// lx, ly are fractions (0–1). Center brain = (0.5, 0.5).
// Arranged like a clock face, varying radius by strength.

const INITIAL: Memory[] = [
    { id: 'm01', lx: 0.50, ly: 0.05, category: 'people',       strength: 0.60, agent: 'Planner',   content: 'Sprint planning every Monday at 10:00 UTC with full team standup' },
    { id: 'm02', lx: 0.70, ly: 0.07, category: 'people',       strength: 0.70, agent: 'Reviewer',  content: 'Felix leads backend architecture decisions for auth-service' },
    { id: 'm03', lx: 0.86, ly: 0.22, category: 'architecture', strength: 0.90, agent: 'Architect', content: 'auth-service: JWT with 15 min expiry + refresh token rotation on every use' },
    { id: 'm04', lx: 0.92, ly: 0.50, category: 'architecture', strength: 0.75, agent: 'Architect', content: 'Payment gateway retries use exponential backoff — 3 max attempts' },
    { id: 'm05', lx: 0.85, ly: 0.76, category: 'codebase',     strength: 0.95, agent: 'Debugger',  content: 'Dashboard V2: Preact + Tailwind v4 + GSAP + TanStack Router — no React' },
    { id: 'm06', lx: 0.70, ly: 0.91, category: 'codebase',     strength: 0.65, agent: 'Debugger',  content: 'useLayoutEffect prevents animation double-pop in sprint and project modals' },
    { id: 'm07', lx: 0.50, ly: 0.96, category: 'preferences',  strength: 0.85, agent: 'Planner',   content: '2-week sprints with Monday kickoffs are the confirmed user preference' },
    { id: 'm08', lx: 0.30, ly: 0.91, category: 'preferences',  strength: 0.75, agent: 'Reviewer',  content: 'All PRs require explicit approval before merging to main branch' },
    { id: 'm09', lx: 0.14, ly: 0.76, category: 'context',      strength: 0.80, agent: 'Debugger',  content: 'payment-gateway has open Stripe webhook reliability issue — P1 priority' },
    { id: 'm10', lx: 0.07, ly: 0.50, category: 'context',      strength: 0.95, agent: 'Architect', content: 'Current sprint: Dashboard V2 avant-garde UI — completing Memory page next' },
    { id: 'm11', lx: 0.14, ly: 0.24, category: 'patterns',     strength: 0.80, agent: 'Architect', content: 'GSAP elastic.out(1, 0.7) for card entrances, power4.out for page headers' },
    { id: 'm12', lx: 0.30, ly: 0.08, category: 'patterns',     strength: 0.65, agent: 'Architect', content: 'Organic morph animation: 12s forward / 15s reverse prevents synchronisation' },
];

/* ─── Brain Core ─────────────────────────────────────────────────────────── */

const BrainCore: FunctionComponent<{ lobotomize: boolean; deletedCount: number }> = ({ lobotomize, deletedCount }) => {
    const coreRef = useRef<HTMLDivElement>(null);

    // Thud animation on each deletion
    useLayoutEffect(() => {
        if (deletedCount === 0 || !coreRef.current) return;
        gsap.timeline()
            .to(coreRef.current, { scale: 1.12, duration: 0.15, ease: "power4.out" })
            .to(coreRef.current, { scale: 1,    duration: 0.6,  ease: "elastic.out(1, 0.4)" });
    }, [deletedCount]);

    const accent = lobotomize ? 'rgba(227,0,15,' : 'rgba(0,224,160,';

    return (
        <div ref={coreRef} className="absolute inset-0 flex items-center justify-center pointer-events-none">

            {/* Ambient halo */}
            <div
                className="absolute rounded-full transition-all duration-1000"
                style={{
                    width: '320px', height: '320px',
                    background: `radial-gradient(circle, ${accent}0.06) 0%, transparent 70%)`,
                    animation: 'brain-breathe 8s ease-in-out infinite',
                }}
            />

            {/* Radar rings */}
            {[280, 220, 160].map((size, i) => (
                <div
                    key={size}
                    className="absolute rounded-full border"
                    style={{
                        width: size, height: size,
                        borderColor: lobotomize ? 'rgba(227,0,15,0.1)' : 'rgba(0,224,160,0.08)',
                        animation: `ping ${7 + i * 3}s cubic-bezier(0.1,0.5,0.8,1) infinite`,
                        animationDelay: `${i * -2}s`,
                    }}
                />
            ))}

            {/* Outer blob */}
            <div
                className="absolute animate-organic transition-[background] duration-1000"
                style={{
                    width: 160, height: 160,
                    background: lobotomize
                        ? 'rgba(227,0,15,0.07)'
                        : 'rgba(0,224,160,0.07)',
                    backdropFilter: 'blur(20px)',
                    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                }}
            />

            {/* Middle blob */}
            <div
                className="absolute animate-organic-reverse transition-[background] duration-1000"
                style={{
                    width: 108, height: 108,
                    background: lobotomize
                        ? 'rgba(227,0,15,0.14)'
                        : 'rgba(0,224,160,0.12)',
                    backdropFilter: 'blur(24px)',
                    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                    boxShadow: lobotomize
                        ? 'inset 0 0 0 1px rgba(227,0,15,0.2)'
                        : 'inset 0 0 0 1px rgba(0,224,160,0.15)',
                }}
            />

            {/* Inner blob */}
            <div
                className="absolute animate-organic transition-[background] duration-1000"
                style={{
                    width: 64, height: 64,
                    background: lobotomize
                        ? 'rgba(227,0,15,0.28)'
                        : 'rgba(0,224,160,0.22)',
                    WebkitMaskImage: '-webkit-radial-gradient(white, black)',
                }}
            />

            {/* Core dot */}
            <div className="absolute flex items-center justify-center">
                <div
                    className="w-5 h-5 rounded-full transition-[background,box-shadow] duration-700 relative"
                    style={{
                        background: lobotomize ? '#E3000F' : '#00E0A0',
                        boxShadow: lobotomize
                            ? '0 0 24px rgba(227,0,15,0.9), 0 0 48px rgba(227,0,15,0.4)'
                            : '0 0 24px rgba(0,224,160,0.9), 0 0 48px rgba(0,224,160,0.4)',
                    }}
                >
                    <div
                        className="absolute inset-0 rounded-full animate-ping"
                        style={{ background: lobotomize ? 'rgba(227,0,15,0.6)' : 'rgba(0,224,160,0.6)' }}
                    />
                </div>
            </div>

            {/* Label */}
            <div className="absolute" style={{ top: 'calc(50% + 92px)' }}>
                <span
                    className="text-[9px] font-mono font-bold uppercase tracking-[0.25em] transition-colors duration-700"
                    style={{ color: lobotomize ? 'rgba(227,0,15,0.6)' : 'rgba(0,224,160,0.6)' }}
                >
                    {lobotomize ? 'LOBOTOMIZE' : 'NEURAL CORE'}
                </span>
            </div>
        </div>
    );
};

/* ─── Connection Lines (SVG layer) ───────────────────────────────────────── */

const ConnectionLayer: FunctionComponent<{ memories: Memory[]; lobotomize: boolean }> = ({ memories, lobotomize }) => (
    <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
    >
        <defs>
            <filter id="line-glow">
                <feGaussianBlur stdDeviation="0.4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
        </defs>

        {memories.map((m, i) => {
            const cfg   = CAT[m.category];
            const color = lobotomize ? '#E3000F' : cfg.hex;
            const speed = 2.5 + (i % 5) * 0.7; // staggered pulse speed

            return (
                <g key={m.id}>
                    {/* Base static line */}
                    <line
                        x1="50" y1="50"
                        x2={m.lx * 100} y2={m.ly * 100}
                        stroke={color}
                        strokeOpacity={0.12 + m.strength * 0.12}
                        strokeWidth="0.12"
                    />
                    {/* Traveling pulse */}
                    <line
                        x1="50" y1="50"
                        x2={m.lx * 100} y2={m.ly * 100}
                        stroke={color}
                        strokeOpacity={0.6 + m.strength * 0.3}
                        strokeWidth="0.22"
                        strokeDasharray="1.2 4"
                        filter="url(#line-glow)"
                        style={{
                            animation: `dash-travel ${speed}s linear infinite`,
                            animationDelay: `${-i * 0.4}s`,
                        }}
                    />
                </g>
            );
        })}
    </svg>
);

/* ─── Memory Node ────────────────────────────────────────────────────────── */

const MemoryNode: FunctionComponent<{
    memory: Memory;
    lobotomize: boolean;
    onDelete: (id: string) => void;
    domRef: (el: HTMLDivElement | null) => void;
}> = ({ memory, lobotomize, onDelete, domRef }) => {
    const cfg = CAT[memory.category];

    return (
        <div
            ref={domRef}
            className="absolute group"
            style={{
                left: `${memory.lx * 100}%`,
                top:  `${memory.ly * 100}%`,
                transform: 'translate(-50%, -50%)',
                zIndex: 20,
            }}
        >
            <div
                className={`relative max-w-[190px] min-w-[110px] px-4 py-3 rounded-[1.25rem]
                            ${cfg.bg} backdrop-blur-xl
                            border ${cfg.border}
                            shadow-[0_4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)]
                            transition-[box-shadow,border-color] duration-300
                            ${lobotomize
                                ? 'hover:border-status-red/50 hover:shadow-[0_0_20px_rgba(227,0,15,0.15)]'
                                : 'hover:shadow-[0_8px_32px_rgba(0,0,0,0.12)] dark:hover:shadow-[0_8px_32px_rgba(0,0,0,0.5)]'
                            }
                            cursor-default select-none`}
                style={{
                    boxShadow: `0 0 ${12 + memory.strength * 12}px ${cfg.hex}${Math.round(memory.strength * 20 + 5).toString(16).padStart(2, '0')}`,
                }}
            >
                {/* Category dot */}
                <div className="flex items-center gap-1.5 mb-2">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`}
                         style={{ boxShadow: `0 0 6px ${cfg.hex}` }} />
                    <span className={`text-[8px] font-bold uppercase tracking-[0.18em] ${cfg.text}`}>
                        {cfg.label}
                    </span>
                </div>

                {/* Content */}
                <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-snug line-clamp-3 font-medium">
                    {memory.content}
                </p>

                {/* Agent badge */}
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
                    <span className="text-[8px] font-mono text-slate-400">{memory.agent}</span>
                    <div className="flex items-center gap-0.5">
                        {Array.from({ length: 5 }).map((_, i) => (
                            <div
                                key={i}
                                className="w-1 h-1 rounded-full"
                                style={{ background: i < Math.round(memory.strength * 5) ? cfg.hex : 'rgba(0,0,0,0.1)' }}
                            />
                        ))}
                    </div>
                </div>

                {/* Delete button */}
                <button
                    onClick={() => onDelete(memory.id)}
                    className={`absolute -top-2.5 -right-2.5 w-6 h-6 rounded-full
                               flex items-center justify-center
                               bg-status-red text-white
                               shadow-[0_0_12px_rgba(227,0,15,0.5)]
                               hover:shadow-[0_0_20px_rgba(227,0,15,0.8)]
                               transition-all duration-200
                               ${lobotomize
                                   ? 'opacity-100 scale-100'
                                   : 'opacity-0 scale-50 group-hover:opacity-100 group-hover:scale-100'
                               }`}
                    title="Delete memory"
                >
                    <X className="w-3 h-3" strokeWidth={2.5} />
                </button>
            </div>
        </div>
    );
};

/* ─── Memory Page ────────────────────────────────────────────────────────── */

export const MemoryPage: FunctionComponent = () => {
    const headerRef  = useRef<HTMLDivElement>(null);
    const canvasRef  = useRef<HTMLDivElement>(null);
    const nodeRefs   = useRef<Record<string, HTMLDivElement | null>>({});

    const [memories, setMemories]       = useState<Memory[]>(INITIAL);
    const [lobotomize, setLobotomize]   = useState(false);
    const [deletedCount, setDeletedCount] = useState(0);
    const [saved, setSaved]             = useState(false);
    const [isDirty, setIsDirty]         = useState(false);

    /* Entrance */
    useLayoutEffect(() => {
        if (headerRef.current) {
            gsap.fromTo(Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.08, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }
        if (canvasRef.current) {
            // Brain center scales in
            const center = canvasRef.current.querySelector('[data-brain]');
            if (center) {
                gsap.fromTo(center,
                    { scale: 0, opacity: 0 },
                    { scale: 1, opacity: 1, duration: 1.2, ease: "elastic.out(1, 0.6)", delay: 0.3 },
                );
            }
            // Nodes stagger in
            const nodes = canvasRef.current.querySelectorAll('[data-node]');
            gsap.fromTo(nodes,
                { scale: 0, opacity: 0 },
                { scale: 1, opacity: 1, stagger: { amount: 0.8, from: "random" }, duration: 0.7, ease: "back.out(2)", delay: 0.6 },
            );
        }
    }, []);

    /* Lobotomize mode: camera shake on activation */
    const handleLobotomizeToggle = () => {
        const next = !lobotomize;
        setLobotomize(next);
        if (next && canvasRef.current) {
            gsap.timeline()
                .to(canvasRef.current, { x: -6, duration: 0.06 })
                .to(canvasRef.current, { x:  6, duration: 0.06 })
                .to(canvasRef.current, { x: -4, duration: 0.05 })
                .to(canvasRef.current, { x:  4, duration: 0.05 })
                .to(canvasRef.current, { x:  0, duration: 0.06 });
        }
    };

    /* Delete a memory node with cinematic implosion */
    const handleDelete = (id: string) => {
        const el = nodeRefs.current[id];
        setIsDirty(true);

        gsap.timeline({
            onComplete: () => {
                setMemories(prev => prev.filter(m => m.id !== id));
                setDeletedCount(c => c + 1);
            },
        })
            // Shake
            .to(el, { x: -8, duration: 0.05, ease: "power4.out" })
            .to(el, { x:  8, duration: 0.05 })
            .to(el, { x: -5, duration: 0.05 })
            .to(el, { x:  5, duration: 0.05 })
            .to(el, { x:  0, duration: 0.04 })
            // Flash + implode toward brain
            .to(el, { filter: 'brightness(4) saturate(0)', duration: 0.1 })
            .to(el, {
                scale: 0,
                opacity: 0,
                x: (_, target) => {
                    const r = target.getBoundingClientRect();
                    const c = canvasRef.current!.getBoundingClientRect();
                    return (c.left + c.width  / 2) - (r.left + r.width  / 2);
                },
                y: (_, target) => {
                    const r = target.getBoundingClientRect();
                    const c = canvasRef.current!.getBoundingClientRect();
                    return (c.top  + c.height / 2) - (r.top  + r.height / 2);
                },
                duration: 0.45,
                ease: "power4.in",
            });
    };

    const handleSave = () => {
        setSaved(true);
        setIsDirty(false);
        setTimeout(() => setSaved(false), 2400);
    };

    const handleReset = () => {
        setMemories(INITIAL);
        setIsDirty(false);
        setDeletedCount(0);
        if (canvasRef.current) {
            const nodes = canvasRef.current.querySelectorAll('[data-node]');
            gsap.fromTo(nodes,
                { scale: 0, opacity: 0 },
                { scale: 1, opacity: 1, stagger: { amount: 0.5, from: "random" }, duration: 0.6, ease: "back.out(2)" },
            );
        }
    };

    return (
        <div className="max-w-[1920px] mx-auto px-8 md:px-20 py-16 flex flex-col gap-10 relative z-10">

            {/* ── Ambient glows ────────────────────────────────────── */}
            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.04)_0%,transparent_70%)]
                               dark:bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.06)_0%,transparent_70%)]
                               transition-all duration-1000" />
            </div>

            {/* ── Page header ───────────────────────────────────────── */}
            <div ref={headerRef} className="flex items-end justify-between gap-8">
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2.5 text-signal-500 font-mono text-[10px] font-bold uppercase tracking-[0.2em]">
                        <Brain className="w-3.5 h-3.5" strokeWidth={2.5} />
                        Neural Memory
                    </div>
                    <div className="relative overflow-hidden">
                        <h2 aria-hidden
                            className="absolute -top-10 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none">
                            MEM
                        </h2>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter text-slate-900 dark:text-white leading-[0.92] font-display relative z-10">
                            Memory <br />
                            <span className="text-signal-500">Map.</span>
                        </h1>
                    </div>
                    <p className="text-base text-slate-500 dark:text-slate-500 font-medium max-w-lg leading-relaxed">
                        Visualise and prune your agents' persistent memories. Connections represent semantic embeddings — stronger links glow brighter.
                    </p>
                </div>

                <div className="flex flex-col items-end gap-3.5 shrink-0">
                    {/* Stats */}
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full
                                       bg-signal-500/[0.08] border border-signal-500/20 text-[10px] font-bold font-mono text-signal-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                            {memories.length} memories
                        </div>
                        {deletedCount > 0 && (
                            <div className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                                           bg-status-red/[0.08] border border-status-red/20
                                           text-[10px] font-bold font-mono text-status-red">
                                <X className="w-3 h-3" strokeWidth={2.5} />
                                {deletedCount} pruned
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2.5">
                        {isDirty && (
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                                           bg-black/[0.04] dark:bg-white/[0.04]
                                           border border-black/[0.06] dark:border-white/[0.06]
                                           text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white
                                           transition-colors duration-200"
                            >
                                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} />
                                Reset
                            </button>
                        )}

                        {/* Lobotomize toggle */}
                        <button
                            onClick={handleLobotomizeToggle}
                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-xs
                                       transition-[background-color,box-shadow,border-color] duration-300
                                       border
                                       ${lobotomize
                                           ? 'bg-status-red text-white border-status-red shadow-[0_0_24px_rgba(227,0,15,0.4)] hover:shadow-[0_0_36px_rgba(227,0,15,0.6)]'
                                           : 'bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:border-status-red/50 hover:text-status-red'
                                       }`}
                        >
                            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                            {lobotomize ? 'Lobotomize Active' : 'Lobotomize'}
                        </button>

                        {/* Save */}
                        <button
                            onClick={handleSave}
                            disabled={!isDirty}
                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-xs
                                       transition-[background-color,box-shadow] duration-300
                                       ${saved
                                           ? 'bg-status-green text-white shadow-[0_0_20px_rgba(0,171,132,0.4)]'
                                           : isDirty
                                               ? 'bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[0_4px_16px_rgba(0,224,160,0.3)] hover:shadow-[0_4px_24px_rgba(0,224,160,0.5)]'
                                               : 'bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] text-slate-400 cursor-not-allowed'
                                       }`}
                        >
                            {saved
                                ? <><Check className="w-3.5 h-3.5" strokeWidth={2.5} /> Saved</>
                                : <><Save  className="w-3.5 h-3.5" strokeWidth={2}   /> Save Memory</>
                            }
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Lobotomize warning banner ─────────────────────────── */}
            {lobotomize && (
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl
                               bg-status-red/[0.08] border border-status-red/25
                               text-status-red"
                     style={{ animation: 'lobotomize-pulse 2s ease-in-out infinite' }}>
                    <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                    <p className="text-xs font-bold">
                        <span className="uppercase tracking-widest">Warning — Lobotomize mode active.</span>
                        {' '}Memory deletion is permanent and cannot be undone. Click any node's&nbsp;
                        <span className="font-black">✕</span> to excise it from the neural map.
                    </p>
                </div>
            )}

            {/* ── Neural canvas ─────────────────────────────────────── */}
            <div
                ref={canvasRef}
                className="relative w-full rounded-[2rem] overflow-hidden
                           bg-white/50 dark:bg-void-800/40 backdrop-blur-2xl
                           border border-black/[0.05] dark:border-white/[0.05]
                           shadow-[0_8px_48px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.4)]"
                style={{ height: '680px' }}
            >
                {/* Dot-grid background */}
                <div
                    aria-hidden
                    className="absolute inset-0 opacity-[0.018] dark:opacity-[0.04] pointer-events-none"
                    style={{
                        backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 0)',
                        backgroundSize: '36px 36px',
                    }}
                />

                {/* Lobotomize red vignette */}
                {lobotomize && (
                    <div
                        aria-hidden
                        className="absolute inset-0 pointer-events-none rounded-[2rem] transition-opacity duration-700"
                        style={{
                            background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 40%, rgba(227,0,15,0.08) 100%)',
                            animation: 'lobotomize-pulse 3s ease-in-out infinite',
                        }}
                    />
                )}

                {/* SVG connection layer */}
                <ConnectionLayer memories={memories} lobotomize={lobotomize} />

                {/* Brain core */}
                <div data-brain className="absolute inset-0">
                    <BrainCore lobotomize={lobotomize} deletedCount={deletedCount} />
                </div>

                {/* Memory nodes */}
                {memories.map(m => (
                    <MemoryNode
                        key={m.id}
                        memory={m}
                        lobotomize={lobotomize}
                        onDelete={handleDelete}
                        domRef={el => { nodeRefs.current[m.id] = el; }}
                    />
                ))}

                {/* Empty state */}
                {memories.length === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
                        <p className="text-2xl font-black font-display tracking-tight text-status-red/60">
                            Lobotomised.
                        </p>
                        <p className="text-xs font-mono text-slate-400">All memories have been excised from the neural map.</p>
                    </div>
                )}

                {/* Legend */}
                <div className="absolute bottom-5 left-6 flex flex-wrap gap-x-4 gap-y-1.5 pointer-events-none">
                    {(Object.entries(CAT) as [MemCat, typeof CAT[MemCat]][]).map(([, cfg]) => (
                        <div key={cfg.label} className="flex items-center gap-1.5">
                            <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.hex }} />
                            <span className="text-[8px] font-bold uppercase tracking-[0.15em] text-slate-400">
                                {cfg.label}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Memory count overlay */}
                <div className="absolute bottom-5 right-6 pointer-events-none">
                    <span className="text-[9px] font-mono text-slate-300 dark:text-slate-600">
                        {memories.length} / {INITIAL.length} nodes active
                    </span>
                </div>
            </div>

            {/* ── Category summary ──────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(Object.entries(CAT) as [MemCat, typeof CAT[MemCat]][]).map(([key, cfg]) => {
                    const count = memories.filter(m => m.category === key).length;
                    const total = INITIAL.filter(m => m.category === key).length;
                    return (
                        <div
                            key={key}
                            className={`relative overflow-hidden flex flex-col gap-2 p-4 rounded-[1.25rem]
                                       bg-white/60 dark:bg-void-800/50 backdrop-blur-xl
                                       border ${cfg.border}
                                       shadow-[0_2px_12px_rgba(0,0,0,0.04)]`}
                        >
                            <div className="flex items-center justify-between">
                                <div className={`w-2 h-2 rounded-full ${cfg.dot}`}
                                     style={{ boxShadow: `0 0 8px ${cfg.hex}` }} />
                                <span className="text-[9px] font-mono text-slate-400">
                                    {count}/{total}
                                </span>
                            </div>
                            <span className={`text-[10px] font-bold uppercase tracking-[0.14em] ${cfg.text}`}>
                                {cfg.label}
                            </span>
                            {/* Mini bar */}
                            <div className="h-0.5 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-700"
                                    style={{ width: `${(count / total) * 100}%`, background: cfg.hex }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
