import type { ExecutionInvocationRecord } from "../../contracts/invocation-types.js";

export interface PlanningInvocationMetrics {
  durationsMs: number[];
}

export function fetchProjectPlanningMetrics(
  listProjectInvocations: (projectId: string) => ExecutionInvocationRecord[],
  projectId: string,
  limit: number = 10
): PlanningInvocationMetrics {
  const invocations = listProjectInvocations(projectId);

  const durationsMs = invocations
    .filter((inv) => inv.type === "planning" && inv.status === "completed" && inv.finishedAt && inv.startedAt)
    .slice(0, limit)
    .map((inv) => {
      const start = new Date(inv.startedAt).getTime();
      const finish = new Date(inv.finishedAt!).getTime();
      return Math.max(0, finish - start);
    });

  return { durationsMs };
}
