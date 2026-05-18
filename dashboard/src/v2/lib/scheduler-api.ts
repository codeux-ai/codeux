import type {
  CreateSchedulerEntryInput,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  UpdateSchedulerEntryInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchProjectSchedule = async (
  projectId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<SchedulerCollectionResponse> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/scheduler`, window.location.origin);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return fetchJson<SchedulerCollectionResponse>(`${url.pathname}${url.search}`, { signal });
};

export const createSchedulerEntry = async (
  projectId: string,
  input: CreateSchedulerEntryInput,
): Promise<SchedulerEntryRecord> => {
  return fetchJson<SchedulerEntryRecord>(`/api/projects/${encodeURIComponent(projectId)}/scheduler`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateSchedulerEntry = async (
  entryId: string,
  input: UpdateSchedulerEntryInput,
): Promise<SchedulerEntryRecord> => {
  return fetchJson<SchedulerEntryRecord>(`/api/scheduler/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteSchedulerEntry = async (entryId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/scheduler/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
};
