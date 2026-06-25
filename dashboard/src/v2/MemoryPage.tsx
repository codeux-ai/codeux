import { useMemoryPageData } from "./hooks/use-memory-page-data.js";
import { useEmbeddingModelStatus } from "./hooks/use-embedding-model-status.js";
import { ModelCard } from "./components/memory/ModelCard.js";
import { effect } from "@preact/signals";
import { Inspector } from "./components/memory/Inspector.js";
import { MemoryFilters, MemoryDetails, MemoryCard } from "./components/memory/index.js";
import MemorySidebar from "./components/memory/MemorySidebar.js";
import { memorySidebarExpandedSignal, searchQuerySignal, activeMemoryIdSignal, hoveredMemoryIdSignal, activeTierSignal, selectedSprintIdSignal, selectedAgentPresetIdSignal } from "./components/memory/memoryState.js";

import { AddMemoryModal } from "./components/memory/AddMemoryModal.js";
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState, useCallback, useEffect } from "preact/hooks";
import gsap from "gsap";
import { Brain, Search, X, AlertTriangle, Save, Check, RotateCcw, ZoomIn, ZoomOut, Maximize2, Plus, Download, Trash2, Power, Loader2, HardDrive, RefreshCw } from "lucide-preact";
import { listMemories, createMemory, deleteMemory as apiDeleteMemory, searchMemories, listEmbeddingModels, downloadEmbeddingModel, selectEmbeddingModel, deleteEmbeddingModel, getMemoryStats, startReembed, getReembedProgress, getEmbeddingMap, type EmbeddingModelWithStatus, type ReembedProgress, type EmbeddingMapResult } from "./lib/memory-api.js";
import type { MemoryRecord, MemoryScope, MemoryCategory } from "./memory-types.js";
import { useProjectData } from "./context/project-data.js";
import { useSprints } from "../hooks/useSprints.js";
import { fetchAgentPresets } from "./lib/agent-preset-api.js";
import { prepareMemoryGraph, type MemNode, type Edge, type GraphMetadata, CLUSTER } from "./lib/memory-graph.js";
import type { SprintRecord, AgentPreset } from "./types.js";
import { PageContainer } from "./components/layout/PageContainer.js";

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface Pulse { edgeIdx: number; progress: number; speed: number }

/* ─── Config ─────────────────────────────────────────────────────────────── */

