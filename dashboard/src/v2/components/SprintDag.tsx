import type { FunctionComponent } from "preact";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import { memo } from "preact/compat";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Code2, GitBranch, Hourglass, Sparkles, Timer, Workflow, XCircle } from "lucide-preact";
import type { ExecutionTaskDispatchSummary, Subtask } from "../../types.js";
import { buildSprintDagModel, type SprintDagEdgeModel, type SprintDagNodeModel } from "../lib/sprint-dag.js";
import { WaveFluid } from "./ui/WaveFluid.js";
import { BorderTrace } from "./ui/BorderTrace.js";

interface SprintDagProps {
  tasks?: Subtask[];
  dispatches?: ExecutionTaskDispatchSummary[];
  hasSprintContext: boolean;
}

const NODE_W = 280;
const NODE_H = 188;
const COL_GAP = 370;
const ROW_GAP = 38;
const PAD_X = 110;
const PAD_Y = 110;
const INFOBOX_W = 352;
const INFOBOX_GAP = 14;

type Tone = {
  accent: string;
  edge: string;
  glow: string;
  badge: string;
  card: string;
  label: string;
  dim: string;
  icon: FunctionComponent<any>;
};

function stableRand(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash % 10_000) / 10_000;
}

function getNodeTone(node: SprintDagNodeModel): Tone {
  switch (node.phase) {
    case "RUNNING":
      return {
        accent: "#00E0A0",
        edge: "#00E0A0",
        glow: "drop-shadow-[0_18px_34px_rgba(0,224,160,0.08)]",
        badge: "border-signal-500/25 bg-signal-500/12 text-signal-600 dark:text-signal-300",
        card: "border-signal-500/20 bg-white/80 dark:bg-void-800/78",
        label: "Running",
        dim: "",
        icon: Activity,
      };
    case "CODING_COMPLETED":
      return {
        accent: "#0F9FA8",
        edge: "#0F9FA8",
        glow: "drop-shadow-[0_16px_30px_rgba(15,159,168,0.08)]",
        badge: "border-cyan-500/25 bg-cyan-500/12 text-cyan-600 dark:text-cyan-300",
        card: "border-cyan-500/18 bg-white/78 dark:bg-void-800/76",
        label: "Coding Completed",
        dim: "",
        icon: Code2,
      };
    case "COMPLETED":
      return {
        accent: "#00AB84",
        edge: "#00AB84",
        glow: "drop-shadow-[0_16px_30px_rgba(0,171,132,0.07)]",
        badge: "border-status-green/20 bg-status-green/12 text-status-green",
        card: "border-status-green/18 bg-white/78 dark:bg-void-800/76",
        label: "Completed",
        dim: "",
        icon: CheckCircle2,
      };
    case "FAILED":
      return {
        accent: "#E3000F",
        edge: "#E3000F",
        glow: "drop-shadow-[0_14px_26px_rgba(227,0,15,0.06)]",
        badge: "border-status-red/20 bg-status-red/12 text-status-red",
        card: "border-status-red/16 bg-white/72 dark:bg-void-800/72",
        label: "Failed",
        dim: "opacity-85",
        icon: XCircle,
      };
    case "BLOCKED":
    case "QUOTA":
      return {
        accent: "#F59E0B",
        edge: "#F59E0B",
        glow: "drop-shadow-[0_14px_26px_rgba(245,158,11,0.06)]",
        badge: "border-status-amber/20 bg-status-amber/12 text-status-amber",
        card: "border-status-amber/16 bg-white/72 dark:bg-void-800/72",
        label: node.phase === "QUOTA" ? "Quota" : "Blocked",
        dim: "opacity-90",
        icon: AlertTriangle,
      };
    case "PENDING":
    default:
      return {
        accent: "#64748B",
        edge: "#64748B",
        glow: "shadow-none",
        badge: "border-black/[0.07] bg-black/[0.04] text-slate-500 dark:border-white/[0.07] dark:bg-white/[0.04] dark:text-slate-400",
        card: "border-black/[0.06] bg-white/70 dark:border-white/[0.06] dark:bg-void-800/68",
        label: node.isReady ? "Ready" : "Pending",
        dim: "opacity-92",
        icon: Hourglass,
      };
  }
}

