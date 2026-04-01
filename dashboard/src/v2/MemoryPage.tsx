import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useCallback, useEffect } from "preact/hooks";
import gsap from "gsap";
import { Brain, Search, X, AlertTriangle, Save, Check, RotateCcw, ZoomIn, ZoomOut, Maximize2, Plus, Download, Trash2, Power, Loader2, HardDrive, RefreshCw } from "lucide-preact";
import { listMemories, createMemory, deleteMemory as apiDeleteMemory, searchMemories, listEmbeddingModels, downloadEmbeddingModel, selectEmbeddingModel, deleteEmbeddingModel, getMemoryStats, startReembed, getReembedProgress, getEmbeddingMap, type EmbeddingModelWithStatus, type ReembedProgress, type EmbeddingMapResult } from "./lib/memory-api.js";
import type { MemoryRecord, MemoryScope, MemoryCategory } from "./memory-types.js";
import { useProjectData } from "./context/project-data.js";
import { fetchSprints } from "./lib/project-api.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import { prepareMemoryGraph, type MemNode, type Edge, type GraphMetadata, CLUSTER } from "./lib/memory-graph.js";
import type { SprintRecord, AgentPreset } from "./types.js";

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface Pulse { edgeIdx: number; progress: number; speed: number }

/* ─── Config ─────────────────────────────────────────────────────────────── */

const CAT: Record<string, { label: string; hex: string; r: number; g: number; b: number }> = {
    architecture: { label: "Architecture", hex: "#00E0A0", r: 0,   g: 224, b: 160 },
    codebase:     { label: "Codebase",     hex: "#FFB800", r: 255, g: 184, b: 0   },
    context:      { label: "Context",      hex: "#00AB84", r: 0,   g: 171, b: 132 },
    preferences:  { label: "Preferences",  hex: "#94a3b8", r: 148, g: 163, b: 184 },
    patterns:     { label: "Patterns",     hex: "#F59E0B", r: 245, g: 158, b: 11  },
    decision:     { label: "Decision",     hex: "#8B5CF6", r: 139, g: 92,  b: 246 },
    error:        { label: "Error",        hex: "#EF4444", r: 239, g: 68,  b: 68  },
    learning:     { label: "Learning",     hex: "#33FFB8", r: 51,  g: 255, b: 184 },
};

type MemTier = "short_term" | "long_term";
const TIER_TABS: { key: MemTier; label: string; scope: MemoryScope }[] = [
    { key: "short_term", label: "Short Term", scope: "sprint" },
    { key: "long_term",  label: "Long Term",  scope: "project" },
];

const CATEGORIES: MemoryCategory[] = ["architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning"];

/* ─── Build nodes + edges from API data ─────────────────────────────────── */

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

