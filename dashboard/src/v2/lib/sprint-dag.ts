import type { Subtask } from "../../types.js";
import { getTaskProgressPhase, type TaskProgressPhase } from "../../lib/task-progress.js";

export interface SprintDagNodeHover {
  prompt: string;
  dependencies: Array<{ id: string; title: string }>;
  counters: { incoming: number; outgoing: number };
}

export interface SprintDagNodeModel {
  task: Subtask;
  phase: TaskProgressPhase;
  depth: number;
  row: number;
  order: number;
  incoming: string[];
  outgoing: string[];
  isReady: boolean;
  hover: SprintDagNodeHover;
}

export interface SprintDagEdgeModel {
  id: string;
  from: string;
  to: string;
  state: "pending" | "active" | "settled" | "blocked";
}

export interface SprintDagAdjacencyModel {
  id: string;
  from: string;
  to: string;
}

export interface SprintDagMetrics {
  rootCount: number;
  longestChain: number;
  readyCount: number;
  runningCount: number;
  codingCompletedCount: number;
  completedCount: number;
}

export interface SprintDagModel {
  nodes: SprintDagNodeModel[];
  edges: SprintDagEdgeModel[];
  adjacencies: SprintDagAdjacencyModel[];
  columns: SprintDagNodeModel[][];
  metrics: SprintDagMetrics;
}

// auto-focus behavior removed

function isSettledPhase(phase: TaskProgressPhase): boolean {
  return phase === "COMPLETED";
}

function isBlockedPhase(phase: TaskProgressPhase): boolean {
  return phase === "FAILED" || phase === "BLOCKED" || phase === "QUOTA";
}

export function buildSprintDagModel(tasks: Subtask[]): SprintDagModel {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const phaseById = new Map(tasks.map((task) => [task.id, getTaskProgressPhase(task)]));
  const depthMemo = new Map<string, number>();

  const resolveIncoming = (task: Subtask): string[] => (
    Array.isArray(task.depends_on)
      ? task.depends_on.filter((dependencyId) => tasksById.has(dependencyId))
      : []
  );

  const getDepth = (taskId: string, ancestry = new Set<string>()): number => {
    if (depthMemo.has(taskId)) {
      return depthMemo.get(taskId) || 0;
    }

    if (ancestry.has(taskId)) {
      return 0;
    }

    ancestry.add(taskId);
    const task = tasksById.get(taskId);
    if (!task) {
      depthMemo.set(taskId, 0);
      return 0;
    }

    const incoming = resolveIncoming(task);
    const depth = incoming.length === 0
      ? 0
      : Math.max(...incoming.map((dependencyId) => getDepth(dependencyId, new Set(ancestry)))) + 1;
    depthMemo.set(taskId, depth);
    return depth;
  };

  const outgoingById = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dependencyId of resolveIncoming(task)) {
      const outgoing = outgoingById.get(dependencyId) || [];
      outgoing.push(task.id);
      outgoingById.set(dependencyId, outgoing);
    }
  }

  const orderedNodes = tasks.map((task, index) => {
    const phase = phaseById.get(task.id) || "PENDING";
    const incoming = resolveIncoming(task);
    const dependencyPhases = incoming.map((dependencyId) => phaseById.get(dependencyId) || "PENDING");

    const hoverPrompt = typeof task.prompt === "string" && task.prompt.trim().length > 0
      ? task.prompt.trim()
      : "No prompt provided";

    const hoverDependencies = incoming.map((id) => ({
      id,
      title: tasksById.get(id)?.title || "Unknown Task",
    }));

    const outgoing = outgoingById.get(task.id) || [];

    return {
      task,
      phase,
      depth: getDepth(task.id),
      row: 0,
      order: index,
      incoming,
      outgoing,
      isReady: phase === "PENDING" && dependencyPhases.every((dependencyPhase) => isSettledPhase(dependencyPhase)),
      hover: {
        prompt: hoverPrompt,
        dependencies: hoverDependencies,
        counters: {
          incoming: incoming.length,
          outgoing: outgoing.length,
        },
      },
    } satisfies SprintDagNodeModel;
  });

  const columns = new Map<number, SprintDagNodeModel[]>();
  for (const node of orderedNodes) {
    const column = columns.get(node.depth) || [];
    column.push(node);
    columns.set(node.depth, column);
  }

  const sortedColumns = Array.from(columns.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([, nodes]) => nodes.map((node, row) => ({ ...node, row })));

  const nodes = sortedColumns.flat();
  const nodeById = new Map(nodes.map((node) => [node.task.id, node]));

  const edges: SprintDagEdgeModel[] = [];
  for (const node of nodes) {
    for (const dependencyId of node.incoming) {
      const dependencyNode = nodeById.get(dependencyId);
      if (!dependencyNode) {
        continue;
      }

      const state: SprintDagEdgeModel["state"] = isBlockedPhase(node.phase) || isBlockedPhase(dependencyNode.phase)
        ? "blocked"
        : isSettledPhase(node.phase)
          ? "settled"
          : node.phase === "RUNNING" || node.phase === "CODING_COMPLETED"
            ? "active"
            : "pending";

      edges.push({
        id: `${dependencyId}->${node.task.id}`,
        from: dependencyId,
        to: node.task.id,
        state,
      });
    }
  }

  const adjacencies: SprintDagAdjacencyModel[] = [];
  for (const column of sortedColumns) {
    for (let i = 0; i < column.length - 1; i++) {
      adjacencies.push({
        id: `${column[i].task.id}~${column[i + 1].task.id}`,
        from: column[i].task.id,
        to: column[i + 1].task.id,
      });
    }
  }

  return {
    nodes,
    edges,
    adjacencies,
    columns: sortedColumns,
    metrics: {
      rootCount: nodes.filter((node) => node.incoming.length === 0).length,
      longestChain: Math.max(0, ...nodes.map((node) => node.depth + 1)),
      readyCount: nodes.filter((node) => node.isReady).length,
      runningCount: nodes.filter((node) => node.phase === "RUNNING").length,
      codingCompletedCount: nodes.filter((node) => node.phase === "CODING_COMPLETED").length,
      completedCount: nodes.filter((node) => node.phase === "COMPLETED").length,
    },
  };
}
