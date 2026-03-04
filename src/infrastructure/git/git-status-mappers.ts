import type {
  GitPullRequestStatus,
  GitCiRunStatus,
  GitMergeStatus,
  GitCiFailedJob,
} from "../../contracts/app-types.js";

export const parseJson = <T>(value: string): T | null => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
};

export const toInt = (value: unknown): number | null => (typeof value === "number" ? value : null);
export const toStr = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function parseOpenPrs(stdout: string): { data: GitPullRequestStatus[]; warning?: string } {
  const parsed = parseJson<Array<Record<string, unknown>>>(stdout);
  if (!parsed) {
    return { data: [], warning: "Could not parse pull request status response." };
  }

  const data: GitPullRequestStatus[] = parsed.map((item) => {
    const rollup = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : [];
    const checks = rollup
      .map((check) => {
        if (!check || typeof check !== "object") return null;
        const candidate = check as Record<string, unknown>;
        const name = toStr(candidate.name) || toStr(candidate.context) || "check";
        const status = toStr(candidate.status) || "UNKNOWN";
        const conclusion = toStr(candidate.conclusion);
        return { name, status, conclusion };
      })
      .filter((check): check is { name: string; status: string; conclusion: string | null } => check !== null);

    const commentsObj = (item.comments && typeof item.comments === "object")
      ? (item.comments as Record<string, unknown>)
      : null;
    const commentsFromObject = commentsObj ? toInt(commentsObj.totalCount) : null;
    const commentsFromNumber = toInt(item.comments);
    const comments = commentsFromNumber ?? commentsFromObject ?? 0;

    return {
      number: toInt(item.number) ?? 0,
      title: toStr(item.title) ?? "Untitled PR",
      url: toStr(item.url) ?? "",
      state: toStr(item.state) ?? "UNKNOWN",
      isDraft: item.isDraft === true,
      headRefName: toStr(item.headRefName),
      baseRefName: toStr(item.baseRefName),
      mergeStateStatus: toStr(item.mergeStateStatus),
      reviewDecision: toStr(item.reviewDecision),
      updatedAt: toStr(item.updatedAt),
      comments,
      checks,
    };
  });

  return { data };
}

export function parseCiRuns(stdout: string): { data: GitCiRunStatus[]; warning?: string } {
  const parsed = parseJson<Array<Record<string, unknown>>>(stdout);
  if (!parsed) {
    return { data: [], warning: "Could not parse CI run response." };
  }

  const data: GitCiRunStatus[] = parsed.map((item) => ({
    id: toInt(item.databaseId),
    name: toStr(item.name) ?? "workflow",
    workflowName: toStr(item.workflowName),
    status: toStr(item.status) ?? "UNKNOWN",
    conclusion: toStr(item.conclusion),
    event: toStr(item.event),
    headBranch: toStr(item.headBranch),
    url: toStr(item.url) ?? "",
    updatedAt: toStr(item.updatedAt),
  }));

  return { data };
}

export function parseMergedPrs(stdout: string): { data: GitMergeStatus[]; warning?: string } {
  const parsed = parseJson<Array<Record<string, unknown>>>(stdout);
  if (!parsed) {
    return { data: [], warning: "Could not parse merged PR response." };
  }

  const data: GitMergeStatus[] = parsed.map((item) => {
    const mergedByObj = (item.mergedBy && typeof item.mergedBy === "object")
      ? (item.mergedBy as Record<string, unknown>)
      : null;
    return {
      number: toInt(item.number) ?? 0,
      title: toStr(item.title) ?? "Merged PR",
      url: toStr(item.url) ?? "",
      headRefName: toStr(item.headRefName),
      baseRefName: toStr(item.baseRefName),
      mergedAt: toStr(item.mergedAt),
      mergedBy: mergedByObj ? toStr(mergedByObj.login) : null,
    };
  });

  return { data };
}