function getMergeLabel(task: Subtask): string | null {
  switch (task.merge_indicator) {
    case "MERGED":
      return "Merged";
    case "CI":
      return "CI";
    case "AUTOMERGE":
      return "Automerge";
    case "MERGE_CONFLICT":
      return "Conflict";
    case "MERGE_BLOCKED":
      return "Blocked";
    default:
      return null;
  }
}

function getEdgeTone(edge: SprintDagEdgeModel): { stroke: string; opacity: number; width: number } {
  switch (edge.state) {
    case "active":
      return { stroke: "#00E0A0", opacity: 0.9, width: 2.4 };
    case "settled":
      return { stroke: "#00AB84", opacity: 0.75, width: 2.1 };
    case "blocked":
      return { stroke: "#F59E0B", opacity: 0.6, width: 2.1 };
    case "pending":
    default:
      return { stroke: "#64748B", opacity: 0.28, width: 1.6 };
  }
}

function getColumnLabel(depth: number, maxDepth: number): string {
  if (depth === 0) {
    return "Roots";
  }
  if (depth === maxDepth) {
    return "Finish";
  }
  if (depth === 1) {
    return "Build";
  }
  if (depth === maxDepth - 1) {
    return "Integration";
  }
  return `Layer ${depth + 1}`;
}

function formatExecutor(dispatch?: ExecutionTaskDispatchSummary): string | null {
  if (!dispatch?.executorType) {
    return null;
  }
  switch (dispatch.executorType) {
    case "docker_cli":
      return "CLI";
    case "jules":
      return "Jules";
    default:
      return "Auto";
  }
}


