import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useCallback } from "preact/hooks";
import gsap from "gsap";
import { Brain, Search, X, AlertTriangle, Save, Check, RotateCcw, ZoomIn, ZoomOut, Maximize2 } from "lucide-preact";

/* ─── Types ──────────────────────────────────────────────────────────────── */

type MemCat = "architecture" | "codebase" | "context" | "preferences" | "patterns" | "people";

interface MemNode {
    id: string;
    content: string;
    category: MemCat;
    strength: number;
    agent: string;
    x: number;
    y: number;
    targetX: number;
    targetY: number;
    radius: number;
    opacity: number;
    scale: number;
    glow: number;
    alive: boolean;
}

interface Edge { a: number; b: number }

interface Pulse { edgeIdx: number; progress: number; speed: number }

/* ─── Config ─────────────────────────────────────────────────────────────── */

const CAT: Record<MemCat, { label: string; hex: string; r: number; g: number; b: number }> = {
    architecture: { label: "Architecture", hex: "#00E0A0", r: 0,   g: 224, b: 160 },
    codebase:     { label: "Codebase",     hex: "#FFB800", r: 255, g: 184, b: 0   },
    context:      { label: "Context",      hex: "#00AB84", r: 0,   g: 171, b: 132 },
    preferences:  { label: "Preferences",  hex: "#94a3b8", r: 148, g: 163, b: 184 },
    patterns:     { label: "Patterns",     hex: "#F59E0B", r: 245, g: 158, b: 11  },
    people:       { label: "People",       hex: "#33FFB8", r: 51,  g: 255, b: 184 },
};

const CLUSTER: Record<MemCat, [number, number]> = {
    people:       [0,    -270],
    architecture: [240,  -135],
    codebase:     [240,   135],
    preferences:  [0,     270],
    context:      [-240,  135],
    patterns:     [-240, -135],
};

/* ─── Seed data ──────────────────────────────────────────────────────────── */

const SEED = [
    { id: "m01", cat: "people"       as MemCat, s: 0.60, agent: "Planner",   text: "Sprint planning every Monday at 10:00 UTC with full team standup" },
    { id: "m02", cat: "people"       as MemCat, s: 0.70, agent: "Reviewer",  text: "Felix leads backend architecture decisions for auth-service" },
    { id: "m03", cat: "architecture" as MemCat, s: 0.90, agent: "Architect", text: "auth-service: JWT with 15 min expiry + refresh token rotation" },
    { id: "m04", cat: "architecture" as MemCat, s: 0.75, agent: "Architect", text: "Payment gateway retries use exponential backoff — 3 max" },
    { id: "m05", cat: "codebase"     as MemCat, s: 0.95, agent: "Debugger",  text: "Dashboard V2: Preact + Tailwind v4 + GSAP + TanStack Router" },
    { id: "m06", cat: "codebase"     as MemCat, s: 0.65, agent: "Debugger",  text: "useLayoutEffect prevents animation double-pop in modals" },
    { id: "m07", cat: "preferences"  as MemCat, s: 0.85, agent: "Planner",   text: "2-week sprints with Monday kickoffs confirmed preference" },
    { id: "m08", cat: "preferences"  as MemCat, s: 0.75, agent: "Reviewer",  text: "All PRs require explicit approval before merge to main" },
    { id: "m09", cat: "context"      as MemCat, s: 0.80, agent: "Debugger",  text: "payment-gateway: open Stripe webhook reliability issue — P1" },
    { id: "m10", cat: "context"      as MemCat, s: 0.95, agent: "Architect", text: "Current sprint: Dashboard V2 avant-garde UI completion" },
    { id: "m11", cat: "patterns"     as MemCat, s: 0.80, agent: "Architect", text: "GSAP elastic.out(1,0.7) cards, power4.out page headers" },
    { id: "m12", cat: "patterns"     as MemCat, s: 0.65, agent: "Architect", text: "Organic morph: 12s fwd / 15s rev prevents sync artifacts" },
];

/* ─── Build nodes + edges ────────────────────────────────────────────────── */

function buildNodes(): MemNode[] {
    const counts: Record<string, number> = {};
    return SEED.map(s => {
        const ci = counts[s.cat] = (counts[s.cat] || 0);
        counts[s.cat]++;
        const [cx, cy] = CLUSTER[s.cat];
        const angle = ci * (Math.PI * 2 / 3) + Math.PI / 4;
        const dist = 45 + s.s * 35;
        const tx = cx + Math.cos(angle) * dist;
        const ty = cy + Math.sin(angle) * dist;
        return {
            id: s.id, content: s.text, category: s.cat, strength: s.s, agent: s.agent,
            x: 0, y: 0, targetX: tx, targetY: ty,
            radius: 4 + s.s * 7, opacity: 0, scale: 0,
            glow: s.s * 0.4, alive: true,
        };
    });
}

