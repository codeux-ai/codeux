import { fetchJson } from "../../../lib/api/fetch-json.js";

export interface ForceCompleteLiveTaskInput {
  reason?: string;
}

export const forceCompleteLiveTask = async (
  projectId: string,
  taskId: string,
  input?: ForceCompleteLiveTaskInput,
): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/force-complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: input?.reason ?? "Completed manually",
      }),
    },
  );
};
