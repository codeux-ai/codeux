export type SystemSortKey = "startedAt" | "inputTokens" | "outputTokens" | "totalTokens" | "durationMs";

export interface SystemSort {
  key: SystemSortKey;
  dir: "asc" | "desc";
}

export interface SystemFilters {
  status: string[];
  purpose: string[];
  provider: string[];
}
