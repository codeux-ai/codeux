import { fetchJson } from "../../../lib/api/fetch-json.js";

export interface SprintComposerEtaResponse {
  estimatedMs: number;
  sampleSize: number;
  isFallback: boolean;
}

export const fetchSprintComposerEta = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<SprintComposerEtaResponse> => {
  return fetchJson<SprintComposerEtaResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/composer/eta`,
    { signal },
  );
};
