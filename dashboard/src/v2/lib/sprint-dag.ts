import type { Subtask } from "../../types.js";
import { getTaskProgressPhase, type TaskProgressPhase } from "../../lib/task-progress.js";

export interface SprintDagNodeModel {
  task: Subtask;
  phase: TaskProgressPhase;
  depth: number;
  row: number;
  order: number;
  incoming: string[];
  outgoing: string[];
  isReady: boolean;
}

export interface SprintDagEdgeModel {
  id: string;
  from: string;
  to: string;
  state: "pending" | "active" | "settled" | "blocked";
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
  columns: SprintDagNodeModel[][];
  metrics: SprintDagMetrics;
}

export function getSprintDagFocusNodeIds(model: SprintDagModel): string[] {
  const byPriority = (predicate: (node: SprintDagNodeModel) => boolean): string[] => (
    model.nodes
      .filter(predicate)
      .sort((left, right) => {
        if (left.depth !== right.depth) {
          return left.depth - right.depth;
        }
        if (left.row !== right.row) {
          return left.row - right.row;
        }
        return left.order - right.order;
      })
      .map((node) => node.task.id)
  );

  const running = byPriority((node) => node.phase === "RUNNING");
  if (running.length > 0) {
    return running;
  }

  const codingCompleted = byPriority((node) => node.phase === "CODING_COMPLETED");
  if (codingCompleted.length > 0) {
    return codingCompleted;
  }

  const ready = byPriority((node) => node.isReady);
  if (ready.length > 0) {
    return ready;
  }

  const unresolved = byPriority((node) => node.phase !== "COMPLETED");
  if (unresolved.length > 0) {
    return unresolved;
  }

  return model.nodes
    .slice()
    .sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth;
      }
      if (left.row !== right.row) {
        return left.row - right.row;
      }
      return left.order - right.order;
    })
    .map((node) => node.task.id);
}

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

    return {
      task,
      phase,
      depth: getDepth(task.id),
      row: 0,
      order: index,
      incoming,
      outgoing: outgoingById.get(task.id) || [],
      isReady: phase === "PENDING" && dependencyPhases.every((dependencyPhase) => isSettledPhase(dependencyPhase)),
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

  return {
    nodes,
    edges,
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
