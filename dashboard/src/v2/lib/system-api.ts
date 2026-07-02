import { fetchJson } from "../../lib/api/fetch-json.js";

export const fetchUpdateStatus = async (): Promise<{
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
}> => fetchJson("/api/system/update-status");
