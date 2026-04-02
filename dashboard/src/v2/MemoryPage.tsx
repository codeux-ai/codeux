import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { Brain, Search, X, AlertTriangle, Save, Check, RotateCcw, ZoomIn, ZoomOut, Maximize2, Plus, Download, Trash2, Power, Loader2, HardDrive, RefreshCw } from "lucide-preact";
import { createMemory, type EmbeddingModelWithStatus } from "./lib/memory-api.js";
import type { MemoryScope, MemoryCategory } from "./memory-types.js";
import { useProjectData } from "./context/project-data.js";
import { CAT, type MemNode, type Edge } from "./lib/memory-graph.js";

import { useMemoryPageData } from "./hooks/use-memory-page-data.js";
import { useMemoryGraphCanvas } from "./hooks/use-memory-graph-canvas.js";

/* ─── Config ─────────────────────────────────────────────────────────────── */

const TIER_TABS: { key: "short_term" | "long_term"; label: string; scope: MemoryScope }[] = [
    { key: "short_term", label: "Short Term", scope: "sprint" },
    { key: "long_term",  label: "Long Term",  scope: "project" },
];

const CATEGORIES: MemoryCategory[] = ["architecture", "codebase", "context", "preferences", "patterns", "decision", "error", "learning"];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

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
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-signal-500 bg-signal-500/10 px-2 py-0.5 rounded-full">Active</span>
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
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Strength</span>
                            <div className="flex items-center gap-2">
                                <div className="w-20 h-1.5 rounded-full bg-black/[0.06] dark:bg-white/[0.06] overflow-hidden">
                                    <div className="h-full rounded-full transition-all duration-700"
                                        style={{ width: `${node.strength * 100}%`, background: cat.hex }} />
                                </div>
                                <span className="text-[10px] font-mono text-slate-400">{Math.round(node.strength * 100)}%</span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">ID</span>
                            <span className="text-[11px] font-mono text-slate-400">{node.id.slice(0, 8)}…</span>
                        </div>
                    </div>
                    {connected.length > 0 && (
                        <div className="flex flex-col gap-2 pt-3 border-t border-black/[0.06] dark:border-white/[0.06]">
                            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
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
                           shadow-[0_20px_60px_rgba(0,0,0,0.1)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Brain className="w-4 h-4 text-signal-500" /> Implant Memory
                    </h3>
                    <button onClick={onClose} className="w-6 h-6 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-500 transition-colors">
                        <X className="w-3 h-3" />
                    </button>
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Content</label>
                    <textarea
                        value={content}
                        onInput={e => setContent((e.target as HTMLTextAreaElement).value)}
                        placeholder="Memory content…"
                        className="w-full h-24 p-3 rounded-xl text-sm bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] focus:outline-none focus:border-signal-500/50 resize-none dashboard-scrollbar"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Category</label>
                        <select
                            value={category}
                            onChange={e => setCategory((e.target as HTMLSelectElement).value as MemoryCategory)}
                            className="w-full p-2.5 rounded-xl text-xs font-medium bg-black/[0.02] dark:bg-white/[0.02] border border-black/[0.06] dark:border-white/[0.06] focus:outline-none focus:border-signal-500/50">
                            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Strength ({Math.round(strength * 100)}%)</label>
                        <input
                            type="range" min="0.1" max="1" step="0.1"
                            value={strength}
                            onInput={e => setStrength(parseFloat((e.target as HTMLInputElement).value))}
                            className="w-full mt-2 accent-signal-500"
                        />
                    </div>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-black/[0.06] dark:border-white/[0.06]">
                    <span className="text-[9px] font-mono text-slate-400 px-2 py-1 rounded bg-black/5 dark:bg-white/5">Scope: {scope}</span>
                    <button onClick={handleSubmit} disabled={saving || !content.trim()}
                        className="px-4 py-2 rounded-xl text-xs font-bold bg-signal-500 text-void-900 hover:bg-signal-400
                                   transition-colors duration-200 disabled:opacity-50">
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

    const [showModels, setShowModels] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);

    const {
        state: {
            loading, records, models, stats, reembed, embeddingMap, sprints, agentPresets, activeTier, activeScope, selectedSprintId, selectedAgentPresetId
        },
        actions: {
            setActiveTier, setSelectedSprintId, setSelectedAgentPresetId, loadData, handleReembed, handleDeleteRecord, setModels, setStats
        }
    } = useMemoryPageData(pid);

    const {
        state: {
            lobotomize, selectedNode, searchQuery, memoryCount, deletedCount, graphState
        },
        actions: {
            setSelectedNode, handleSearch, handleLobotomizeToggle, handleDelete, zoomIn, zoomOut, zoomReset
        }
    } = useMemoryGraphCanvas(canvasRef, wrapRef, records, embeddingMap, handleDeleteRecord);

    const handleDownloadModel = async (modelId: string) => {
        try {
            const { downloadEmbeddingModel, listEmbeddingModels } = await import("./lib/memory-api.js");
            await downloadEmbeddingModel(modelId);
            const updated = await listEmbeddingModels();
            setModels(updated);
        } catch { /* ignore */ }
    };

    const handleSelectModelWithStats = async (modelId: string) => {
        try {
            const { selectEmbeddingModel, listEmbeddingModels, getMemoryStats } = await import("./lib/memory-api.js");
            await selectEmbeddingModel(modelId);
            const [updated, updatedStats] = await Promise.all([
                listEmbeddingModels(),
                pid ? getMemoryStats(pid) : Promise.resolve(stats),
            ]);
            setModels(updated);
            setStats(updatedStats);
        } catch { /* ignore */ }
    };

    const handleDeleteModel = async (modelId: string) => {
        try {
            const { deleteEmbeddingModel, listEmbeddingModels } = await import("./lib/memory-api.js");
            await deleteEmbeddingModel(modelId);
            const updated = await listEmbeddingModels();
            setModels(updated);
        } catch { /* ignore */ }
    };

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
                               bg-signal-500/[0.06] border border-signal-500/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-signal-600 dark:text-signal-400 font-bold text-xs">
                            <RefreshCw className="w-4 h-4 animate-spin" strokeWidth={2.5} />
                            Re-embedding memories…
                        </div>
                        <span className="text-[10px] font-mono text-signal-600 dark:text-signal-400">
                            {reembed.completed} / {reembed.total}
                        </span>
                    </div>
                    <div className="w-full h-1.5 bg-black/[0.06] dark:bg-white/[0.06] rounded-full overflow-hidden">
                        <div className="h-full bg-signal-500 rounded-full transition-all duration-300"
                            style={{ width: `${reembed.total > 0 ? (reembed.completed / reembed.total) * 100 : 0}%` }} />
                    </div>
                </div>
            )}

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
                        <span className="uppercase tracking-[0.14em]">Warning — Lobotomize mode active.</span>
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
                            <span className="text-[9px] font-bold uppercase tracking-[0.14em]
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
                    allNodes={graphState.current.graph.nodes}
                    edges={graphState.current.graph.edges}
                    lobotomize={lobotomize}
                    onClose={() => { graphState.current.selectedIdx = -1; setSelectedNode(null); }}
                    onDelete={handleDelete}
                />
            </div>

            {/* ── Category summary ────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {Object.entries(CAT).map(([key, cfg]) => {
                    const alive = graphState.current.graph.nodes.filter(n => n.category === key && n.alive).length;
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
