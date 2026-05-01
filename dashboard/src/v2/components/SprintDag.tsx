import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { memo } from "preact/compat";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Code2, GitBranch, Hourglass, Sparkles, Timer, Workflow, XCircle } from "lucide-preact";
import type { ExecutionTaskDispatchSummary, Subtask } from "../../types.js";
import { buildSprintDagModel, type SprintDagEdgeModel, type SprintDagNodeModel } from "../lib/sprint-dag.js";
import { WaveFluid } from "./ui/WaveFluid.js";
import { BorderTrace } from "./ui/BorderTrace.js";
import { Tooltip } from "./ui/Tooltip.js";

interface SprintDagProps {
  tasks: Subtask[];
  dispatches: ExecutionTaskDispatchSummary[];
  hasSprintContext: boolean;
}

const NODE_W = 240;
const NODE_H = 144;
const COL_GAP = 300;
const ROW_GAP = 180;
const PAD_X = 110;
const PAD_Y = 110;

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
        glow: "shadow-[0_18px_55px_rgba(0,224,160,0.08)]",
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
        glow: "shadow-[0_16px_44px_rgba(15,159,168,0.08)]",
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
        glow: "shadow-[0_16px_44px_rgba(0,171,132,0.07)]",
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
        glow: "shadow-[0_14px_36px_rgba(227,0,15,0.06)]",
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
        glow: "shadow-[0_14px_36px_rgba(245,158,11,0.06)]",
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

  const startedAt = (node.task as any).started_at ? new Date((node.task as any).started_at).getTime() : null;
  const finishedAt = (node.task as any).finished_at ? new Date((node.task as any).finished_at).getTime() : null;
  const duration = startedAt && finishedAt ? `${Math.round((finishedAt - startedAt) / 1000)}s` : null;

  return (
    <div className="flex flex-col gap-3 w-72 p-1 text-slate-200 pointer-events-none">
      <div className="flex flex-col gap-1.5">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Prompt</h4>
        <div className="text-xs font-mono leading-relaxed whitespace-pre-wrap text-slate-300 break-words line-clamp-6">
          {hover?.prompt || "No prompt available."}
        </div>
      </div>

      {(hover?.dependencies?.length || 0) > 0 && (
        <div className="flex flex-col gap-1.5 pt-2 border-t border-white/10">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Waiting on</h4>
          <ul className="flex flex-col gap-1">
            {hover?.dependencies?.map((dep: { id: string, title: string }) => (
              <li key={dep.id} className="text-[11px] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500/50" />
                <span className="truncate flex-1">{dep.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {duration && (
        <div className="flex items-center gap-2 pt-2 border-t border-white/10 text-xs text-slate-400 font-mono">
          <Clock3 className="w-3.5 h-3.5" />
          <span>Completed in {duration}</span>
        </div>
      )}
    </div>
  );
}


const areDagNodePropsEqual = (
  prevProps: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary, tone: Tone },
  nextProps: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary, tone: Tone }
) => {
  return prevProps.node.task.id === nextProps.node.task.id &&
         prevProps.node.phase === nextProps.node.phase &&
         prevProps.node.isReady === nextProps.node.isReady &&
         prevProps.node.incoming.length === nextProps.node.incoming.length &&
         prevProps.node.outgoing.length === nextProps.node.outgoing.length &&
         prevProps.node.x === nextProps.node.x &&
         prevProps.node.y === nextProps.node.y &&
         prevProps.dispatch?.executorType === nextProps.dispatch?.executorType &&
         prevProps.dispatch?.provider === nextProps.dispatch?.provider;
};

const DagNode = memo(({ node, dispatch, tone }: { node: SprintDagNodeModel & { x: number; y: number; }, dispatch?: ExecutionTaskDispatchSummary, tone: Tone }) => {
  const executorLabel = formatExecutor(dispatch);
  const mergeLabel = getMergeLabel(node.task);
  const phaseLabel = node.phase === "CODING_COMPLETED" ? "Coding Done" : tone.label;

  return (
    <div
      className={`absolute ${tone.glow} ${tone.dim}`}
      style={{
        left: `${node.x}px`,
        top: `${node.y}px`,
        width: `${NODE_W}px`,
        height: `${NODE_H}px`,
      }}
      title={`${node.task.id} · ${node.task.title}`}
    >
      <Tooltip
        className="whitespace-normal w-full h-full text-left"
        content={renderDagNodeTooltipContent(node)}
      >
        <div className={`relative h-full rounded-[1.4rem] border ${tone.card} p-5 backdrop-blur-2xl dag-node-transition`}>
        <div
          className="absolute left-[-7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-white/70 dark:border-white/15"
          style={{ backgroundColor: `${tone.accent}CC`, boxShadow: `0 0 18px ${tone.accent}50` }}
        />
        <div
          className="absolute right-[-7px] top-1/2 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-white/70 dark:border-white/15"
          style={{ backgroundColor: `${tone.accent}CC`, boxShadow: `0 0 18px ${tone.accent}50` }}
        />

        <div
          className="absolute inset-x-3 top-2 h-[2px] rounded-full opacity-90"
          style={{ background: `linear-gradient(90deg, transparent, ${tone.accent}, transparent)` }}
        />
        <div
          className="absolute inset-x-3 bottom-0 h-10 rounded-b-[1.2rem] opacity-60"
          style={{ background: `radial-gradient(circle at 50% 0%, ${tone.accent}14 0%, transparent 70%)` }}
        />

        {node.phase === "RUNNING" && (
          <div
            className="dag-running-ring absolute -inset-1 rounded-[1.65rem] border border-signal-500/30"
            style={{ boxShadow: "0 0 32px rgba(0,224,160,0.12)" }}
          />
        )}

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 font-mono text-[10px] font-bold tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
                {node.task.id}
              </span>
              {node.incoming.length === 0 && (
                <span className="rounded-full border border-ember-500/20 bg-ember-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-ember-600 dark:text-ember-400">
                  Root
                </span>
              )}
              {node.isReady && (
                <span className="rounded-full border border-signal-500/20 bg-signal-500/10 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-300">
                  Ready
                </span>
              )}
            </div>
            <div className="mt-2 line-clamp-2 text-[15px] font-bold leading-tight tracking-tight text-slate-900 dark:text-white">
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

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ${tone.badge}`}>
            <tone.icon className="h-3 w-3" strokeWidth={2.5} />
            {phaseLabel}
          </span>
          {mergeLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-300">
              <GitBranch className="h-3 w-3" strokeWidth={2.5} />
              {mergeLabel}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
          <div className="min-w-0 text-[10px] font-mono leading-tight text-slate-400">
            <div>{node.incoming.length} deps in</div>
            <div>{node.outgoing.length} deps out</div>
          </div>
          <div className="flex flex-col items-end text-[10px] font-mono text-slate-400">
            {executorLabel && <span>{executorLabel}</span>}
            {dispatch?.provider && <span>{dispatch.provider}</span>}
            {!executorLabel && !dispatch?.provider && <Clock3 className="h-3.5 w-3.5 opacity-50" strokeWidth={1.8} />}
          </div>
        </div>
      </div>
      </Tooltip>
    </div>
  );
}, areDagNodePropsEqual);

export const SprintDag: FunctionComponent<SprintDagProps> = ({ tasks, dispatches, hasSprintContext }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const startScrollRef = useRef({ left: 0, top: 0 });
  const [isDraggingState, setIsDraggingState] = useState(false);

  const model = useMemo(() => buildSprintDagModel(tasks), [tasks]);

  const dispatchByTaskId = useMemo(() => {
    const map = new Map<string, ExecutionTaskDispatchSummary>();
    for (const dispatch of dispatches) {
      if (dispatch.taskId && !map.has(dispatch.taskId)) {
        map.set(dispatch.taskId, dispatch);
      }
      if (dispatch.taskKey && !map.has(dispatch.taskKey)) {
        map.set(dispatch.taskKey, dispatch);
      }
    }
    return map;
  }, [dispatches]);

  const maxDepth = model.columns.length - 1;
  const maxRows = Math.max(1, ...model.columns.map((column) => column.length));
  const canvasWidth = Math.max(1180, PAD_X * 2 + Math.max(0, maxDepth) * COL_GAP + NODE_W);
  const canvasHeight = Math.max(560, PAD_Y * 2 + Math.max(0, maxRows - 1) * ROW_GAP + NODE_H);

  const positionedNodes = useMemo(() => {
    return model.nodes.map((node) => ({
      ...node,
      x: PAD_X + node.depth * COL_GAP,
      y: PAD_Y + node.row * ROW_GAP,
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

  if (!hasSprintContext || tasks.length === 0) {
    return (
      <div className="relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 p-8 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
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
    <div className="group relative overflow-hidden rounded-[2rem] border border-black/[0.06] bg-white/70 p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] backdrop-blur-2xl dark:border-white/[0.06] dark:bg-void-800/60 dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] md:p-6">
      <WaveFluid accentHex="#00E0A0" />
      <BorderTrace accentHex="#00E0A0" />

      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="dag-aurora absolute -left-20 top-8 h-56 w-56 rounded-full bg-signal-500/10 blur-[90px]" />
        <div className="dag-aurora absolute right-[-4rem] top-1/3 h-64 w-64 rounded-full bg-ember-500/10 blur-[110px]" style={{ animationDelay: "-4s" }} />
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
                  className="rounded-[1.1rem] border border-black/[0.05] bg-white/65 px-3 py-3 backdrop-blur-xl dark:border-white/[0.05] dark:bg-void-900/35"
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
                    <feGaussianBlur stdDeviation="10" result="blur" />
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

                {model.adjacencies.map((adjacency) => {
                  const source = positionedNodeById.get(adjacency.from);
                  const target = positionedNodeById.get(adjacency.to);
                  if (!source || !target) {
                    return null;
                  }

                  const sourceX = source.x + NODE_W / 2;
                  const sourceY = source.y + NODE_H;
                  const targetX = target.x + NODE_W / 2;
                  const targetY = target.y;

                  const isSettled = source.phase === "COMPLETED" && target.phase === "COMPLETED";
                  const isActive = (source.phase === "RUNNING" || source.phase === "CODING_COMPLETED") &&
                                   (target.phase === "RUNNING" || target.phase === "CODING_COMPLETED");

                  const strokeColor = isActive ? "rgba(0,224,160,0.4)" : isSettled ? "rgba(0,171,132,0.3)" : "rgba(100,116,139,0.2)";
                  const strokeWidth = isActive ? 2 : isSettled ? 1.5 : 1;
                  const strokeDasharray = isActive ? undefined : isSettled ? "6 6" : "4 8";

                  return (
                    <g key={adjacency.id}>
                      <line
                        className="dag-edge-transition"
                        x1={sourceX}
                        y1={sourceY}
                        x2={targetX}
                        y2={targetY}
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeDasharray={strokeDasharray}
                        strokeLinecap="round"
                      />
                    </g>
                  );
                })}

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
                        stroke="rgba(15,23,42,0.07)"
                        strokeWidth={tone.width + 6}
                        opacity={edge.state === "active" ? 0.14 : 0.06}
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
                        strokeWidth={tone.width}
                        opacity={tone.opacity}
                        strokeLinecap="round"
                        strokeDasharray={edge.state === "pending" ? "5 10" : undefined}
                        filter={edge.state === "active" ? "url(#dag-glow)" : undefined}
                      >
                        {edge.state === "pending" && (
                          <animate attributeName="stroke-dashoffset" from="30" to="0" dur="2.8s" repeatCount="indefinite" />
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
                      {(edge.state === "active" || edge.state === "settled" || edge.state === "blocked") && (
                        <circle r={edge.state === "active" ? 4.5 : 3.2} fill={tone.stroke} opacity={edge.state === "blocked" ? 0.7 : 0.92}>
                          <animateMotion dur={edge.state === "active" ? "2.2s" : "4.8s"} repeatCount="indefinite" rotate="auto">
                            <mpath href={`#dag-path-${edge.id}`} />
                          </animateMotion>
                        </circle>
                      )}
                      {edge.state === "active" && (
                        <circle r={2.8} fill="#F4FFF8" opacity={0.95}>
                          <animateMotion dur="1.4s" begin={`${(stableRand(edge.id) * 1.2).toFixed(2)}s`} repeatCount="indefinite" rotate="auto">
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
                const tone = getNodeTone(node);
                const dispatch = dispatchByTaskId.get(node.task.record_id || "") || dispatchByTaskId.get(node.task.id);
                return (
                  <div key={node.task.id} className="pointer-events-auto relative z-10">
                    <DagNode node={node} dispatch={dispatch} tone={tone} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