const CAT: Record<string, { label: string; hex: string; r: number; g: number; b: number }> = {
    architecture: { label: "Architecture", hex: "#00E0A0", r: 0,   g: 224, b: 160 },
    codebase:     { label: "Codebase",     hex: "#FFB800", r: 255, g: 184, b: 0   },
    context:      { label: "Context",      hex: "#8B5CF6", r: 139, g: 92,  b: 246 },
    preferences:  { label: "Preferences",  hex: "#94A3B8", r: 148, g: 163, b: 184 },
    patterns:     { label: "Patterns",     hex: "#F59E0B", r: 245, g: 158, b: 11  },
    decision:     { label: "Decision",     hex: "#64748B", r: 100, g: 116, b: 139 },
    error:        { label: "Error",        hex: "#F43F5E", r: 244, g: 63,  b: 94  },
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

/* ─── Memory Page ────────────────────────────────────────────────────────── */

export const MemoryPage: FunctionComponent = () => {
    const { selectedProject } = useProjectData();
    const pid = selectedProject?.id || "";
    const headerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        return effect(() => {
            memorySidebarExpandedSignal.value;
            if (canvasRef.current) {
                window.dispatchEvent(new Event("resize"));
            }
        });
    }, []);

    useEffect(() => {
        return effect(() => {
            const hId = hoveredMemoryIdSignal.value;
            const idx = hId ? S.current.graph.nodes.findIndex(n => n.id === hId) : -1;
            S.current.hoveredIdx = idx;
        });
    }, []);

    const [lobotomize, setLobotomize] = useState(false);


        const [deletedCount, setDeletedCount] = useState(0);
    const activeTier = activeTierSignal.value;
    const activeScope: MemoryScope = activeTier === "short_term" ? "sprint" : "project";
    const [showModels, setShowModels] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);

    // Sprint / agent filter state
    const { data: projectSprints } = useSprints(pid || null);
    const sprints = projectSprints as SprintRecord[];
    const [agentPresets, setAgentPresets] = useState<AgentPreset[]>([]);
    const selectedSprintId = selectedSprintIdSignal.value;
    const selectedAgentPresetId = selectedAgentPresetIdSignal.value;
    const effectiveSelectedSprintId = activeTier === "short_term"
        ? (selectedSprintId || sprints[0]?.id)
        : undefined;
    const memoryDataEnabled = activeTier !== "short_term" || !!effectiveSelectedSprintId;

    const {
        loading,
        records,
        memoryCount,
        setMemoryCount,
        initialModels,
        initialStats,
        graphData,
        loadData
    } = useMemoryPageData(pid, activeScope, activeTier, effectiveSelectedSprintId, selectedAgentPresetId, memoryDataEnabled);

    const {
        models,
        setModels,
        stats,
        setStats,
        reembed,
        setReembed
    } = useEmbeddingModelStatus(pid, initialModels, initialStats, loadData);

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

    /* ── Fetch agent presets on project change ─────────────── */
    useEffect(() => {
        if (!pid) return;
        fetchAgentPresets(pid).catch(() => [] as AgentPreset[]).then((presetsData) => {
            setAgentPresets(presetsData);
        });
    }, [pid]);

    useEffect(() => {
        if (activeTier !== "short_term" || selectedSprintId || sprints.length === 0) {
            return;
        }
        selectedSprintIdSignal.value = (sprints[0]!.id);
    }, [activeTier, selectedSprintId, sprints]);


    useEffect(() => {
        if (!graphData) return;
        const s = S.current;
        s.embeddingMap = graphData.map;
        s.graph = graphData.graph;
        s.pulses = s.graph.edges.map((_, i) => ({ edgeIdx: i, progress: Math.random(), speed: 0.002 + Math.random() * 0.003 }));
        s.selectedIdx = -1;
        s.searchMatch = null;
        activeMemoryIdSignal.value = null;

        const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        // Animate entrance
        if (prefersReducedMotion) {
            s.cam.x = 0;
            s.cam.y = 0;
            s.cam.zoom = 1;
            s.graph.nodes.forEach(node => {
                node.x = node.targetX;
                node.y = node.targetY;
                node.scale = 1;
                node.opacity = 1;
            });
            s.entranceDone = true;
        } else {
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

            return () => {
                tl.kill();
                gsap.killTweensOf(s.cam);
                s.graph.nodes.forEach(node => gsap.killTweensOf(node));
            };
        }
    }, [graphData]);

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
                const glAlpha = (n.glow * 0.12 + (isHov ? 0.18 : 0) + (isSel ? 0.15 : 0)) * effOpacity;
                const gl = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glR);
                gl.addColorStop(0, lob ? `rgba(227,0,15,${glAlpha})` : `rgba(${cc.r},${cc.g},${cc.b},${glAlpha})`);
                gl.addColorStop(1, "transparent");
                ctx.fillStyle = gl;
                ctx.beginPath();
                ctx.arc(n.x, n.y, glR, 0, Math.PI * 2);
                ctx.fill();

                ctx.beginPath();
                ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
                const bodyAlpha = isHov || isSel
                    ? Math.min(1, (0.75 + n.strength * 0.45) * effOpacity)
                    : (0.65 + n.strength * 0.35) * effOpacity;
                ctx.fillStyle = lob
                    ? `rgba(227,0,15,${bodyAlpha})`
                    : `rgba(${cc.r},${cc.g},${cc.b},${bodyAlpha})`;
                if (isHov || isSel) {
                    ctx.shadowBlur = isSel ? 28 : 22;
                    ctx.shadowColor = lob ? "rgba(227,0,15,0.8)" : `rgba(${cc.r},${cc.g},${cc.b},0.8)`;
                }
                ctx.fill();
                ctx.shadowBlur = 0;

                if (isSel) {
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
                    ctx.strokeStyle = lob
                        ? "rgba(227,0,15,0.6)"
                        : `rgba(${cc.r},${cc.g},${cc.b},0.6)`;
                    ctx.lineWidth = 2.0;
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
                    activeMemoryIdSignal.value = s.graph.nodes[idx].id;
                    gsap.to(s.cam, { x: s.graph.nodes[idx].x, y: s.graph.nodes[idx].y, zoom: 1.4, duration: 1, ease: "power3.out", overwrite: true });
                } else {
                    s.selectedIdx = -1;
                    activeMemoryIdSignal.value = null;
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

        let headerCtx: any;
        if (headerRef.current) {
            headerCtx = gsap.context(() => {
                gsap.fromTo(
                    Array.from(headerRef.current!.children),
                    { opacity: 0, y: 40 },
                    { opacity: 1, y: 0, stagger: 0.08, duration: 0.9, ease: "power4.out", delay: 0.05 },
                );
            });
        }

        return () => {
            cancelAnimationFrame(s.rafId);
            clearTimeout(s.neuronTimer);
            window.removeEventListener("resize", resize);
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mousedown", onDown);
            canvas.removeEventListener("mouseup", onUp);
            canvas.removeEventListener("wheel", onWheel);
            if (headerCtx) headerCtx.revert();
            gsap.killTweensOf(s.cam);
            s.graph.nodes.forEach(node => gsap.killTweensOf(node));
        };
    }, []);

    /* ── Search ────────────────────────────────────────────────────────── */
    const handleSearch = useCallback(async (q: string) => {
        searchQuerySignal.value = q;

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
                if (s.selectedIdx === idx) { s.selectedIdx = -1; activeMemoryIdSignal.value = null; }
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
        activeMemoryIdSignal.value = null;
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

        const onSelectNode = useCallback((idx: number) => {
        const s = S.current;
        if (idx >= 0 && idx < s.graph.nodes.length) {
            s.selectedIdx = idx;
            activeMemoryIdSignal.value = s.graph.nodes[idx].id;
            gsap.to(s.cam, { x: s.graph.nodes[idx].x, y: s.graph.nodes[idx].y, zoom: 1.4, duration: 1, ease: "power3.out", overwrite: true });
        } else {
            S.current.selectedIdx = -1;
            activeMemoryIdSignal.value = null;
        }
    }, []);

    /* ─── Render ──────────────────────────────────────────────────────── */
    return (
        <PageContainer aria-label="Memory" padding="section" className="gap-8">

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

                <MemoryFilters
                    stats={stats}
                    sprints={sprints}
                    agentPresets={agentPresets}
                    showModels={showModels}
                    setShowModels={setShowModels}
                    setShowAddModal={setShowAddModal}
                    lobotomize={lobotomize}
                    handleLobotomizeToggle={handleLobotomizeToggle}
                />
            </div>

            {/* ── Model Management ────────────────────────────────────── */}
            {showModels && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {models.map((model: EmbeddingModelWithStatus) => (
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
                        <span className="uppercase tracking-[0.14em]">Warning — Lobotomize mode active.</span>
                        {" "}Click any node then use the inspector to excise memories permanently.
                    </p>
                </div>
            )}

            {/* ── Neural Canvas ───────────────────────────────────────── */}
            <div
                className="flex w-full overflow-hidden rounded-[2rem]
                           bg-white/50 dark:bg-void-800/40 backdrop-blur-2xl
                           border border-black/[0.05] dark:border-white/[0.05]
                           shadow-[0_8px_48px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_48px_rgba(0,0,0,0.4)]"
                style={{ height: "max(600px, calc(100vh - 440px))" }}
            >
                <div ref={wrapRef} className="flex-1 relative overflow-hidden">
                    <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

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
                                       text-slate-500 hover:text-signal-500 hover:border-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 dark:hover:text-signal-400
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
                <MemoryDetails
                    allNodes={S.current.graph.nodes}
                    edges={S.current.graph.edges}
                    lobotomize={lobotomize}
                    onClose={() => { S.current.selectedIdx = -1; activeMemoryIdSignal.value = null; }}
                    onDelete={handleDelete}
                />
                </div>

                <MemorySidebar
                    nodes={S.current.graph.nodes}
                    onSelectNode={onSelectNode}
                />
            </div>

            {/* ── Category summary ────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {Object.entries(CAT).map(([key, cfg]) => {
                    const alive = S.current.graph.nodes.filter(n => n.category === key && n.alive).length;
                    const total = records.filter((r: MemoryRecord) => r.category === key).length;
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
        </PageContainer>
    );
};