function formatBytes(bytes: number): string {
    if (bytes < 1e6) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`;
    return `${(bytes / 1e9).toFixed(1)} GB`;
}

/* ─── Model Download Card ───────────────────────────────────────────────── */

const ModelCard: FunctionComponent<{
    model: EmbeddingModelWithStatus;
    onDownload: (id: string) => void;
    onSelect: (id: string) => void;
    onDelete: (id: string) => void;
    onReembed: () => void;
    reembedding: boolean;
    staleCount: number;
}> = ({ model, onDownload, onSelect, onDelete, onReembed, reembedding, staleCount }) => (
    <div className="flex flex-col gap-3 p-4 rounded-[1.25rem]
                   bg-white/60 dark:bg-void-800/50 backdrop-blur-xl
                   border border-black/[0.06] dark:border-white/[0.06]
                   shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-signal-500" strokeWidth={2} />
                <span className="text-sm font-bold text-slate-800 dark:text-white">{model.displayName}</span>
            </div>
            {model.active && (
                <span className="text-[9px] font-bold uppercase tracking-widest text-signal-500 bg-signal-500/10 px-2 py-0.5 rounded-full">Active</span>
            )}
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">{model.description}</p>
        <div className="flex items-center gap-3 text-[10px] font-mono text-slate-400">
            <span>{model.dimension}d</span>
            <span>{formatBytes(model.sizeBytes)}</span>
            <span>{model.language}</span>
        </div>
        {model.downloading && (
            <div className="flex flex-col gap-1.5">
                <div className="h-1.5 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-signal-500 transition-all duration-300"
                        style={{ width: `${Math.round(model.downloadProgress * 100)}%` }} />
                </div>
                <span className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                    Downloading {Math.round(model.downloadProgress * 100)}%
                </span>
            </div>
        )}
        <div className="flex items-center gap-2 pt-1">
            {!model.downloaded && !model.downloading && (
                <button onClick={() => onDownload(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500 text-void-900 hover:bg-signal-400 transition-colors duration-200
                               shadow-[0_2px_8px_rgba(0,224,160,0.25)]">
                    <Download className="w-3 h-3" strokeWidth={2.5} />
                    Download
                </button>
            )}
            {model.downloaded && !model.active && (
                <button onClick={() => onSelect(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20 transition-colors duration-200">
                    <Power className="w-3 h-3" strokeWidth={2.5} />
                    Activate
                </button>
            )}
            {model.active && !reembedding && (
                <button onClick={onReembed}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               bg-signal-500/10 text-signal-500 hover:bg-signal-500/20 transition-colors duration-200">
                    <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
                    Re-embed{staleCount > 0 ? ` (${staleCount} stale)` : " All"}
                </button>
            )}
            {model.active && reembedding && (
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-signal-500">
                    <RefreshCw className="w-3 h-3 animate-spin" strokeWidth={2.5} />
                    Re-embedding…
                </span>
            )}
            {model.downloaded && (
                <button onClick={() => onDelete(model.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold
                               text-slate-400 hover:text-status-red transition-colors duration-200">
                    <Trash2 className="w-3 h-3" strokeWidth={2} />
                </button>
            )}
            {model.error && (
                <span className="text-[10px] text-status-red font-medium">{model.error}</span>
            )}
        </div>
    </div>
);

/* ─── Inspector Panel ────────────────────────────────────────────────────── */

const Inspector: FunctionComponent<{
    node: MemNode | null;
    allNodes: MemNode[];
    edges: Edge[];
    lobotomize: boolean;
    onClose: () => void;
    onDelete: (id: string) => void;
}> = ({ node, allNodes, edges, lobotomize, onClose, onDelete }) => {
    const cat = node ? (CAT[node.category] || CAT.context) : CAT.architecture;
    const nodeIdx = node ? allNodes.findIndex(n => n.id === node.id) : -1;
    const connected = node ? edges
        .filter(e => e.a === nodeIdx || e.b === nodeIdx)
        .map(e => ({
            node: allNodes[e.a === nodeIdx ? e.b : e.a],
            similarity: e.similarity,
        }))
        .filter(c => c.node.alive)
        .sort((a, b) => b.similarity - a.similarity) : [];

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
            <button onClick={onClose}
                className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center
                           bg-black/[0.04] dark:bg-white/[0.04] hover:bg-black/[0.08] dark:hover:bg-white/[0.08]
                           transition-colors duration-200">
                <X className="w-3.5 h-3.5 text-slate-500" strokeWidth={2} />
            </button>
            {node && (
                <>
                    <div className="flex items-center gap-2 pt-1">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: cat.hex, boxShadow: `0 0 10px ${cat.hex}` }} />
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] font-mono" style={{ color: cat.hex }}>
                            {cat.label}
                        </span>
                        <span className="text-[9px] font-mono text-slate-400 ml-auto px-2 py-0.5 rounded-full bg-black/[0.04] dark:bg-white/[0.04]">
                            {node.scope}
                        </span>
                    </div>
                    <p className="text-[13px] text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
                        {node.content}
                    </p>
                    <div className="flex flex-col gap-3 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
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
                            <span className="text-[11px] font-mono text-slate-400">{node.id.slice(0, 8)}…</span>
                        </div>
                    </div>
                    {connected.length > 0 && (
                        <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">
                                Synapses ({connected.length})
                            </span>
                            {connected.slice(0, 8).map(({ node: cn, similarity }) => (
                                <div key={cn.id} className="flex items-start gap-2 py-1">
                                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                                        style={{ background: (CAT[cn.category] || CAT.context).hex }} />
                                    <div className="flex-1 min-w-0">
                                        <span className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 font-medium">
                                            {cn.content}
                                        </span>
                                    </div>
                                    <span className="text-[9px] font-mono text-slate-400 shrink-0 mt-0.5"
                                        style={{ color: similarity > 0.7 ? (CAT[cn.category] || CAT.context).hex : undefined }}>
                                        {Math.round(similarity * 100)}%
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                    {lobotomize && (
                        <button onClick={() => onDelete(node.id)}
                            className="mt-auto flex items-center justify-center gap-2 w-full py-3 rounded-xl
                                       bg-status-red text-white font-bold text-xs
                                       shadow-[0_0_20px_rgba(227,0,15,0.3)] hover:shadow-[0_0_30px_rgba(227,0,15,0.5)]
                                       transition-shadow duration-300">
                            <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                            Excise Memory
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

/* ─── Add Memory Modal ───────────────────────────────────────────────────── */

const AddMemoryModal: FunctionComponent<{
    open: boolean;
    scope: MemoryScope;
    projectId: string;
    onClose: () => void;
    onCreated: () => void;
}> = ({ open, scope, projectId, onClose, onCreated }) => {
    const [content, setContent] = useState("");
    const [category, setCategory] = useState<MemoryCategory>("context");
    const [strength, setStrength] = useState(0.7);
    const [saving, setSaving] = useState(false);

    if (!open) return null;

    const handleSubmit = async () => {
        if (!content.trim()) return;
        setSaving(true);
        try {
            await createMemory(projectId, { scope, content: content.trim(), category, strength });
            setContent("");
            onCreated();
            onClose();
        } catch { /* ignore */ }
        setSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 dark:bg-black/50 backdrop-blur-sm"
            onClick={onClose}>
            <div className="w-full max-w-md bg-white dark:bg-void-800 rounded-[1.5rem] p-6 flex flex-col gap-4
                           border border-black/[0.06] dark:border-white/[0.06]
                           shadow-[0_24px_80px_rgba(0,0,0,0.15)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.5)]"
                onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-900 dark:text-white font-display">Add Memory</h3>
                <textarea value={content} onInput={e => setContent((e.target as HTMLTextAreaElement).value)}
                    placeholder="What should be remembered…"
                    rows={3}
                    className="w-full px-4 py-3 rounded-xl text-sm
                               bg-black/[0.03] dark:bg-white/[0.03]
                               border border-black/[0.06] dark:border-white/[0.06]
                               text-slate-800 dark:text-slate-200
                               placeholder:text-slate-400
                               focus:outline-none focus:ring-2 focus:ring-signal-500/20 focus:border-signal-500/40
                               resize-none" />
                <div className="flex items-center gap-3">
                    <select value={category} onChange={e => setCategory((e.target as HTMLSelectElement).value as MemoryCategory)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs font-medium
                                   bg-black/[0.03] dark:bg-white/[0.03]
                                   border border-black/[0.06] dark:border-white/[0.06]
                                   text-slate-700 dark:text-slate-300">
                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-400">{Math.round(strength * 100)}%</span>
                        <input type="range" min="0.1" max="1" step="0.1" value={strength}
                            onInput={e => setStrength(parseFloat((e.target as HTMLInputElement).value))}
                            className="w-20 accent-signal-500" />
                    </div>
                </div>
                <div className="flex items-center gap-2 pt-2">
                    <button onClick={onClose}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold
                                   bg-black/[0.04] dark:bg-white/[0.04] text-slate-500 hover:text-slate-900 dark:hover:text-white
                                   transition-colors duration-200">
                        Cancel
                    </button>
                    <button onClick={handleSubmit} disabled={!content.trim() || saving}
                        className="flex-1 py-2.5 rounded-xl text-xs font-bold
                                   bg-signal-500 text-void-900 hover:bg-signal-400
                                   shadow-[0_2px_12px_rgba(0,224,160,0.3)]
                                   transition-colors duration-200 disabled:opacity-70">
                        {saving ? "Saving…" : "Add Memory"}
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ─── Memory Page ────────────────────────────────────────────────────────── */

export const MemoryPage: FunctionComponent = () => {
    const { selectedProject } = useProjectData();
    const pid = selectedProject?.id || "";
    const headerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    const [lobotomize, setLobotomize] = useState(false);
    const [selectedNode, setSelectedNode] = useState<MemNode | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [memoryCount, setMemoryCount] = useState(0);
    const [deletedCount, setDeletedCount] = useState(0);
    const [activeTier, setActiveTier] = useState<MemTier>("short_term");
    const activeScope: MemoryScope = activeTier === "short_term" ? "sprint" : "project";
    const [models, setModels] = useState<EmbeddingModelWithStatus[]>([]);
    const [showModels, setShowModels] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [records, setRecords] = useState<MemoryRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({ sprint: 0, agent: 0, project: 0, activeModel: null as string | null, staleEmbeddings: 0 });
    const [reembed, setReembed] = useState<ReembedProgress | null>(null);

    // Sprint / agent filter state
    const [sprints, setSprints] = useState<SprintRecord[]>([]);
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
    const [selectedSprintId, setSelectedSprintId] = useState<string | undefined>(undefined);
    const [selectedAgentPresetId, setSelectedAgentPresetId] = useState<string | undefined>(undefined);
    const sprintsLoaded = useRef(false);

    // Mutable render state
    const S = useRef({
        graph: { nodes: [], edges: [], catCentroids: {} } as GraphMetadata,
        embeddingMap: null as EmbeddingMapResult | null,
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

    const lobRef = useRef(lobotomize);
    lobRef.current = lobotomize;

    /* ── Fetch sprints & agent presets on project change ─────────────── */
    useEffect(() => {
        if (!pid) return;
        sprintsLoaded.current = false;
        Promise.all([
            fetchSprints(pid).then((res) => res.sprints).catch(() => [] as SprintRecord[]),
            fetchAgentPresets(pid).catch(() => [] as AgentPreset[]),
        ]).then(([sprintsData, presetsData]) => {
            // Sort sprints by number descending so latest is first
            const sorted = [...sprintsData].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
            setSprints(sorted);
            setAgentPresets(presetsData);
            // Default short-term to latest sprint
            if (sorted.length > 0 && !sprintsLoaded.current) {
                setSelectedSprintId(sorted[0].id);
            }
            sprintsLoaded.current = true;
        });
    }, [pid]);

    /* ── Load data ─────────────────────────────────────────────────────── */
    const loadData = useCallback(async () => {
        if (!pid) return;
        setLoading(true);
        try {
            const memoryParams: { projectId: string; scope: MemoryScope; sprintId?: string; agentPresetId?: string; limit: number } = {
                projectId: pid, scope: activeScope, limit: 200,
            };
            if (activeTier === "short_term" && selectedSprintId) {
                memoryParams.sprintId = selectedSprintId;
            }
            if (selectedAgentPresetId) {
                memoryParams.agentPresetId = selectedAgentPresetId;
            }

            const [memoriesData, modelsData, statsData, mapData] = await Promise.all([
                listMemories(memoryParams),
                listEmbeddingModels(),
                getMemoryStats(pid),
                getEmbeddingMap(
                    pid,
                    activeScope,
                    activeTier === "short_term" ? selectedSprintId : undefined,
                    selectedAgentPresetId,
                ).catch(() => null),
            ]);
            setRecords(memoriesData);
            setModels(modelsData);
            setStats(statsData);
            setMemoryCount(memoriesData.length);

            // Update canvas
            const s = S.current;
            s.embeddingMap = mapData;
            s.graph = prepareMemoryGraph(memoriesData, mapData);
            s.pulses = s.graph.edges.map((_, i) => ({ edgeIdx: i, progress: Math.random(), speed: 0.002 + Math.random() * 0.003 }));
            s.selectedIdx = -1;
            s.searchMatch = null;
            setSelectedNode(null);

            // Animate entrance
            gsap.to(s.cam, { x: 0, y: 0, zoom: 0.55, duration: 0.01, overwrite: true });
            const tl = gsap.timeline();
            tl.to(s.cam, { zoom: 1, duration: 1.8, ease: "power2.out" }, 0);
            s.graph.nodes.forEach((node, i) => {
                tl.to(node, {
                    x: node.targetX, y: node.targetY,
                    scale: 1, opacity: 1,
                    duration: 1.2, ease: "power3.out",
                }, 0.15 + Math.min(i, 20) * 0.03);
            });
            s.entranceDone = true;
        } catch { /* ignore */ }
        setLoading(false);
    }, [pid, activeScope, activeTier, selectedSprintId, selectedAgentPresetId]);

    useEffect(() => { loadData(); }, [loadData]);

    /* ── Polling for model download progress ───────────────────────────── */
    useEffect(() => {
        const hasDownloading = models.some(m => m.downloading);
        if (!hasDownloading) return;
        const interval = setInterval(async () => {
            try {
                const updated = await listEmbeddingModels();
                setModels(updated);
                if (!updated.some(m => m.downloading)) clearInterval(interval);
            } catch { /* ignore */ }
        }, 2000);
        return () => clearInterval(interval);
    }, [models]);

    /* ── Polling for re-embed progress ────────────────────────────────── */
    useEffect(() => {
        if (!reembed?.active || !pid) return;
        const interval = setInterval(async () => {
            try {
                const progress = await getReembedProgress(pid);
                setReembed(progress);
                if (!progress.active) {
                    clearInterval(interval);
                    // Refresh everything: stats, embedding map, and nodes
                    loadData();
                }
            } catch { /* ignore */ }
        }, 1000);
        return () => clearInterval(interval);
    }, [reembed?.active, pid, loadData]);

    /* ── Canvas setup & render loop ───────────────────────────────────── */
    useLayoutEffect(() => {
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const s = S.current;

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

        function draw(time: number) {
            const dpr = window.devicePixelRatio || 1;
            const w = canvas.width / dpr;
            const h = canvas.height / dpr;
            const dark = document.documentElement.classList.contains("dark");
            const { cam, graph, pulses, hoveredIdx, selectedIdx } = s;
            const { nodes, edges, catCentroids } = graph;
            const lob = lobRef.current;

            ctx.clearRect(0, 0, w, h);

            const scx = w / 2, scy = h / 2;
            const glowR = 380 * cam.zoom;
            const coreRGB = lob ? "227,0,15" : "0,224,160";
            const bg = ctx.createRadialGradient(scx, scy, 0, scx, scy, glowR);
            bg.addColorStop(0, `rgba(${coreRGB},${dark ? 0.07 : 0.035})`);
            bg.addColorStop(1, "transparent");
            ctx.fillStyle = bg;
            ctx.fillRect(0, 0, w, h);

            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(cam.zoom, cam.zoom);
            ctx.translate(-cam.x, -cam.y);

            for (const [cat, centroid] of Object.entries(catCentroids)) {
                const c = CAT[cat];
                if (!c || centroid.count === 0) continue;
                const haloR = Math.max(80, centroid.radius + 50);
                const halo = ctx.createRadialGradient(centroid.x, centroid.y, 0, centroid.x, centroid.y, haloR);
                const a = lob ? 0.015 : (dark ? 0.04 : 0.02);
                halo.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${a})`);
                halo.addColorStop(1, "transparent");
                ctx.fillStyle = halo;
                ctx.beginPath();
                ctx.arc(centroid.x, centroid.y, haloR, 0, Math.PI * 2);
                ctx.fill();
            }

            if (cam.zoom > 0.55) {
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                for (const [cat, centroid] of Object.entries(catCentroids)) {
                    const c = CAT[cat];
                    if (!c || centroid.count === 0) continue;
                    ctx.font = `700 ${11}px "Plus Jakarta Sans", sans-serif`;
                    ctx.fillStyle = lob
                        ? `rgba(227,0,15,${dark ? 0.2 : 0.12})`
                        : `rgba(${c.r},${c.g},${c.b},${dark ? 0.25 : 0.15})`;
                    ctx.fillText(c.label.toUpperCase(), centroid.x, centroid.y);
                }
            }

            for (const node of nodes) {
                if (!node.alive || node.opacity < 0.05) continue;
                ctx.beginPath();
                ctx.moveTo(0, 0);
                ctx.lineTo(node.x, node.y);
                const cc = CAT[node.category] || CAT.context;
                const a = (0.015 + node.strength * 0.015) * node.opacity;
                ctx.strokeStyle = lob
                    ? `rgba(227,0,15,${a})`
                    : `rgba(${cc.r},${cc.g},${cc.b},${a})`;
                ctx.lineWidth = 0.4;
                ctx.stroke();
            }

            for (let ei = 0; ei < edges.length; ei++) {
                const { a, b, similarity } = edges[ei];
                const na = nodes[a], nb = nodes[b];
                if (!na || !nb || !na.alive || !nb.alive || na.opacity < 0.05 || nb.opacity < 0.05) continue;
                const cp = bezierCtrl(na.x, na.y, nb.x, nb.y, ei);
                // Similarity-driven alpha: stronger connections are more visible
                const simAlpha = similarity * 0.35;
                const alpha = Math.max(0.03, simAlpha) * Math.min(na.opacity, nb.opacity);
                // Blend colors from both endpoints for cross-category edges
                const ca = CAT[na.category] || CAT.context;
                const cb = CAT[nb.category] || CAT.context;
                const mr = Math.round((ca.r + cb.r) / 2);
                const mg = Math.round((ca.g + cb.g) / 2);
                const mb = Math.round((ca.b + cb.b) / 2);
                ctx.beginPath();
                ctx.moveTo(na.x, na.y);
                ctx.quadraticCurveTo(cp.cx, cp.cy, nb.x, nb.y);
                ctx.strokeStyle = lob
                    ? `rgba(227,0,15,${alpha})`
                    : `rgba(${mr},${mg},${mb},${alpha})`;
                ctx.lineWidth = 0.5 + similarity * 1.5;
                ctx.stroke();
            }

            if (s.entranceDone) {
                ctx.shadowBlur = 10;
                for (const p of pulses) {
                    const edge = edges[p.edgeIdx];
                    if (!edge) continue;
                    const na = nodes[edge.a], nb = nodes[edge.b];
                    if (!na || !nb || !na.alive || !nb.alive) continue;
                    const cp = bezierCtrl(na.x, na.y, nb.x, nb.y, p.edgeIdx);
                    const px = quadAt(p.progress, na.x, cp.cx, nb.x);
                    const py = quadAt(p.progress, na.y, cp.cy, nb.y);
                    const ca = CAT[na.category] || CAT.context;
                    const cb = CAT[nb.category] || CAT.context;
                    const mr = Math.round((ca.r + cb.r) / 2);
                    const mg = Math.round((ca.g + cb.g) / 2);
                    const mb = Math.round((ca.b + cb.b) / 2);
                    const pAlpha = 0.4 + edge.similarity * 0.45;
                    const pColor = lob ? `rgba(227,0,15,${pAlpha})` : `rgba(${mr},${mg},${mb},${pAlpha})`;
                    ctx.shadowColor = lob ? "rgba(227,0,15,0.5)" : `rgba(${mr},${mg},${mb},0.5)`;
                    ctx.beginPath();
                    ctx.arc(px, py, 1.5 + edge.similarity, 0, Math.PI * 2);
                    ctx.fillStyle = pColor;
                    ctx.fill();
                    p.progress += p.speed;
                    if (p.progress > 1) p.progress -= 1;
                }
                ctx.shadowBlur = 0;
            }

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

            for (let i = 0; i < nodes.length; i++) {
                const n = nodes[i];
                if (!n.alive || n.opacity < 0.01) continue;
                const cc = CAT[n.category] || CAT.context;
                const r = n.radius * n.scale;
                const isHov = i === hoveredIdx;
                const isSel = i === selectedIdx;
                const dimmed = s.searchMatch && !s.searchMatch.has(i);
                const effOpacity = dimmed ? n.opacity * 0.12 : n.opacity;

                const glR = r * (3 + n.glow * 2.5);
                const glAlpha = (n.glow * 0.12 + (isHov ? 0.14 : 0) + (isSel ? 0.1 : 0)) * effOpacity;
                const gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glR);
                gl.addColorStop(0, lob ? `rgba(227,0,15,${glAlpha})` : `rgba(${cc.r},${cc.g},${cc.b},${glAlpha})`);
                gl.addColorStop(1, "transparent");
                ctx.fillStyle = gl;
                ctx.beginPath();
                ctx.arc(n.x, n.y, glR, 0, Math.PI * 2);
                ctx.fill();

                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                const bodyAlpha = (0.65 + n.strength * 0.35) * effOpacity;
                ctx.fillStyle = lob
                    ? `rgba(227,0,15,${bodyAlpha})`
                    : `rgba(${cc.r},${cc.g},${cc.b},${bodyAlpha})`;
                if (isHov || isSel) {
                    ctx.shadowBlur = 22;
                    ctx.shadowColor = lob ? "rgba(227,0,15,0.6)" : cc.hex;
                }
                ctx.fill();
                ctx.shadowBlur = 0;

                if (isSel) {
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
                    ctx.strokeStyle = lob
                        ? "rgba(227,0,15,0.4)"
                        : `rgba(${cc.r},${cc.g},${cc.b},0.4)`;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }

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

                if (s.entranceDone && n.alive) {
                    const breath = 1 + Math.sin(time * 0.0015 + i * 1.2) * 0.04;
                    if (n.scale > 0.95 && n.scale < 1.1) n.scale = breath;
                }
            }

            ctx.restore();

            ctx.textAlign = "center";
            ctx.font = `700 9px "JetBrains Mono", monospace`;
            ctx.fillStyle = lob ? "rgba(227,0,15,0.5)" : "rgba(0,224,160,0.5)";
            ctx.fillText(lob ? "LOBOTOMIZE" : "NEURAL CORE", scx, scy + 32 * cam.zoom);

            s.rafId = requestAnimationFrame(draw);
        }

        s.rafId = requestAnimationFrame(draw);

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
            const idx = hitTest(wx, wy, s.graph.nodes);
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
                const idx = hitTest(wx, wy, s.graph.nodes);
                if (idx >= 0) {
                    s.selectedIdx = idx;
                    setSelectedNode({ ...s.graph.nodes[idx] });
                    gsap.to(s.cam, { x: s.graph.nodes[idx].x, y: s.graph.nodes[idx].y, zoom: 1.4, duration: 1, ease: "power3.out", overwrite: true });
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

        // Neural fire (random node pulses)
        function startNeuralFire() {
            const fire = () => {
                const alive = s.graph.nodes.filter(n => n.alive);
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
        startNeuralFire();

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

    /* ── Search ────────────────────────────────────────────────────────── */
    const handleSearch = useCallback(async (q: string) => {
        setSearchQuery(q);
        const s = S.current;
        if (!q.trim()) {
            s.searchMatch = null;
            s.graph.nodes.forEach(n => { if (n.alive) gsap.to(n, { opacity: 1, duration: 0.4 }); });
            return;
        }
        // Local text filter
        const lower = q.toLowerCase();
        const matches = new Set<number>();
        s.graph.nodes.forEach((n, i) => {
            if (n.alive && (n.content.toLowerCase().includes(lower) || n.category.includes(lower)))
                matches.add(i);
        });
        s.searchMatch = matches;

        if (matches.size > 0) {
            let cx = 0, cy = 0;
            matches.forEach(i => { cx += s.graph.nodes[i].x; cy += s.graph.nodes[i].y; });
            cx /= matches.size; cy /= matches.size;
            gsap.to(s.cam, { x: cx, y: cy, zoom: 1.1, duration: 0.8, ease: "power3.out", overwrite: true });
        }
    }, []);

    /* ── Lobotomize toggle ────────────────────────────────────────────── */
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

    /* ── Delete ────────────────────────────────────────────────────────── */
    const handleDelete = useCallback(async (id: string) => {
        const s = S.current;
        const idx = s.graph.nodes.findIndex(n => n.id === id);
        if (idx < 0) return;
        const node = s.graph.nodes[idx];

        // API delete
        try { await apiDeleteMemory(id); } catch { /* ignore */ }

        gsap.timeline({
            onComplete: () => {
                node.alive = false;
                if (s.selectedIdx === idx) { s.selectedIdx = -1; setSelectedNode(null); }
                setMemoryCount(s.graph.nodes.filter(n => n.alive).length);
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

    /* ── Camera controls ──────────────────────────────────────────────── */
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

    /* ── Model actions ────────────────────────────────────────────────── */
    const handleDownloadModel = useCallback(async (modelId: string) => {
        try {
            await downloadEmbeddingModel(modelId);
            const updated = await listEmbeddingModels();
            setModels(updated);
        } catch { /* ignore */ }
    }, []);
    const handleSelectModel = useCallback(async (modelId: string) => {
        try {
            await selectEmbeddingModel(modelId);
            const updated = await listEmbeddingModels();
            setModels(updated);
        } catch { /* ignore */ }
    }, []);
    const handleDeleteModel = useCallback(async (modelId: string) => {
        try {
            await deleteEmbeddingModel(modelId);
            const updated = await listEmbeddingModels();
            setModels(updated);
        } catch { /* ignore */ }
    }, []);
    const handleReembed = useCallback(async () => {
        if (!pid) return;
        try {
            await startReembed(pid);
            setReembed({ active: true, completed: 0, total: 0 });
            // Poll immediately — small models finish near-instantly
            const progress = await getReembedProgress(pid);
            setReembed(progress);
            if (!progress.active) {
                loadData();
            }
        } catch { /* ignore */ }
    }, [pid, loadData]);
    const handleSelectModelWithStats = useCallback(async (modelId: string) => {
        try {
            await selectEmbeddingModel(modelId);
            const [updated, updatedStats] = await Promise.all([
                listEmbeddingModels(),
                pid ? getMemoryStats(pid) : Promise.resolve(stats),
            ]);
            setModels(updated);
            setStats(updatedStats);
        } catch { /* ignore */ }
    }, [pid, stats]);

    /* ─── Render ──────────────────────────────────────────────────────── */
    return (
        <div className="max-w-[2400px] mx-auto px-8 md:px-20 py-16 flex flex-col gap-8 relative z-10">

            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.04)_0%,transparent_70%)]
                               dark:bg-[radial-gradient(ellipse_70%_50%_at_50%_40%,rgba(0,224,160,0.06)_0%,transparent_70%)]" />
            </div>

            {/* ── Header ──────────────────────────────────────────────── */}
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
                    <div className="flex items-center gap-2.5">
                        {TIER_TABS.map(tab => {
                            const count = tab.key === "short_term"
                                ? (stats.sprint + stats.agent)
                                : stats.project;
                            return (
                                <span key={tab.key} className={`text-[10px] font-bold font-mono px-3.5 py-1.5 rounded-full cursor-pointer transition-all duration-200
                                    ${activeTier === tab.key
                                        ? "bg-signal-500/[0.12] border border-signal-500/30 text-signal-500"
                                        : "bg-black/[0.04] dark:bg-white/[0.04] border border-transparent text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                                    }`}
                                    onClick={() => setActiveTier(tab.key)}>
                                    {tab.label} · {count}
                                </span>
                            );
                        })}
                    </div>
                    <div className="flex items-center gap-2.5">
                        {/* Sprint selector — only for Short Term */}
                        {activeTier === "short_term" && sprints.length > 0 && (
                            <select
                                value={selectedSprintId ?? ""}
                                onChange={(e) => setSelectedSprintId((e.target as HTMLSelectElement).value || undefined)}
                                className="text-[11px] font-mono font-bold px-3 py-1.5 rounded-lg
                                           bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08]
                                           text-slate-600 dark:text-slate-300 cursor-pointer
                                           focus:outline-none focus:border-signal-500/40">
                                {sprints.map(s => (
                                    <option key={s.id} value={s.id}>
                                        Sprint {s.number ?? "?"} — {s.name || s.goal?.slice(0, 40) || s.id.slice(0, 8)}
                                    </option>
                                ))}
                            </select>
                        )}
                        {/* Agent selector — both tiers */}
                        {agentPresets.length > 0 && (
                            <select
                                value={selectedAgentPresetId ?? ""}
                                onChange={(e) => setSelectedAgentPresetId((e.target as HTMLSelectElement).value || undefined)}
                                className="text-[11px] font-mono font-bold px-3 py-1.5 rounded-lg
                                           bg-black/[0.04] dark:bg-white/[0.04] border border-black/[0.08] dark:border-white/[0.08]
                                           text-slate-600 dark:text-slate-300 cursor-pointer
                                           focus:outline-none focus:border-signal-500/40">
                                <option value="">All Agents</option>
                                {agentPresets.map(a => (
                                    <option key={a.id} value={a.id}>{a.name}</option>
                                ))}
                            </select>
                        )}
                    </div>
                    <div className="flex items-center gap-2.5">
                        <button onClick={() => setShowAddModal(true)}
                            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold
                                       bg-signal-500/10 text-signal-500 hover:bg-signal-500/20
                                       border border-signal-500/20
                                       transition-colors duration-200">
                            <Plus className="w-3.5 h-3.5" strokeWidth={2.5} /> Add Memory
                        </button>
                        <button onClick={() => setShowModels(v => !v)}
                            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold
                                       border transition-colors duration-200
                                       ${showModels
                                           ? "bg-signal-500/[0.12] border-signal-500/30 text-signal-500"
                                           : "bg-black/[0.04] dark:bg-white/[0.04] border-black/[0.06] dark:border-white/[0.06] text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                       }`}>
                            <HardDrive className="w-3.5 h-3.5" strokeWidth={2} />
                            Models
                            {stats.activeModel && (
                                <span className="w-1.5 h-1.5 rounded-full bg-signal-500" />
                            )}
                        </button>
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
                    </div>
                </div>
            </div>

            {/* ── Model Management ────────────────────────────────────── */}
            {showModels && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {models.map(model => (
                        <ModelCard key={model.id} model={model}
                            onDownload={handleDownloadModel}
                            onSelect={handleSelectModelWithStats}
                            onDelete={handleDeleteModel}
                            onReembed={handleReembed}
                            reembedding={!!reembed?.active}
                            staleCount={stats.staleEmbeddings} />
                    ))}
                    {models.length === 0 && (
                        <p className="text-sm text-slate-400 font-medium col-span-2 text-center py-8">
                            Loading embedding models…
                        </p>
                    )}
                </div>
            )}

            {/* ── Re-embed banner ─────────────────────────────────────── */}
            {showModels && stats.staleEmbeddings > 0 && !reembed?.active && (
                <div className="flex items-center gap-4 px-5 py-4 rounded-2xl
                               bg-amber-500/[0.06] border border-amber-500/20
                               dark:bg-amber-500/[0.04] dark:border-amber-400/15">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" strokeWidth={2.5} />
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-amber-600 dark:text-amber-400">
                            {stats.staleEmbeddings} {stats.staleEmbeddings === 1 ? "memory needs" : "memories need"} re-embedding
                        </p>
                        <p className="text-[10px] text-amber-600/70 dark:text-amber-400/60 mt-0.5">
                            These memories were embedded with a different model and won't appear in semantic search until re-embedded.
                        </p>
                    </div>
                    <button onClick={handleReembed}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[11px] font-bold shrink-0
                                   bg-amber-500 text-white hover:bg-amber-600
                                   transition-colors duration-200 shadow-[0_2px_8px_rgba(245,158,11,0.25)]">
                        <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
                        Re-embed All
                    </button>
                </div>
            )}

            {/* ── Re-embed progress ───────────────────────────────────── */}
            {showModels && reembed?.active && (
                <div className="flex flex-col gap-3 px-5 py-4 rounded-2xl
                               bg-signal-500/[0.06] border border-signal-500/20
                               dark:bg-signal-500/[0.04] dark:border-signal-500/15">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <RefreshCw className="w-3.5 h-3.5 text-signal-500 animate-spin" strokeWidth={2.5} />
                            <span className="text-xs font-bold text-signal-600 dark:text-signal-400">Re-embedding memories…</span>
                        </div>
                        <span className="text-[10px] font-mono text-signal-500">
                            {reembed.completed}/{reembed.total}
                        </span>
                    </div>
                    <div className="h-2 w-full bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-signal-500 transition-all duration-500 ease-out"
                            style={{ width: `${reembed.total > 0 ? Math.round((reembed.completed / reembed.total) * 100) : 0}%` }} />
                    </div>
                </div>
            )}

            {/* ── Re-embed complete ───────────────────────────────────── */}
            {showModels && reembed && !reembed.active && reembed.completed > 0 && stats.staleEmbeddings === 0 && (
                <div className="flex items-center gap-3 px-5 py-3 rounded-2xl
                               bg-signal-500/[0.06] border border-signal-500/20">
                    <Check className="w-4 h-4 text-signal-500" strokeWidth={2.5} />
                    <p className="text-xs font-bold text-signal-600 dark:text-signal-400">
                        Re-embedding complete — {reembed.completed} {reembed.completed === 1 ? "memory" : "memories"} updated.
                    </p>
                </div>
            )}

            {/* ── Lobotomize warning ──────────────────────────────────── */}
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

            {/* ── Neural Canvas ───────────────────────────────────────── */}
            <div
                ref={wrapRef}
                className="relative w-full rounded-[2rem] overflow-hidden
                           bg-white/50 dark:bg-void-800/40 backdrop-blur-2xl
                           border border-black/[0.05] dark:border-white/[0.05]
                           shadow-[0_8px_48px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.4)]"
                style={{ height: "max(600px, calc(100vh - 440px))" }}
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
                    {Object.entries(CAT).map(([, cfg]) => (
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
                        {memoryCount} nodes
                    </span>
                </div>

                {/* Empty state */}
                {!loading && memoryCount === 0 && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none z-20">
                        <Brain className="w-12 h-12 text-signal-500/20" strokeWidth={1.5} />
                        <p className="text-lg font-black font-display tracking-tight text-slate-400/60">
                            No memories yet
                        </p>
                        <p className="text-xs font-mono text-slate-400/50">
                            Memories will appear here as sprints capture them, or add one manually.
                        </p>
                    </div>
                )}

                {loading && (
                    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                        <Loader2 className="w-8 h-8 text-signal-500/40 animate-spin" strokeWidth={1.5} />
                    </div>
                )}

                {/* Inspector panel */}
                <Inspector
                    node={selectedNode}
                    allNodes={S.current.graph.nodes}
                    edges={S.current.graph.edges}
                    lobotomize={lobotomize}
                    onClose={() => { S.current.selectedIdx = -1; setSelectedNode(null); }}
                    onDelete={handleDelete}
                />
            </div>

            {/* ── Category summary ────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {Object.entries(CAT).map(([key, cfg]) => {
                    const alive = S.current.graph.nodes.filter(n => n.category === key && n.alive).length;
                    const total = records.filter(r => r.category === key).length;
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

            {/* ── Add Memory Modal ────────────────────────────────────── */}
            <AddMemoryModal
                open={showAddModal}
                scope={activeScope}
                projectId={pid}
                onClose={() => setShowAddModal(false)}
                onCreated={loadData}
            />
        </div>
    );
};