function renderDagNodeTooltipContent(node: SprintDagNodeModel) {
  const hover = node.hover;
  const phaseLabel = node.phase === "CODING_COMPLETED" ? "Coding Done" : node.phase.toLowerCase();
  const dependencies = hover?.dependencies || [];

  return (
    <div className="w-full">
      <div className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-signal-500 via-signal-400 to-ember-400" />

      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 border-b border-black/[0.06] pb-3 dark:border-white/[0.08]">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-signal-600 dark:text-signal-300">{node.task.id}</div>
            <div className="mt-1 line-clamp-2 text-sm font-bold leading-snug text-slate-900 dark:text-white">{node.task.title}</div>
          </div>
          <div className="shrink-0 rounded-full border border-signal-500/20 bg-signal-500/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-700 dark:text-signal-300">
            {phaseLabel}
          </div>
        </div>

        <div className="rounded-[1rem] border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.07] dark:bg-white/[0.035]">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Prompt</div>
            <div className="font-mono text-[9px] text-slate-400">{hover?.prompt?.length || 0} chars</div>
          </div>
          <div className="max-h-32 overflow-y-auto pr-1 font-mono text-xs leading-relaxed text-slate-600 break-words whitespace-pre-wrap dark:text-slate-300 dropdown-scrollbar">
            {hover?.prompt || "No prompt available."}
          </div>
        </div>

        {dependencies.length > 0 && (
          <div className="rounded-[1rem] border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.07] dark:bg-white/[0.035]">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Waiting on</div>
            <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto pr-1 dropdown-scrollbar">
              {dependencies.map((dep) => (
                <li key={dep.id} className="flex items-center gap-2 rounded-lg bg-black/[0.025] px-2 py-1.5 text-[11px] text-slate-600 dark:bg-white/[0.035] dark:text-slate-300">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70" />
                  <span className="truncate">{dep.title}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          {[
            ["Depth", String(node.depth + 1)],
            ["In", String(hover?.counters.incoming || 0)],
            ["Out", String(hover?.counters.outgoing || 0)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-[0.9rem] border border-black/[0.06] bg-white/75 px-3 py-2 dark:border-white/[0.07] dark:bg-white/[0.04]">
              <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
              <div className="mt-1 font-mono text-sm font-black text-slate-800 dark:text-white">{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


const areDagNodePropsEqual = (
  prevProps: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary },
  nextProps: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary }
) => {
  return prevProps.node.task.id === nextProps.node.task.id &&
         prevProps.node.phase === nextProps.node.phase &&
         prevProps.node.isReady === nextProps.node.isReady &&
         prevProps.node.incoming.length === nextProps.node.incoming.length &&
         prevProps.node.outgoing.length === nextProps.node.outgoing.length &&
         prevProps.node.x === nextProps.node.x &&
         prevProps.node.y === nextProps.node.y &&
         prevProps.node.hover.counters.incoming === nextProps.node.hover.counters.incoming &&
         prevProps.node.hover.counters.outgoing === nextProps.node.hover.counters.outgoing &&
         prevProps.node.hover.prompt === nextProps.node.hover.prompt &&
         prevProps.dispatch?.executorType === nextProps.dispatch?.executorType &&
         prevProps.dispatch?.provider === nextProps.dispatch?.provider;
};

const DagNode = memo(({ node, dispatch, onNodeClick }: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary, onNodeClick?: (node: SprintDagNodeModel & { x: number; y: number; }) => void }) => {
  const tone = getNodeTone(node);
  const executorLabel = formatExecutor(dispatch);
  const mergeLabel = getMergeLabel(node.task);
  const phaseLabel = node.phase === "CODING_COMPLETED" ? "Coding Done" : tone.label;

  return (
    <div
      className={`group/dag-node pointer-events-auto absolute z-10 cursor-pointer hover:z-50 focus-within:z-50 ${tone.glow} ${tone.dim}`} onClick={() => onNodeClick?.(node)}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${NODE_W}px`,
        height: `${NODE_H}px`,
      }}
      tabIndex={0}
      aria-label={`${node.task.id}: ${node.task.title}`}
    >
      <div className="relative h-full w-full">
        {node.incoming.length > 0 && (
          <div
            className="absolute left-[-5px] top-1/2 z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white/75 dark:border-white/20"
            style={{ backgroundColor: `${tone.accent}CC`, boxShadow: `0 0 18px ${tone.accent}50` }}
          />
        )}
        {node.outgoing.length > 0 && (
          <div
            className="absolute right-[-5px] top-1/2 z-20 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-white/75 dark:border-white/20"
            style={{ backgroundColor: `${tone.accent}CC`, boxShadow: `0 0 18px ${tone.accent}50` }}
          />
        )}

        <div
          className="pointer-events-none absolute left-[calc(100%+14px)] top-0 z-50 w-[22rem] max-w-[calc(100vw-2rem)] translate-x-2 scale-[0.98] overflow-hidden rounded-[1.45rem] border border-black/[0.08] bg-white/98 p-4 text-slate-700 opacity-0 drop-shadow-[0_18px_34px_rgba(15,23,42,0.18)] backdrop-blur-sm transition-all duration-180 ease-out group-hover/dag-node:pointer-events-auto group-hover/dag-node:translate-x-0 group-hover/dag-node:scale-100 group-hover/dag-node:opacity-100 group-focus-within/dag-node:pointer-events-auto group-focus-within/dag-node:translate-x-0 group-focus-within/dag-node:scale-100 group-focus-within/dag-node:opacity-100 dark:border-white/[0.09] dark:bg-void-800/98 dark:text-slate-200 dark:drop-shadow-[0_22px_44px_rgba(0,0,0,0.42)]"
          role="tooltip"
        >
          {renderDagNodeTooltipContent(node)}
        </div>

        <div className={`relative isolate flex h-full w-full flex-col overflow-hidden rounded-[1.4rem] border ${tone.card} p-4.5 backdrop-blur-sm transition-all duration-500 group-hover/dag-node:scale-[1.02]`}>
          <div
            className="pointer-events-none absolute inset-x-4 top-2 z-0 h-[2px] rounded-full opacity-90"
            style={{ background: `linear-gradient(90deg, transparent, ${tone.accent}, transparent)` }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-16 rounded-b-[1.4rem] opacity-70"
            style={{ background: `radial-gradient(circle at 50% 0%, ${tone.accent}16 0%, transparent 68%)` }}
          />

          {node.phase === "RUNNING" && (
            <div
              className="dag-running-ring pointer-events-none absolute inset-0 z-0 rounded-[1.35rem] border border-signal-500/30"
              style={{ boxShadow: "inset 0 0 0 1px rgba(0,224,160,0.08), 0 0 28px rgba(0,224,160,0.10)" }}
            />
          )}

          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="min-w-0 max-w-[8rem] truncate rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.08em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                    {node.task.id}
                  </span>
                  {node.incoming.length === 0 && (
                    <span className="shrink-0 rounded-full border border-ember-500/20 bg-ember-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-ember-600 dark:text-ember-400">
                      Root
                    </span>
                  )}
                  {node.isReady && (
                    <span className="shrink-0 rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-signal-600 dark:text-signal-300">
                      Ready
                    </span>
                  )}
                </div>
                <div className="mt-2 line-clamp-2 text-[14px] font-bold leading-snug tracking-tight text-slate-900 dark:text-white">
                  {node.task.title}
                </div>
              </div>

              <div
                className="relative mt-1 h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: tone.accent, boxShadow: `0 0 18px ${tone.accent}70` }}
              >
                {(node.phase === "RUNNING" || node.phase === "CODING_COMPLETED") && (
                  <span className="absolute inset-0 rounded-full bg-current opacity-50 animate-ping" />
                )}
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
              <span className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] ${tone.badge}`}>
                <tone.icon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                <span className="truncate">{phaseLabel}</span>
              </span>
              {mergeLabel && (
                <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                  <GitBranch className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                  <span className="truncate">{mergeLabel}</span>
                </span>
              )}
            </div>

            <div className="mt-auto grid grid-cols-[1fr_auto] items-end gap-3 pt-3">
              <div className="min-w-0 rounded-2xl border border-black/[0.045] bg-white/38 px-3 py-2 font-mono text-[10px] leading-tight text-slate-500 dark:border-white/[0.055] dark:bg-white/[0.035] dark:text-slate-400">
                <div className="truncate">{node.incoming.length} deps in</div>
                <div className="truncate">{node.outgoing.length} deps out</div>
              </div>
              <div className="flex min-w-0 max-w-[7.5rem] flex-col items-end rounded-2xl border border-black/[0.045] bg-white/38 px-3 py-2 text-right font-mono text-[10px] leading-tight text-slate-500 dark:border-white/[0.055] dark:bg-white/[0.035] dark:text-slate-400">
                {executorLabel && <span className="max-w-full truncate">{executorLabel}</span>}
                {dispatch?.provider && <span className="max-w-full truncate">{dispatch.provider}</span>}
                {!executorLabel && !dispatch?.provider && <Clock3 className="h-3.5 w-3.5 opacity-50" strokeWidth={1.8} />}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}, areDagNodePropsEqual);

export const SprintDag: FunctionComponent<SprintDagProps> = ({ tasks, dispatches, hasSprintContext }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startScrollRef = useRef({ left: 0, top: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const safeDispatches = Array.isArray(dispatches) ? dispatches : [];

  const model = useMemo(() => buildSprintDagModel(safeTasks), [safeTasks]);

  const dispatchByTaskId = useMemo(() => {
    const map = new Map<string, ExecutionTaskDispatchSummary>();
    for (const dispatch of safeDispatches) {
      if (dispatch.taskId && !map.has(dispatch.taskId)) {
        map.set(dispatch.taskId, dispatch);
      }
      if (dispatch.taskKey && !map.has(dispatch.taskKey)) {
        map.set(dispatch.taskKey, dispatch);
      }
    }
    return map;
  }, [safeDispatches]);

  const maxDepth = model.columns.length - 1;
  const maxRows = Math.max(1, ...model.columns.map((column) => column.length));
  const canvasWidth = Math.max(1180, PAD_X * 2 + Math.max(0, maxDepth) * COL_GAP + NODE_W + INFOBOX_W + INFOBOX_GAP);
  const canvasHeight = Math.max(560, PAD_Y * 2 + maxRows * NODE_H + Math.max(0, maxRows - 1) * ROW_GAP);

  const positionedNodes = useMemo(() => {
    return model.nodes.map((node) => ({
      ...node,
      x: PAD_X + node.depth * COL_GAP,
      y: PAD_Y + node.row * (NODE_H + ROW_GAP),
    }));
  }, [model.nodes]);

  const positionedNodeById = useMemo(
    () => new Map(positionedNodes.map((node) => [node.task.id, node])),
    [positionedNodes],
  );

  const columnAnchors = useMemo(() => {
    return model.columns.map((column, depth) => ({
      depth,
      x: PAD_X + depth * COL_GAP + NODE_W / 2,
      y: 40,
      label: getColumnLabel(depth, maxDepth),
      count: column.length,
    }));
  }, [model.columns, maxDepth]);

  const handleNodeClick = (node: SprintDagNodeModel & { x: number; y: number; }) => {
    if (!scrollRef.current) return;
    const containerWidth = scrollRef.current.clientWidth;
    const containerHeight = scrollRef.current.clientHeight;
    // Calculate the target scroll position to center the node
    const NODE_W = 280;
    const NODE_H = 188;
    const targetX = node.x - containerWidth / 2 + NODE_W / 2;
    const targetY = node.y - containerHeight / 2 + NODE_H / 2;

    scrollRef.current.scrollTo({
      left: Math.max(0, targetX),
      top: Math.max(0, targetY),
      behavior: 'smooth'
    });
  };

  const handlePointerDown = (e: preact.JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!scrollRef.current) return;
    isDraggingRef.current = true;
    setIsDraggingState(true);
    startPosRef.current = { x: e.pageX, y: e.pageY };
    startScrollRef.current = {
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
    };
  };

  const handlePointerMove = (e: preact.JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !scrollRef.current) return;
    const dx = e.pageX - startPosRef.current.x;
    const dy = e.pageY - startPosRef.current.y;
    scrollRef.current.scrollLeft = startScrollRef.current.left - dx;
    scrollRef.current.scrollTop = startScrollRef.current.top - dy;
  };

  const handlePointerUpOrLeave = () => {
    isDraggingRef.current = false;
    setIsDraggingState(false);
  };

  useLayoutEffect(() => {
    if (hasSprintContext && safeTasks.length > 0 && scrollRef.current) {
      const container = scrollRef.current;
      const content = container.querySelector('.relative.pointer-events-none');
      if (content) {
        gsap.fromTo(content,
          { opacity: 0, scale: 0.96 },
          { opacity: 1, scale: 1, duration: 0.5, ease: "power3.out" }
        );
      }
    }
  }, [hasSprintContext]);

  if (!hasSprintContext || safeTasks.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-8 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <WaveFluid accentHex="#00E0A0" />
        <BorderTrace accentHex="#00E0A0" />
        <div className="relative z-10 flex min-h-[22rem] flex-col items-center justify-center text-center">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-[1.3rem] border border-signal-500/20 bg-signal-500/10 text-signal-500 shadow-[0_0_24px_rgba(0,224,160,0.16)]">
            <Workflow className="h-8 w-8" strokeWidth={1.4} />
          </div>
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">Dependency Graph</div>
          <h3 className="mt-3 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            The DAG wakes up with the sprint.
          </h3>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Start a sprint to visualize task dependencies, live execution flow, and which parts of the graph are still waiting on code, merge work, or final completion.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/80 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.06] dark:bg-void-800/75 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] md:p-6">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dag-aurora absolute -left-20 top-8 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,224,160,0.08) 0%, transparent 70%)' }} />
        <div className="dag-aurora absolute right-[-4rem] top-1/3 h-64 w-64 rounded-full" style={{ background: 'radial-gradient(circle, rgba(255,184,0,0.08) 0%, transparent 70%)', animationDelay: "-4s" }} />
        <div className="dag-grid-pan absolute inset-0 opacity-40 dark:opacity-50" style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, rgba(100,116,139,0.18) 1px, transparent 0)",
          backgroundSize: "26px 26px",
        }} />
      </div>

      <div className="relative z-10">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
              <Workflow className="h-4 w-4" strokeWidth={1.6} />
              Dependency Constellation
            </div>
            <h3 className="mt-2 font-display text-3xl font-black tracking-tight text-slate-900 dark:text-white md:text-[2.35rem]">
              Live sprint DAG, rendered as motion.
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Each node is a task on the current sprint. Flow moves left to right through real dependency edges, while color and motion show what is running, merge-waiting, blocked, or fully complete.
            </p>
          </div>

          <div className="w-full overflow-x-auto pb-1 xl:max-w-[58rem] xl:justify-end">
            <div className="grid min-w-[52rem] grid-cols-5 gap-2.5">
              {[
                { label: "Roots", value: model.metrics.rootCount, icon: GitBranch, accent: "text-signal-500" },
                { label: "Running", value: model.metrics.runningCount, icon: Activity, accent: "text-signal-500" },
                { label: "Ready", value: model.metrics.readyCount, icon: Sparkles, accent: "text-ember-500" },
                { label: "Longest Chain", value: model.metrics.longestChain, icon: Timer, accent: "text-cyan-500" },
                { label: "Completed", value: model.metrics.completedCount, icon: CheckCircle2, accent: "text-status-green" },
              ].map(({ label, value, icon: Icon, accent }) => (
                <div
                  key={label}
                  className="rounded-[1.1rem] border border-black/[0.05] bg-white/75 px-3 py-3 backdrop-blur-sm dark:border-white/[0.05] dark:bg-void-900/50"
                >
                  <div className={`mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] ${accent}`}>
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                    <span className="leading-tight">{label}</span>
                  </div>
                  <div className="font-mono text-2xl font-black tracking-tighter text-slate-900 dark:text-white">{value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-black/[0.05] bg-black/[0.02] p-3 dark:border-white/[0.05] dark:bg-white/[0.02]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
            <div className="flex flex-wrap items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 dark:border-white/[0.06] dark:bg-void-900/55">Scrollable canvas</span>
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 dark:border-white/[0.06] dark:bg-void-900/55">Dependency depth {Math.max(1, model.columns.length)}</span>
              <span className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 dark:border-white/[0.06] dark:bg-void-900/55">{model.metrics.codingCompletedCount} merge-stage nodes</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-signal-500/20 bg-signal-500/10 px-3 py-1 text-signal-600 dark:text-signal-300">
                <span className="h-2 w-2 rounded-full bg-signal-500 animate-pulse" />
                Running
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-cyan-600 dark:text-cyan-300">
                <span className="h-2 w-2 rounded-full bg-cyan-500" />
                Coding Completed
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-status-green/20 bg-status-green/10 px-3 py-1 text-status-green">
                <span className="h-2 w-2 rounded-full bg-status-green" />
                Completed
              </span>
            </div>
          </div>

          <div
            ref={scrollRef}
            className={`dag-scroll-shell h-[38rem] overflow-auto rounded-[1.35rem] border border-black/[0.05] bg-[linear-gradient(180deg,rgba(255,255,255,0.72),rgba(249,248,244,0.56))] shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:border-white/[0.04] dark:bg-[linear-gradient(180deg,rgba(24,20,17,0.88),rgba(8,6,5,0.76))] md:h-[46rem] ${
              isDraggingState ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUpOrLeave}
            onPointerLeave={handlePointerUpOrLeave}
            onPointerCancel={handlePointerUpOrLeave}
          >
            <div className="relative pointer-events-none" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
              <svg
                className="absolute inset-0"
                width={canvasWidth}
                height={canvasHeight}
                viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <linearGradient id="dag-edge-active" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#00B882" />
                    <stop offset="50%" stopColor="#00E0A0" />
                    <stop offset="100%" stopColor="#80FFD6" />
                  </linearGradient>
                  <linearGradient id="dag-edge-active-soft" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="rgba(0,184,130,0)" />
                    <stop offset="30%" stopColor="rgba(0,224,160,0.45)" />
                    <stop offset="70%" stopColor="rgba(128,255,214,0.75)" />
                    <stop offset="100%" stopColor="rgba(128,255,214,0)" />
                  </linearGradient>
                  <linearGradient id="dag-edge-settled" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#008F65" />
                    <stop offset="100%" stopColor="#00AB84" />
                  </linearGradient>
                  <linearGradient id="dag-edge-blocked" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#F59E0B" />
                    <stop offset="100%" stopColor="#FFB800" />
                  </linearGradient>
                  <filter id="dag-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="6" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                  <filter id="dag-edge-bloom" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                  </filter>
                </defs>

                {columnAnchors.map((column) => (
                  <g key={column.depth}>
                    <line
                      x1={column.x}
                      x2={column.x}
                      y1={0}
                      y2={canvasHeight}
                      stroke="rgba(100,116,139,0.1)"
                      strokeDasharray="5 12"
                    />
                  </g>
                ))}

                {model.edges.map((edge) => {
                  const source = positionedNodeById.get(edge.from);
                  const target = positionedNodeById.get(edge.to);
                  if (!source || !target) {
                    return null;
                  }

                  const sourceX = source.x + NODE_W;
                  const sourceY = source.y + NODE_H / 2;
                  const targetX = target.x;
                  const targetY = target.y + NODE_H / 2;
                  const curve = Math.max(70, (targetX - sourceX) * 0.42);
                  const path = `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`;
                  const tone = getEdgeTone(edge);
                  const stroke = edge.state === "active"
                    ? "url(#dag-edge-active)"
                    : edge.state === "settled"
                      ? "url(#dag-edge-settled)"
                      : edge.state === "blocked"
                        ? "url(#dag-edge-blocked)"
                        : tone.stroke;

                  return (
                    <g key={edge.id}>
                      <path
                        className="dag-edge-transition"
                        d={path}
                        stroke="rgba(15,23,42,0.10)"
                        strokeWidth={tone.width + 8}
                        opacity={edge.state === "active" ? 0.18 : 0.10}
                        strokeLinecap="round"
                      />
                      {edge.state === "active" && (
                        <path
                          className="dag-edge-transition"
                          d={path}
                          stroke="url(#dag-edge-active-soft)"
                          strokeWidth={tone.width + 10}
                          opacity={0.55}
                          strokeLinecap="round"
                          filter="url(#dag-edge-bloom)"
                        />
                      )}
                      <path
                        id={`dag-path-${edge.id}`}
                        className="dag-edge-transition"
                        d={path}
                        stroke={stroke}
                        strokeWidth={Math.max(tone.width, 2)}
                        opacity={Math.max(tone.opacity, edge.state === "pending" ? 0.5 : tone.opacity)}
                        strokeLinecap="round"
                        strokeDasharray={edge.state === "pending" ? "7 9" : undefined}
                        filter={edge.state === "active" ? "url(#dag-glow)" : undefined}
                      >
                        {edge.state === "pending" && (
                          <animate attributeName="stroke-dashoffset" from="32" to="0" dur="2.8s" repeatCount="indefinite" />
                        )}
                      </path>
                      {edge.state === "active" && (
                        <path
                          d={path}
                          stroke="#CFFFF0"
                          strokeWidth={2.4}
                          opacity={0.95}
                          strokeLinecap="round"
                          strokeDasharray="18 32"
                          filter="url(#dag-glow)"
                        >
                          <animate attributeName="stroke-dashoffset" from="0" to="-100" dur="1.6s" repeatCount="indefinite" />
                        </path>
                      )}
                      {(edge.state === "active" || (edge.state === "blocked" && (source.isFocusMode || target.isFocusMode))) && (
                        <circle r={edge.state === "active" ? 4.5 : 3.2} fill={tone.stroke} opacity={0}>
                          <animate attributeName="opacity" values={edge.state === "blocked" ? "0; 0.7; 0.7; 0" : "0; 0.92; 0.92; 0"} keyTimes="0; 0.1; 0.9; 1" dur={edge.state === "active" ? "3s" : "4.8s"} repeatCount="indefinite" />
                          <animateMotion dur={edge.state === "active" ? "3s" : "4.8s"} repeatCount="indefinite" rotate="auto">
                            <mpath href={`#dag-path-${edge.id}`} />
                          </animateMotion>
                        </circle>
                      )}
                      {edge.state === "active" && (
                        <circle r={2.8} fill="#F4FFF8" opacity={0}>
                          <animate attributeName="opacity" values="0; 0.95; 0.95; 0" keyTimes="0; 0.1; 0.9; 1" dur="2s" begin={`${(stableRand(edge.id) * 1.2).toFixed(2)}s`} repeatCount="indefinite" />
                          <animateMotion dur="2s" begin={`${(stableRand(edge.id) * 1.2).toFixed(2)}s`} repeatCount="indefinite" rotate="auto">
                            <mpath href={`#dag-path-${edge.id}`} />
                          </animateMotion>
                        </circle>
                      )}
                      {edge.state !== "pending" && (
                        <circle cx={targetX} cy={targetY} r={edge.state === "active" ? 7 : 5} fill={tone.stroke} opacity={edge.state === "blocked" ? 0.18 : 0.12}>
                          {edge.state === "active" && (
                            <animate attributeName="r" values="6;10;6" dur="2.2s" repeatCount="indefinite" />
                          )}
                        </circle>
                      )}
                    </g>
                  );
                })}
              </svg>

              {columnAnchors.map((column) => (
                <div
                  key={`label-${column.depth}`}
                  className="pointer-events-none absolute -translate-x-1/2"
                  style={{ left: `${column.x}px`, top: "18px" }}
                >
                  <div className="rounded-full border border-black/[0.06] bg-white/70 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 shadow-sm backdrop-blur-xl dark:border-white/[0.06] dark:bg-void-900/60 dark:text-slate-300">
                    <span>{column.label}</span>
                    <span className="ml-2 font-mono text-slate-400">{column.count}</span>
                  </div>
                </div>
              ))}

              {positionedNodes.map((node) => {
                const dispatch = dispatchByTaskId.get(node.task.record_id || "") || dispatchByTaskId.get(node.task.id);
                return (
                  <DagNode key={node.task.id} node={node} dispatch={dispatch} onNodeClick={handleNodeClick} />
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