function buildEdges(nodes: MemNode[]): Edge[] {
    const edges: Edge[] = [];
    for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++)
            if (nodes[i].category === nodes[j].category) edges.push({ a: i, b: j });
    // Cross-category semantic links
    edges.push({ a: 2, b: 10 }); // architecture ↔ patterns
    edges.push({ a: 4, b: 9 });  // codebase ↔ context
    edges.push({ a: 0, b: 6 });  // people ↔ preferences
    edges.push({ a: 3, b: 8 });  // architecture ↔ context
    return edges;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function bezierCtrl(ax: number, ay: number, bx: number, by: number, idx: number) {
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const off = len * 0.18 * (idx % 2 === 0 ? 1 : -1);
    return { cx: mx + (-dy / len) * off, cy: my + (dx / len) * off };
}

function quadAt(t: number, p0: number, cp: number, p1: number) {
    return (1 - t) * (1 - t) * p0 + 2 * (1 - t) * t * cp + t * t * p1;
}

function hitTest(wx: number, wy: number, nodes: MemNode[]): number {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!n.alive || n.opacity < 0.1) continue;
        const dx = wx - n.x, dy = wy - n.y;
        const hr = (n.radius * n.scale + 12);
        if (dx * dx + dy * dy < hr * hr) return i;
    }
    return -1;
}

/* ─── Inspector Panel ────────────────────────────────────────────────────── */

