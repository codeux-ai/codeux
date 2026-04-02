import { useRef, useState, useCallback, useLayoutEffect, useEffect } from "preact/hooks";
import gsap from "gsap";
import { prepareMemoryGraph, type MemNode, type Edge, type GraphMetadata, CAT, quadAt, bezierCtrl, hitTest } from "../lib/memory-graph.js";
import type { MemoryRecord } from "../memory-types.js";
import type { EmbeddingMapResult } from "../lib/memory-api.js";

interface Pulse { edgeIdx: number; progress: number; speed: number }

export function useMemoryGraphCanvas(
    canvasRef: preact.RefObject<HTMLCanvasElement>,
    wrapRef: preact.RefObject<HTMLDivElement>,
    records: MemoryRecord[],
    embeddingMap: EmbeddingMapResult | null,
    onDeleteRecord: (id: string) => Promise<void>
) {
    const [lobotomize, setLobotomize] = useState(false);
    const [selectedNode, setSelectedNode] = useState<MemNode | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [memoryCount, setMemoryCount] = useState(0);
    const [deletedCount, setDeletedCount] = useState(0);

    const S = useRef({
        graph: { nodes: [], edges: [], catCentroids: {} } as GraphMetadata,
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

    // Whenever records or embeddingMap change, update graph state and trigger entrance
    useEffect(() => {
        const s = S.current;
        s.graph = prepareMemoryGraph(records, embeddingMap);
        s.pulses = s.graph.edges.map((_, i) => ({ edgeIdx: i, progress: Math.random(), speed: 0.002 + Math.random() * 0.003 }));
        s.selectedIdx = -1;
        s.searchMatch = null;
        setSelectedNode(null);
        setMemoryCount(s.graph.nodes.length);

        // Ensure we trigger search updates if there's an active query
        if (searchQuery) {
            handleSearch(searchQuery);
        }

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [records, embeddingMap]);

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
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
            const w = canvas!.width / dpr;
            const h = canvas!.height / dpr;
            const dark = document.documentElement.classList.contains("dark");
            const { cam, graph, pulses, hoveredIdx, selectedIdx } = s;
            const { nodes, edges, catCentroids } = graph;
            const lob = lobRef.current;

            ctx!.clearRect(0, 0, w, h);

            const scx = w / 2, scy = h / 2;
            const glowR = 380 * cam.zoom;
            const coreRGB = lob ? "227,0,15" : "0,224,160";
            const bg = ctx!.createRadialGradient(scx, scy, 0, scx, scy, glowR);
            bg.addColorStop(0, `rgba(${coreRGB},${dark ? 0.07 : 0.035})`);
            bg.addColorStop(1, "transparent");
            ctx!.fillStyle = bg;
            ctx!.fillRect(0, 0, w, h);

            ctx!.save();
            ctx!.translate(w / 2, h / 2);
            ctx!.scale(cam.zoom, cam.zoom);
            ctx!.translate(-cam.x, -cam.y);

            for (const [cat, centroid] of Object.entries(catCentroids)) {
                const c = CAT[cat];
                if (!c || centroid.count === 0) continue;
                const haloR = Math.max(80, centroid.radius + 50);
                const halo = ctx!.createRadialGradient(centroid.x, centroid.y, 0, centroid.x, centroid.y, haloR);
                const a = lob ? 0.015 : (dark ? 0.04 : 0.02);
                halo.addColorStop(0, `rgba(${c.r},${c.g},${c.b},${a})`);
                halo.addColorStop(1, "transparent");
                ctx!.fillStyle = halo;
                ctx!.beginPath();
                ctx!.arc(centroid.x, centroid.y, haloR, 0, Math.PI * 2);
                ctx!.fill();
            }

            if (cam.zoom > 0.55) {
                ctx!.textAlign = "center";
                ctx!.textBaseline = "middle";
                for (const [cat, centroid] of Object.entries(catCentroids)) {
                    const c = CAT[cat];
                    if (!c || centroid.count === 0) continue;
                    ctx!.font = `700 ${11}px "Plus Jakarta Sans", sans-serif`;
                    ctx!.fillStyle = lob
                        ? `rgba(227,0,15,${dark ? 0.2 : 0.12})`
                        : `rgba(${c.r},${c.g},${c.b},${dark ? 0.25 : 0.15})`;
                    ctx!.fillText(c.label.toUpperCase(), centroid.x, centroid.y);
                }
            }

            for (const node of nodes) {
                if (!node.alive || node.opacity < 0.05) continue;
                ctx!.beginPath();
                ctx!.moveTo(0, 0);
                ctx!.lineTo(node.x, node.y);
                const cc = CAT[node.category] || CAT.context;
                const a = (0.015 + node.strength * 0.015) * node.opacity;
                ctx!.strokeStyle = lob
                    ? `rgba(227,0,15,${a})`
                    : `rgba(${cc.r},${cc.g},${cc.b},${a})`;
                ctx!.lineWidth = 0.4;
                ctx!.stroke();
            }

            for (let ei = 0; ei < edges.length; ei++) {
                const { a, b, similarity } = edges[ei];
                const na = nodes[a], nb = nodes[b];
                if (!na || !nb || !na.alive || !nb.alive || na.opacity < 0.05 || nb.opacity < 0.05) continue;
                const cp = bezierCtrl(na.x, na.y, nb.x, nb.y, ei);
                const simAlpha = similarity * 0.35;
                const alpha = Math.max(0.03, simAlpha) * Math.min(na.opacity, nb.opacity);
                const ca = CAT[na.category] || CAT.context;
                const cb = CAT[nb.category] || CAT.context;
                const mr = Math.round((ca.r + cb.r) / 2);
                const mg = Math.round((ca.g + cb.g) / 2);
                const mb = Math.round((ca.b + cb.b) / 2);
                ctx!.beginPath();
                ctx!.moveTo(na.x, na.y);
                ctx!.quadraticCurveTo(cp.cx, cp.cy, nb.x, nb.y);
                ctx!.strokeStyle = lob
                    ? `rgba(227,0,15,${alpha})`
                    : `rgba(${mr},${mg},${mb},${alpha})`;
                ctx!.lineWidth = 0.5 + similarity * 1.5;
                ctx!.stroke();
            }

            if (s.entranceDone) {
                ctx!.shadowBlur = 10;
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
                    ctx!.shadowColor = lob ? "rgba(227,0,15,0.5)" : `rgba(${mr},${mg},${mb},0.5)`;
                    ctx!.beginPath();
                    ctx!.arc(px, py, 1.5 + edge.similarity, 0, Math.PI * 2);
                    ctx!.fillStyle = pColor;
                    ctx!.fill();
                    p.progress += p.speed;
                    if (p.progress > 1) p.progress -= 1;
                }
                ctx!.shadowBlur = 0;
            }

            const pulse = 0.5 + Math.sin(time * 0.002) * 0.25;
            for (let i = 0; i < 4; i++) {
                const ringR = 22 + i * 18 + Math.sin(time * 0.001 + i * 1.8) * 4;
                ctx!.beginPath();
                ctx!.arc(0, 0, ringR, 0, Math.PI * 2);
                const ra = (0.07 - i * 0.012) * pulse;
                ctx!.strokeStyle = lob ? `rgba(227,0,15,${ra})` : `rgba(0,224,160,${ra})`;
                ctx!.lineWidth = 0.8;
                ctx!.stroke();
            }

            const coreGrad = ctx!.createRadialGradient(0, 0, 0, 0, 0, 18);
            coreGrad.addColorStop(0, `rgba(${coreRGB},${0.85 * pulse})`);
            coreGrad.addColorStop(0.4, `rgba(${coreRGB},${0.25 * pulse})`);
            coreGrad.addColorStop(1, `rgba(${coreRGB},0)`);
            ctx!.fillStyle = coreGrad;
            ctx!.beginPath();
            ctx!.arc(0, 0, 18, 0, Math.PI * 2);
            ctx!.fill();

            ctx!.beginPath();
            ctx!.arc(0, 0, 3.5, 0, Math.PI * 2);
            ctx!.fillStyle = lob ? "#E3000F" : "#00E0A0";
            ctx!.shadowBlur = 18;
            ctx!.shadowColor = lob ? "rgba(227,0,15,0.8)" : "rgba(0,224,160,0.8)";
            ctx!.fill();
            ctx!.shadowBlur = 0;

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
                const gl = ctx!.createRadialGradient(n.x, n.y, 0, n.x, n.y, glR);
                gl.addColorStop(0, lob ? `rgba(227,0,15,${glAlpha})` : `rgba(${cc.r},${cc.g},${cc.b},${glAlpha})`);
                gl.addColorStop(1, "transparent");
                ctx!.fillStyle = gl;
                ctx!.beginPath();
                ctx!.arc(n.x, n.y, glR, 0, Math.PI * 2);
                ctx!.fill();

                ctx!.beginPath();
                ctx!.arc(n.x, n.y, r, 0, Math.PI * 2);
                const bodyAlpha = (0.65 + n.strength * 0.35) * effOpacity;
                ctx!.fillStyle = lob
                    ? `rgba(227,0,15,${bodyAlpha})`
                    : `rgba(${cc.r},${cc.g},${cc.b},${bodyAlpha})`;
                if (isHov || isSel) {
                    ctx!.shadowBlur = 22;
                    ctx!.shadowColor = lob ? "rgba(227,0,15,0.6)" : cc.hex;
                }
                ctx!.fill();
                ctx!.shadowBlur = 0;

                if (isSel) {
                    ctx!.beginPath();
                    ctx!.arc(n.x, n.y, r + 5, 0, Math.PI * 2);
                    ctx!.strokeStyle = lob
                        ? "rgba(227,0,15,0.4)"
                        : `rgba(${cc.r},${cc.g},${cc.b},0.4)`;
                    ctx!.lineWidth = 1.5;
                    ctx!.setLineDash([4, 4]);
                    ctx!.stroke();
                    ctx!.setLineDash([]);
                }

                if (cam.zoom > 0.65 && !dimmed) {
                    const label = n.content.length > 28 ? n.content.slice(0, 28) + "…" : n.content;
                    ctx!.font = `600 ${10}px "Plus Jakarta Sans", sans-serif`;
                    ctx!.textAlign = "left";
                    ctx!.textBaseline = "middle";
                    ctx!.fillStyle = dark
                        ? `rgba(255,255,255,${0.55 * effOpacity})`
                        : `rgba(0,0,0,${0.45 * effOpacity})`;
                    ctx!.fillText(label, n.x + r + 10, n.y);
                }

                if (s.entranceDone && n.alive) {
                    const breath = 1 + Math.sin(time * 0.0015 + i * 1.2) * 0.04;
                    if (n.scale > 0.95 && n.scale < 1.1) n.scale = breath;
                }
            }

            ctx!.restore();

            ctx!.textAlign = "center";
            ctx!.font = `700 9px "JetBrains Mono", monospace`;
            ctx!.fillStyle = lob ? "rgba(227,0,15,0.5)" : "rgba(0,224,160,0.5)";
            ctx!.fillText(lob ? "LOBOTOMIZE" : "NEURAL CORE", scx, scy + 32 * cam.zoom);

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

        return () => {
            cancelAnimationFrame(s.rafId);
            clearTimeout(s.neuronTimer);
            window.removeEventListener("resize", resize);
            canvas.removeEventListener("mousemove", onMove);
            canvas.removeEventListener("mousedown", onDown);
            canvas.removeEventListener("mouseup", onUp);
            canvas.removeEventListener("wheel", onWheel);
        };
    }, [canvasRef]);

    const handleSearch = useCallback((q: string) => {
        setSearchQuery(q);
        const s = S.current;
        if (!q.trim()) {
            s.searchMatch = null;
            s.graph.nodes.forEach(n => { if (n.alive) gsap.to(n, { opacity: 1, duration: 0.4 }); });
            return;
        }
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
    }, [wrapRef]);

    const handleDelete = useCallback(async (id: string) => {
        const s = S.current;
        const idx = s.graph.nodes.findIndex(n => n.id === id);
        if (idx < 0) return;
        const node = s.graph.nodes[idx];

        await onDeleteRecord(id);

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
    }, [onDeleteRecord]);

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

    return {
        state: {
            lobotomize,
            selectedNode,
            searchQuery,
            memoryCount,
            deletedCount,
            graphState: S,
        },
        actions: {
            setSelectedNode,
            handleSearch,
            handleLobotomizeToggle,
            handleDelete,
            zoomIn,
            zoomOut,
            zoomReset,
        }
    };
}
