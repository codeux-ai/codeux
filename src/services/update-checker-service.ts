import { CODE_UX_VERSION } from "../shared/config/code-ux-paths.js";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  checkedAt: string;
  error?: string;
}

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_FETCH_TIMEOUT_MS = 2500;
const UPDATE_REGISTRY_URL = "https://registry.npmjs.org/@codeuxai/codeux/latest";

function parseVersionSegment(segment: string): number {
  const value = Number.parseInt(segment, 10);
  return Number.isFinite(value) ? value : 0;
}

function compareDottedVersions(leftVersion: string, rightVersion: string): number {
  const leftSegments = leftVersion.split(".").map(parseVersionSegment);
  const rightSegments = rightVersion.split(".").map(parseVersionSegment);
  const segmentCount = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const left = leftSegments[index] ?? 0;
    const right = rightSegments[index] ?? 0;
    if (left > right) {
      return 1;
    }
    if (left < right) {
      return -1;
    }
  }

  return 0;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class UpdateCheckerService {
  private cachedStatus: UpdateStatus | null = null;
  private cachedAtMs = 0;

  constructor(
    private readonly cacheTtlMs: number = DEFAULT_CACHE_TTL_MS,
    private readonly fetchTimeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  checkForUpdate(): Promise<UpdateStatus>;
  checkForUpdate(forceRefresh: boolean): Promise<UpdateStatus>;
  async checkForUpdate(forceRefresh = false): Promise<UpdateStatus> {
    if (
      !forceRefresh
      && this.cachedStatus
      && Date.now() - this.cachedAtMs < this.cacheTtlMs
    ) {
      return this.cachedStatus;
    }

    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);

    try {
      const response = await fetch(UPDATE_REGISTRY_URL, {
        signal: controller.signal,
        redirect: "follow",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      }

      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("Update registry response was not an object.");
      }

      const latestVersion = (payload as { version?: unknown }).version;
      if (typeof latestVersion !== "string" || latestVersion.trim().length === 0) {
        throw new Error("Update registry response was missing a version string.");
      }

      const normalizedLatestVersion = latestVersion.trim();
      const status: UpdateStatus = {
        currentVersion: CODE_UX_VERSION,
        latestVersion: normalizedLatestVersion,
        updateAvailable: compareDottedVersions(normalizedLatestVersion, CODE_UX_VERSION) > 0,
        checkedAt,
      };

      this.cachedStatus = status;
      this.cachedAtMs = Date.now();
      return status;
    } catch (error) {
      const status: UpdateStatus = {
        currentVersion: CODE_UX_VERSION,
        latestVersion: null,
        updateAvailable: false,
        checkedAt,
        error: controller.signal.aborted
          ? `Update check timed out after ${this.fetchTimeoutMs}ms.`
          : toErrorMessage(error),
      };

      this.cachedStatus = status;
      this.cachedAtMs = Date.now();
      return status;
    } finally {
      clearTimeout(timeout);
    }
  }
}
