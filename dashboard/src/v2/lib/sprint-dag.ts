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
  isFocusMode: boolean;
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

  const incomingById = new Map<string, string[]>();
  const outgoingById = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const task of tasks) {
    incomingById.set(task.id, []);
    outgoingById.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  for (const task of tasks) {
    if (Array.isArray(task.depends_on)) {
      for (const dependencyId of task.depends_on) {
        if (tasksById.has(dependencyId)) {
          incomingById.get(task.id)!.push(dependencyId);
          outgoingById.get(dependencyId)!.push(task.id);
          inDegree.set(task.id, inDegree.get(task.id)! + 1);
        }
      }
    }
  }

  const depthMap = new Map<string, number>();
  const queue: string[] = [];

  for (const [taskId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(taskId);
      depthMap.set(taskId, 0);
    }
  }

  while (queue.length > 0) {
    const taskId = queue.shift()!;

    for (const outgoingId of outgoingById.get(taskId)!) {
      inDegree.set(outgoingId, inDegree.get(outgoingId)! - 1);
      if (inDegree.get(outgoingId) === 0) {
        queue.push(outgoingId);
        const incomingDepths = incomingById.get(outgoingId)!.map((id) => depthMap.get(id) || 0);
        depthMap.set(outgoingId, Math.max(...incomingDepths) + 1);
      }
    }
  }

  // Handle cycles: Any nodes remaining with inDegree > 0
  const remainingIds = Array.from(inDegree.entries())
    .filter(([, degree]) => degree > 0)
    .map(([id]) => id)
    .sort(); // sort to be deterministic

  while (remainingIds.length > 0) {
    const cycleStartId = remainingIds.shift()!;
    if (inDegree.get(cycleStartId)! > 0) {
      inDegree.set(cycleStartId, 0);
      const incomingDepths = incomingById.get(cycleStartId)!
        .map((id) => depthMap.get(id) ?? -1)
        .filter((depth) => depth !== -1);

      depthMap.set(cycleStartId, incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : 0);
      queue.push(cycleStartId);

      while (queue.length > 0) {
        const taskId = queue.shift()!;
        for (const outgoingId of outgoingById.get(taskId)!) {
          inDegree.set(outgoingId, inDegree.get(outgoingId)! - 1);
          if (inDegree.get(outgoingId) === 0) {
            queue.push(outgoingId);
            const incomingDepths = incomingById.get(outgoingId)!
              .map((id) => depthMap.get(id) ?? -1)
              .filter((depth) => depth !== -1);
            depthMap.set(outgoingId, incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : 0);
          }
        }
      }
    }
  }

  let rootCount = 0;
  let longestChain = 0;
  let readyCount = 0;
  let runningCount = 0;
  let codingCompletedCount = 0;
  let completedCount = 0;

  const orderedNodes = tasks.map((task, index) => {
    const phase = phaseById.get(task.id) || "PENDING";
    const incoming = incomingById.get(task.id)!;
    const dependencyPhases = incoming.map((dependencyId) => phaseById.get(dependencyId) || "PENDING");

    const hoverPrompt = typeof task.prompt === "string" && task.prompt.trim().length > 0
      ? task.prompt.trim()
      : "No prompt provided";

    const hoverDependencies = incoming.map((id) => ({
      id,
      title: tasksById.get(id)?.title || "Unknown Task",
    }));

    const outgoing = outgoingById.get(task.id)!;
    const depth = depthMap.get(task.id) || 0;
    const isReady = phase === "PENDING" && dependencyPhases.every((dependencyPhase) => isSettledPhase(dependencyPhase));

    if (incoming.length === 0) rootCount++;
    longestChain = Math.max(longestChain, depth + 1);
    if (isReady) readyCount++;
    if (phase === "RUNNING") runningCount++;
    if (phase === "CODING_COMPLETED") codingCompletedCount++;
    if (phase === "COMPLETED") completedCount++;

    return {
      task,
      phase,
      depth,
      row: 0,
      order: index,
      incoming,
      outgoing,
      isReady,
      hover: {
        prompt: hoverPrompt,
        dependencies: hoverDependencies,
        counters: {
          incoming: incoming.length,
          outgoing: outgoing.length,
        },
      },
      isFocusMode: phase === "RUNNING" || phase === "CODING_COMPLETED",
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
      rootCount,
      longestChain,
      readyCount,
      runningCount,
      codingCompletedCount,
      completedCount,
    },
  };
}
