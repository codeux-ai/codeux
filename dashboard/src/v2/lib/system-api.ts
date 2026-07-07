import { fetchJson } from "../../lib/api/fetch-json.js";

export type UpdateDownloadTargetKind = "npm" | "electron";

export interface UpdateDownloadTarget {
  kind: UpdateDownloadTargetKind;
  label: string;
  url: string;
}

export interface UpdateDownloadTargets {
  npm: UpdateDownloadTarget & { kind: "npm" };
  electron: UpdateDownloadTarget & { kind: "electron" };
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadTargets: UpdateDownloadTargets;
  checkedAt: string;
  error?: string;
}

export const fetchUpdateStatus = async (): Promise<UpdateStatus> => fetchJson("/api/system/update-status");