const Inspector: FunctionComponent<{
    node: MemNode | null;
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
}> = ({ node, allNodes, edges, lobotomize, onClose, onDelete }) => {
    const cat = node ? CAT[node.category] : CAT.architecture;
    const nodeIdx = node ? allNodes.findIndex(n => n.id === node.id) : -1;
    const connected = node ? edges
        .filter(e => e.a === nodeIdx || e.b === nodeIdx)
        .map(e => allNodes[e.a === nodeIdx ? e.b : e.a])
        .filter(n => n.alive) : [];

    return (
        <div
            className="absolute right-0 top-0 bottom-0 w-[300px] z-30
                       bg-white/80 dark:bg-void-800/80 backdrop-blur-3xl
                       border-l border-black/[0.06] dark:border-white/[0.06]
                       shadow-[-20px_0_60px_rgba(0,0,0,0.08)] dark:shadow-[-20px_0_60px_rgba(0,0,0,0.4)]
                       p-6 flex flex-col gap-4 overflow-y-auto dashboard-scrollbar
                       transition-transform duration-500"
            style={{
                transform: `translateX(${node ? "0" : "100%"})`,
                transitionTimingFunction: "cubic-bezier(0.33, 1, 0.68, 1)",
                pointerEvents: node ? "auto" : "none",
            }}
        >
            <button
                onClick={onClose}
                className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center
                           bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                           transition-colors duration-200"
            >
                <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
            </button>

            {node && (
                <>
                    {/* Category */}
                    <div className="flex items-center gap-2 pt-1">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 10px ${cat.hex}` }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono" style={{ color: cat.hex }}>
                            {cat.label}
                        </span>
                    </div>

                    {/* Content */}
                    <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                        {node.content}
                    </p>

                    {/* Meta */}
                    <div className="flex flex-col gap-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Agent</span>
                            <span className="text-xs font-mono text-slate-600 dark:text-slate-400">{node.agent}</span>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">Strength</span>
                            <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-700"
                                        style={{ width: `${node.strength * 100}%`, background: cat.hex }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">{Math.round(node.strength * 100)}%</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">ID</span>
                            <span className="text-[11px] font-mono text-slate-400">{node.id}</span>
                        </div>
                    </div>

                    {/* Connected */}
                    {connected.length > 0 && (
                        <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                                Synapses ({connected.length})
                            </span>
                            {connected.map(cn => (
                                <div key={cn.id} className="flex items-start gap-2 py-1">
                                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                        style={{ background: CAT[cn.category].hex }} />
                                    <span className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 font-medium">
                                        {cn.content}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Delete */}
                    {lobotomize && (
                        <button
                            onClick={() => onDelete(node.id)}
                            className="mt-auto flex items-center justify-center gap-2 w-full py-3 rounded-xl
                                       bg-status-red text-white font-bold text-xs
                                       shadow-[0_0_20px_rgba(227,0,15,0.3)] hover:shadow-[0_0_30px_rgba(227,0,15,0.5)]
                                       transition-shadow duration-300"
                        >
                            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Excise Memory
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

/* ─── Memory Page ────────────────────────────────────────────────────────── */

export const MemoryPage: FunctionComponent = () => {
    const headerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    const [lobotomize, setLobotomize] = useState(false);
    const [selectedNode, setSelectedNode] = useState<MemNode | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [memoryCount, setMemoryCount] = useState(SEED.length);
    const [deletedCount, setDeletedCount] = useState(0);
    const [saved, setSaved] = useState(false);
    const [isDirty, setIsDirty] = useState(false);

    // Mutable render state — GSAP writes here, rAF reads
    const S = useRef({
        nodes: buildNodes(),
        edges: buildEdges(buildNodes()),
        cam: { x: 0, y: 0, zoom: 0.55 },
        hoveredIdx: -1,
        selectedIdx: -1,
        pulses: [] as Pulse[],
        lobotomize: false,
        mouseDown: false,
        dragMoved: false,
        lastMouse: { x: 0, y: 0 },
        rafId: 0,
        entranceDone: false,
        searchMatch: null as Set<number> | null,
        neuronTimer: 0,
    });

    // Sync lobotomize to mutable ref
    const lobRef = useRef(lobotomize);
    lobRef.current = lobotomize;

    /* ── Canvas setup & render loop ───────────────────────────────────────── */
    useLayoutEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const s = S.current;

        // Rebuild edges with the actual nodes ref
        s.edges = buildEdges(s.nodes);

        // Spawn initial pulses (one per edge)
        s.pulses = s.edges.map((_, i) => ({
            edgeIdx: i,
            progress: Math.random(),
            speed: 0.002 + Math.random() * 0.003,
        }));

        /* Resize canvas for HiDPI */
        const resize = () => {
            const rect = canvas.parentElement!.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            canvas.style.width = rect.width + "px";
            canvas.style.height = rect.height + "px";
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        resize();
        window.addEventListener("resize", resize);

        /* ── Draw frame ──────────────────────────────────────────────────── */
        function draw(time: number) {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const dark = document.documentElement.classList.contains("dark");
            const { cam, nodes, edges, pulses, hoveredIdx, selectedIdx } = s;
            const lob = lobRef.current;

            ctx.clearRect(0, 0, w, h);

            /* BG radial glow */
            const scx = w / 2, scy = h / 2;
            const glowR = 380 * cam.zoom;
            const coreRGB = lob ? "227,0,15" : "0,224,160";
            const bg = ctx.createRadialGradient(scx, scy, 0, scx, scy, glowR);
            bg.addColorStop(0, `rgba(${coreRGB},${dark ? 0.07 : 0.035})`);
            bg.addColorStop(1, "transparent");
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);

            /* Camera transform */
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(cam.zoom, cam.zoom);
            ctx.translate(-cam.x, -cam.y);

            /* Cluster halos */
            for (const [cat, [cx, cy]] of Object.entries(CLUSTER) as [MemCat, [number, number]][]) {
                const c = CAT[cat];
                const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, 130);
                const a = lob ? 0.015 : (dark ? 0.05 : 0.025);
                halo.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${a})`);
                halo.addColorStop(1, "transparent");
                ctx.fillStyle = halo;
                ctx.beginPath();
                ctx.arc(cx, cy, 130, 0, Math.PI * 2);
                ctx.fill();
            }

            /* Cluster labels */
            if (cam.zoom > 0.55) {
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                for (const [cat, [cx, cy]] of Object.entries(CLUSTER) as [MemCat, [number, number]][]) {
                    const c = CAT[cat];
                    ctx.font = `700 ${11}px "Plus Jakarta Sans", sans-serif`;
                    ctx.fillStyle = lob
                        ? `rgba(227,0,15,${dark ? 0.2 : 0.12})`
                        : `rgba(${c.r},${c.g},${c.b},${dark ? 0.25 : 0.15})`;
                    ctx.fillText(c.label.toUpperCase(), cx, cy);
                }
            }

            /* Radial tendrils (node → core) */
            for (const node of nodes) {
                if (!node.alive || node.opacity < 0.05) continue;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(node.x, node.y);
                const a = (0.03 + node.strength * 0.03) * node.opacity;
                ctx.strokeStyle = lob
                    ? `rgba(227,0,15,${a})`
                    : `rgba(${CAT[node.category].r},${CAT[node.category].g},${CAT[node.category].b},${a})`;
                ctx.lineWidth = 0.6;
                ctx.stroke();
            }

            /* Edges */
            for (let ei = 0; ei < edges.length; ei++) {
                const { a, b } = edges[ei];
                const na = nodes[a], nb = nodes[b];
                if (!na.alive || !nb.alive || na.opacity < 0.05 || nb.opacity < 0.05) continue;
                const cp = bezierCtrl(na.x, na.y, nb.x, nb.y, ei);
                const alpha = (0.08 + (na.strength + nb.strength) * 0.04) * Math.min(na.opacity, nb.opacity);
                const cat = CAT[na.category];
                ctx.beginPath();
                ctx.moveTo(na.x, na.y);
                ctx.quadraticCurveTo(cp.cx, cp.cy, nb.x, nb.y);
                ctx.strokeStyle = lob
                    ? `rgba(227,0,15,${alpha})`
                    : `rgba(${cat.r},${cat.g},${cat.b},${alpha})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            /* Traveling pulses */
            if (s.entranceDone) {
                ctx.shadowBlur = 10;
                for (const p of pulses) {
                    const edge = edges[p.edgeIdx];
                    if (!edge) continue;
                    const na = nodes[edge.a], nb = nodes[edge.b];
                    if (!na.alive || !nb.alive) continue;
                    const cp = bezierCtrl(na.x, na.y, nb.x, nb.y, p.edgeIdx);
                    const px = quadAt(p.progress, na.x, cp.cx, nb.x);
                    const py = quadAt(p.progress, na.y, cp.cy, nb.y);
                    const cat = CAT[na.category];
                    const pColor = lob ? "rgba(227,0,15,0.7)" : `rgba(${cat.r},${cat.g},${cat.b},0.75)`;
                    ctx.shadowColor = lob ? "rgba(227,0,15,0.5)" : cat.hex;
                    ctx.beginPath();
                    ctx.arc(px, py, 2, 0, Math.PI * 2);
                    ctx.fillStyle = pColor;
                    ctx.fill();
                    p.progress += p.speed;
                    if (p.progress > 1) p.progress -= 1;
                }
                ctx.shadowBlur = 0;
            }

            /* Core rings */
            const pulse = 0.5 + Math.sin(time * 0.002) * 0.25;
            for (let i = 0; i < 4; i++) {
                const ringR = 22 + i * 18 + Math.sin(time * 0.001 + i * 1.8) * 4;
                ctx.beginPath();
                ctx.arc(0, 0, ringR, 0, Math.PI * 2);
                const ra = (0.07 - i * 0.012) * pulse;
                ctx.strokeStyle = lob ? `rgba(227,0,15,${ra})` : `rgba(0,224,160,${ra})`;
                ctx.lineWidth = 0.8;
                ctx.stroke();
            }

            /* Core dot */
            const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 18);
            coreGrad.addColorStop(0, `rgba(${coreRGB},${0.85 * pulse})`);
            coreGrad.addColorStop(0.4, `rgba(${coreRGB},${0.25 * pulse})`);
            coreGrad.addColorStop(1, `rgba(${coreRGB},0)`);
            ctx.fillStyle = coreGrad;
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.fill();

            ctx.beginPath();
            ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
            ctx.fillStyle = lob ? "#E3000F" : "#00E0A0";
            ctx.shadowBlur = 18;
            ctx.shadowColor = lob ? "rgba(227,0,15,0.8)" : "rgba(0,224,160,0.8)";
            ctx.fill();
            ctx.shadowBlur = 0;

            /* Nodes */
            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (!n.alive || n.opacity < 0.01) continue;
                const cat = CAT[n.category];
                const r = n.radius * n.scale;
                const isHov = i === hoveredIdx;
                const isSel = i === selectedIdx;
                const dimmed = s.searchMatch && !s.searchMatch.has(i);

                const effOpacity = dimmed ? n.opacity * 0.12 : n.opacity;

                /* Glow halo */
                const glR = r * (3 + n.glow * 2.5);
                const glAlpha = (n.glow * 0.12 + (isHov ? 0.14 : 0) + (isSel ? 0.1 : 0)) * effOpacity;
                const gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glR);
                gl.addColorStop(0, lob ? `rgba(227,0,15,${glAlpha})` : `rgba(${cat.r},${cat.g},${cat.b},${glAlpha})`);
                gl.addColorStop(1, "transparent");
                ctx.fillStyle = gl;
                ctx.beginPath();
                ctx.arc(n.x, n.y, glR, 0, Math.PI * 2);
                ctx.fill();

                /* Body */
                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                const bodyAlpha = (0.65 + n.strength * 0.35) * effOpacity;
                ctx.fillStyle = lob
                    ? `rgba(227,0,15,${bodyAlpha})`
                    : `rgba(${cat.r},${cat.g},${cat.b},${bodyAlpha})`;
                if (isHov || isSel) {
                    ctx.shadowBlur = 22;
                    ctx.shadowColor = lob ? "rgba(227,0,15,0.6)" : cat.hex;
                }
                ctx.fill();
                ctx.shadowBlur = 0;

                /* Selection ring */
                if (isSel) {
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = lob
                        ? "rgba(227,0,15,0.4)"
                        : `rgba(${cat.r},${cat.g},${cat.b},0.4)`;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

                /* Label */
                if (cam.zoom > 0.65 && !dimmed) {
                    const label = n.content.length > 28 ? n.content.slice(0, 28) + "…" : n.content;
                    ctx.font = `600 ${10}px "Plus Jakarta Sans", sans-serif`;
                    ctx.textAlign = "left";
                    ctx.textBaseline = "middle";
                    ctx.fillStyle = dark
                        ? `rgba(255,255,255,${0.55 * effOpacity})`
                        : `rgba(0,0,0,${0.45 * effOpacity})`;
                    ctx.fillText(label, n.x + r + 10, n.y);
                }

                /* Breathing oscillation */
                if (s.entranceDone && n.alive) {
                    const breath = 1 + Math.sin(time * 0.0015 + i * 1.2) * 0.04;
                    if (n.scale > 0.95 && n.scale < 1.1) n.scale = breath;
                }
            }

            ctx.restore();

            /* Core label */
            ctx.textAlign = "center";
            ctx.font = `700 9px "JetBrains Mono", monospace`;
            ctx.fillStyle = lob ? "rgba(227,0,15,0.5)" : "rgba(0,224,160,0.5)";
            ctx.fillText(lob ? "LOBOTOMIZE" : "NEURAL CORE", scx, scy + 32 * cam.zoom);

            s.rafId = requestAnimationFrame(draw);
        }

        s.rafId = requestAnimationFrame(draw);

        /* ── Mouse events ────────────────────────────────────────────────── */
        const getWorld = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
            const w = rect.width, h = rect.height;
            return {
                wx: (sx - w / 2) / s.cam.zoom + s.cam.x,
                wy: (sy - h / 2) / s.cam.zoom + s.cam.y,
                sx, sy,
            };
        };

        const onMove = (e: MouseEvent) => {
            const { wx, wy } = getWorld(e);
            if (s.mouseDown) {
                const dx = (e.clientX - s.lastMouse.x) / s.cam.zoom;
                const dy = (e.clientY - s.lastMouse.y) / s.cam.zoom;
                s.cam.x -= dx;
                s.cam.y -= dy;
                s.lastMouse = { x: e.clientX, y: e.clientY };
                s.dragMoved = true;
                canvas.style.cursor = "grabbing";
                return;
            }
            const idx = hitTest(wx, wy, s.nodes);
            s.hoveredIdx = idx;
            canvas.style.cursor = idx >= 0 ? "pointer" : "grab";
        };

        const onDown = (e: MouseEvent) => {
            s.mouseDown = true;
            s.dragMoved = false;
            s.lastMouse = { x: e.clientX, y: e.clientY };
        };

        const onUp = (e: MouseEvent) => {
            if (!s.dragMoved) {
                const { wx, wy } = getWorld(e);
                const idx = hitTest(wx, wy, s.nodes);
                if (idx >= 0) {
                    s.selectedIdx = idx;
                    setSelectedNode({ ...s.nodes[idx] });
                    // Fly camera to node
                    gsap.to(s.cam, {
                        x: s.nodes[idx].x,
                        y: s.nodes[idx].y,
                        zoom: 1.4,
                        duration: 1,
                        ease: "power3.out",
                        overwrite: true,
                    });
                } else {
                    s.selectedIdx = -1;
                    setSelectedNode(null);
                }
            }
            s.mouseDown = false;
            s.dragMoved = false;
            canvas.style.cursor = s.hoveredIdx >= 0 ? "pointer" : "grab";
        };

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.08 : 0.08;
            const z = Math.max(0.3, Math.min(2.5, s.cam.zoom + delta));
            gsap.to(s.cam, { zoom: z, duration: 0.35, ease: "power2.out", overwrite: true });
        };

        canvas.addEventListener("mousemove", onMove);
        canvas.addEventListener("mousedown", onDown);
        canvas.addEventListener("mouseup", onUp);
        canvas.addEventListener("mouseleave", () => { s.mouseDown = false; s.hoveredIdx = -1; });
        canvas.addEventListener("wheel", onWheel, { passive: false });

        /* ── Entrance animation ──────────────────────────────────────────── */
        const tl = gsap.timeline({
            delay: 0.25,
            onComplete: () => { s.entranceDone = true; startNeuralFire(); },
        });

        // Camera zoom in
        tl.to(s.cam, { zoom: 1, duration: 2.2, ease: "power2.out" }, 0);

        // Nodes fly out from core
        s.nodes.forEach((node, i) => {
            tl.to(node, {
                x: node.targetX,
                y: node.targetY,
                scale: 1,
                opacity: 1,
                duration: 1.5,
                ease: "power3.out",
            }, 0.35 + i * 0.07);
        });

        /* ── Neural fire (random node pulses) ────────────────────────────── */
        function startNeuralFire() {
            const fire = () => {
                const alive = s.nodes.filter(n => n.alive);
                if (alive.length === 0) return;
                const node = alive[Math.floor(Math.random() * alive.length)];
                const baseGlow = node.strength * 0.4;
                gsap.timeline()
                    .to(node, { glow: 1, scale: 1.35, duration: 0.25, ease: "power2.out" })
                    .to(node, { glow: baseGlow, scale: 1, duration: 0.7, ease: "power2.inOut" });
                s.neuronTimer = window.setTimeout(fire, 1800 + Math.random() * 2500);
            };
            s.neuronTimer = window.setTimeout(fire, 800);
        }

        /* ── Header entrance ─────────────────────────────────────────────── */
        if (headerRef.current) {
            gsap.fromTo(
                Array.from(headerRef.current.children),
                { opacity: 0, y: 40 },
                { opacity: 1, y: 0, stagger: 0.08, duration: 0.9, ease: "power4.out", delay: 0.05 },
            );
        }

        return () => {
            cancelAnimationFrame(s.rafId);
            clearTimeout(s.neuronTimer);
            window.removeEventListener("resize", resize);
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mousedown", onDown);
            canvas.removeEventListener("mouseup", onUp);
            canvas.removeEventListener("wheel", onWheel);
        };
    }, []);

    /* ── Search ───────────────────────────────────────────────────────────── */
    const handleSearch = useCallback((q: string) => {
        setSearchQuery(q);
        const s = S.current;
        if (!q.trim()) {
            s.searchMatch = null;
            s.nodes.forEach(n => { if (n.alive) gsap.to(n, { opacity: 1, duration: 0.4 }); });
            return;
        }
        const lower = q.toLowerCase();
        const matches = new Set<number>();
        s.nodes.forEach((n, i) => {
            if (n.alive && (n.content.toLowerCase().includes(lower) || n.category.includes(lower) || n.agent.toLowerCase().includes(lower)))
                matches.add(i);
        });
        s.searchMatch = matches;

        // Fly to centroid of matches
        if (matches.size > 0) {
            let cx = 0, cy = 0;
            matches.forEach(i => { cx += s.nodes[i].x; cy += s.nodes[i].y; });
            cx /= matches.size; cy /= matches.size;
            gsap.to(s.cam, { x: cx, y: cy, zoom: 1.1, duration: 0.8, ease: "power3.out", overwrite: true });
        }
    }, []);

    /* ── Lobotomize toggle ────────────────────────────────────────────────── */
    const handleLobotomizeToggle = useCallback(() => {
        setLobotomize(prev => {
            const next = !prev;
            if (next && wrapRef.current) {
                gsap.timeline()
                    .to(wrapRef.current, { x: -6, duration: 0.05 })
                    .to(wrapRef.current, { x: 6, duration: 0.05 })
                    .to(wrapRef.current, { x: -4, duration: 0.04 })
                    .to(wrapRef.current, { x: 4, duration: 0.04 })
                    .to(wrapRef.current, { x: 0, duration: 0.05 });
            }
            return next;
        });
    }, []);

    /* ── Delete ───────────────────────────────────────────────────────────── */
    const handleDelete = useCallback((id: string) => {
        const s = S.current;
        const idx = s.nodes.findIndex(n => n.id === id);
        if (idx < 0) return;
        const node = s.nodes[idx];
        setIsDirty(true);

        gsap.timeline({
            onComplete: () => {
                node.alive = false;
                if (s.selectedIdx === idx) { s.selectedIdx = -1; setSelectedNode(null); }
                setMemoryCount(s.nodes.filter(n => n.alive).length);
                setDeletedCount(c => c + 1);
            },
        })
            .to(node, { x: node.x + 8, duration: 0.04, ease: "power4.out" })
            .to(node, { x: node.x - 8, duration: 0.04 })
            .to(node, { x: node.x + 5, duration: 0.04 })
            .to(node, { x: node.x, duration: 0.03 })
            .to(node, { glow: 2, duration: 0.1 })
            .to(node, { scale: 0, opacity: 0, x: 0, y: 0, duration: 0.4, ease: "power4.in" });
    }, []);

    /* ── Camera controls ──────────────────────────────────────────────────── */
    const zoomIn = useCallback(() => {
        gsap.to(S.current.cam, { zoom: Math.min(2.5, S.current.cam.zoom + 0.3), duration: 0.5, ease: "power2.out", overwrite: true });
    }, []);
    const zoomOut = useCallback(() => {
        gsap.to(S.current.cam, { zoom: Math.max(0.3, S.current.cam.zoom - 0.3), duration: 0.5, ease: "power2.out", overwrite: true });
    }, []);
    const zoomReset = useCallback(() => {
        gsap.to(S.current.cam, { x: 0, y: 0, zoom: 1, duration: 0.8, ease: "power3.out", overwrite: true });
        S.current.selectedIdx = -1;
        setSelectedNode(null);
    }, []);

    /* ── Save / Reset ─────────────────────────────────────────────────────── */
    const handleSave = useCallback(() => {
        setSaved(true); setIsDirty(false);
        setTimeout(() => setSaved(false), 2400);
    }, []);

    const handleReset = useCallback(() => {
        const s = S.current;
        s.nodes = buildNodes();
        s.edges = buildEdges(s.nodes);
        s.pulses = s.edges.map((_, i) => ({ edgeIdx: i, progress: Math.random(), speed: 0.002 + Math.random() * 0.003 }));
        s.selectedIdx = -1;
        s.searchMatch = null;
        setSelectedNode(null);
        setSearchQuery("");
        setMemoryCount(SEED.length);
        setDeletedCount(0);
        setIsDirty(false);

        // Re-entrance
        gsap.to(s.cam, { x: 0, y: 0, zoom: 0.55, duration: 0.01, overwrite: true });
        const tl = gsap.timeline();
        tl.to(s.cam, { zoom: 1, duration: 1.8, ease: "power2.out" }, 0);
        s.nodes.forEach((node, i) => {
            tl.to(node, {
                x: node.targetX, y: node.targetY,
                scale: 1, opacity: 1,
                duration: 1.2, ease: "power3.out",
            }, 0.15 + i * 0.06);
        });
    }, []);

    /* ─── Render ──────────────────────────────────────────────────────────── */
    return (
        <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-16 flex flex-col gap-8 relative z-10">

            {/* Ambient glow */}
            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.04)_0%,transparent_70%)]
                               dark:bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.06)_0%,transparent_70%)]" />
            </div>

            {/* ── Header ─────────────────────────────────────────────────── */}
            <div ref={headerRef} className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
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
                    <p className="text-base text-slate-500 font-medium max-w-lg leading-relaxed">
                        Explore the neural landscape of your agents' persistent memory.
                        Click nodes to inspect. Scroll to zoom. Drag to pan.
                    </p>
                </div>

                <div className="flex flex-col items-end gap-3.5 shrink-0">
                    {/* Stats */}
                    <div className="flex items-center gap-2.5">
                        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full
                                       bg-signal-500/[0.08] border border-signal-500/20 text-[10px] font-bold font-mono text-signal-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                            {memoryCount} memories
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
                            <button onClick={handleReset}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl
                                           bg-black/[0.04] dark:bg-white/[0.04]
                                           border border-black/[0.06] dark:border-white/[0.06]
                                           text-xs font-bold text-slate-500 hover:text-slate-900 dark:hover:text-white
                                           transition-colors duration-200">
                                <RotateCcw className="w-3.5 h-3.5" strokeWidth={2} /> Reset
                            </button>
                        )}
                        <button onClick={handleLobotomizeToggle}
                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-xs border
                                       transition-[background-color,box-shadow,border-color] duration-300
                                       ${lobotomize
                                           ? "bg-status-red text-white border-status-red shadow-[0_0_24px_rgba(227,0,15,0.4)] hover:shadow-[0_0_36px_rgba(227,0,15,0.6)]"
                                           : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.08] dark:border-white/[0.08] text-slate-600 dark:text-slate-400 hover:border-status-red/50 hover:text-status-red"
                                       }`}>
                            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                            {lobotomize ? "Lobotomize Active" : "Lobotomize"}
                        </button>
                        <button onClick={handleSave} disabled={!isDirty}
                            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-xl font-bold text-xs
                                       transition-[background-color,box-shadow] duration-300
                                       ${saved
                                           ? "bg-status-green text-white shadow-[0_0_20px_rgba(0,171,132,0.4)]"
                                           : isDirty
                                               ? "bg-signal-500 hover:bg-signal-400 text-void-900 shadow-[0_4px_16px_rgba(0,224,160,0.3)] hover:shadow-[0_4px_24px_rgba(0,224,160,0.5)]"
                                               : "bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.06] text-slate-400 cursor-not-allowed"
                                       }`}>
                            {saved ? <><Check className="w-3.5 h-3.5" strokeWidth={2.5} /> Saved</> : <><Save className="w-3.5 h-3.5" strokeWidth={2} /> Save Memory</>}
                        </button>
                    </div>
                </div>
            </div>

            {/* ── Lobotomize warning ─────────────────────────────────────── */}
            {lobotomize && (
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl
                               bg-status-red/[0.08] border border-status-red/25 text-status-red"
                    style={{ animation: "lobotomize-pulse 2s ease-in-out infinite" }}>
                    <AlertTriangle className="w-4 h-4 shrink-0" strokeWidth={2.5} />
                    <p className="text-xs font-bold">
                        <span className="uppercase tracking-widest">Warning — Lobotomize mode active.</span>
                        {" "}Click any node then use the inspector to excise memories permanently.
                    </p>
                </div>
            )}

            {/* ── Neural Canvas ──────────────────────────────────────────── */}
            <div
                ref={wrapRef}
                className="relative w-full rounded-[2rem] overflow-hidden
                           bg-white/50 dark:bg-void-800/40 backdrop-blur-2xl
                           border border-black/[0.05] dark:border-white/[0.05]
                           shadow-[0_8px_48px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.4)]"
                style={{ height: "max(600px, calc(100vh - 340px))" }}
            >
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

                {/* Search overlay */}
                <div className="absolute top-5 left-5 z-20">
                    <div className="relative">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" strokeWidth={2} />
                        <input
                            type="text"
                            value={searchQuery}
                            onInput={e => handleSearch((e.target as HTMLInputElement).value)}
                            placeholder="Search memories…"
                            className="w-56 pl-9 pr-4 py-2.5 rounded-xl text-xs font-medium
                                       bg-white/80 dark:bg-void-800/80 backdrop-blur-2xl
                                       border border-black/[0.06] dark:border-white/[0.06]
                                       text-slate-700 dark:text-slate-300
                                       placeholder:text-slate-400
                                       focus:outline-none focus:ring-2 focus:ring-signal-500/10 focus:border-signal-500/40
                                       transition-[border-color,box-shadow] duration-200"
                        />
                        {searchQuery && (
                            <button onClick={() => handleSearch("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full
                                           flex items-center justify-center bg-black/[0.06] dark:bg-white/[0.06]
                                           hover:bg-black/[0.1] dark:hover:bg-white/[0.1] transition-colors duration-200">
                                <X className="w-3 h-3 text-slate-500" strokeWidth={2} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Zoom controls */}
                <div className="absolute bottom-5 right-5 z-20 flex flex-col gap-1.5">
                    {[
                        { icon: ZoomIn, fn: zoomIn, title: "Zoom in" },
                        { icon: ZoomOut, fn: zoomOut, title: "Zoom out" },
                        { icon: Maximize2, fn: zoomReset, title: "Reset view" },
                    ].map(({ icon: Icon, fn, title }) => (
                        <button key={title} onClick={fn} title={title}
                            className="w-9 h-9 rounded-xl flex items-center justify-center
                                       bg-white/80 dark:bg-void-800/80 backdrop-blur-2xl
                                       border border-black/[0.06] dark:border-white/[0.06]
                                       text-slate-500 hover:text-slate-900 dark:hover:text-white
                                       shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)]
                                       transition-colors duration-200">
                            <Icon className="w-4 h-4" strokeWidth={1.5} />
                        </button>
                    ))}
                </div>

                {/* Legend */}
                <div className="absolute bottom-5 left-5 z-20 flex flex-wrap gap-x-4 gap-y-1.5">
                    {(Object.entries(CAT) as [MemCat, (typeof CAT)[MemCat]][]).map(([, cfg]) => (
                        <div key={cfg.label} className="flex items-center gap-1.5">
                            <div className="w-2 h-2 rounded-full" style={{ background: cfg.hex, boxShadow: `0 0 6px ${cfg.hex}` }} />
                            <span className="text-[9px] font-bold uppercase tracking-[0.12em]
                                           text-slate-400/80 dark:text-slate-500/80">
                                {cfg.label}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Node count */}
                <div className="absolute top-5 right-5 z-20 pointer-events-none">
                    <span className="text-[9px] font-mono text-slate-300 dark:text-slate-600">
                        {memoryCount} / {SEED.length} nodes
                    </span>
                </div>

                {/* Empty state */}
                {memoryCount === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none z-20">
                        <p className="text-2xl font-black font-display tracking-tight text-status-red/60">
                            Lobotomised.
                        </p>
                        <p className="text-xs font-mono text-slate-400">All memories have been excised from the neural map.</p>
                    </div>
                )}

                {/* Inspector panel */}
                <Inspector
                    node={selectedNode}
                    allNodes={S.current.nodes}
                    edges={S.current.edges}
                    lobotomize={lobotomize}
                    onClose={() => { S.current.selectedIdx = -1; setSelectedNode(null); }}
                    onDelete={handleDelete}
                />
            </div>

            {/* ── Category summary ───────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {(Object.entries(CAT) as [MemCat, (typeof CAT)[MemCat]][]).map(([key, cfg]) => {
                    const alive = S.current.nodes.filter(n => n.category === key && n.alive).length;
                    const total = SEED.filter(s => s.cat === key).length;
                    return (
                        <div key={key}
                            className="relative overflow-hidden flex flex-col gap-2 p-4 rounded-[1.25rem]
                                       bg-white/60 dark:bg-void-800/50 backdrop-blur-xl
                                       border border-black/[0.06] dark:border-white/[0.06]
                                       shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)]">
                            <div className="flex items-center justify-between">
                                <div className="w-2 h-2 rounded-full" style={{ background: cfg.hex, boxShadow: `0 0 8px ${cfg.hex}` }} />
                                <span className="text-[9px] font-mono text-slate-400">{alive}/{total}</span>
                            </div>
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: cfg.hex }}>
                                {cfg.label}
                            </span>
                            <div className="h-0.5 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                                <div className="h-full rounded-full transition-all duration-700"
                                    style={{ width: total ? `${(alive / total) * 100}%` : "0%", background: cfg.hex }} />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
