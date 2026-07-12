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

interface ParsedStatusCheck {
  name: string;
  status: string;
  conclusion: string | null;
  workflowName: string | null;
  observedAt: number;
  inputIndex: number;
}

function parseStatusCheck(check: unknown, inputIndex: number): ParsedStatusCheck | null {
  if (!check || typeof check !== "object") return null;
  const candidate = check as Record<string, unknown>;
  const name = toStr(candidate.name) || toStr(candidate.context) || "check";
  const startedAt = toStr(candidate.startedAt);
  const completedAt = toStr(candidate.completedAt);
  const timestamp = Date.parse(startedAt || completedAt || "");
  return {
    name,
    status: toStr(candidate.status) || "UNKNOWN",
    conclusion: toStr(candidate.conclusion),
    workflowName: toStr(candidate.workflowName),
    observedAt: Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY,
    inputIndex,
  };
}

/**
 * GitHub can retain superseded CheckRun rows in a head commit's status rollup.
 * Only the latest observation for a logical workflow/check pair is actionable;
 * otherwise an older cancelled run can keep a PR failed after its rerun passes.
 */
export function normalizeStatusCheckRollup(rollup: unknown[]): Array<{
  name: string;
  status: string;
  conclusion: string | null;
}> {
  const latestByCheck = new Map<string, ParsedStatusCheck>();
  rollup.forEach((value, inputIndex) => {
    const check = parseStatusCheck(value, inputIndex);
    if (!check) return;
    const key = `${check.workflowName || ""}\0${check.name}`;
    const existing = latestByCheck.get(key);
    if (
      !existing
      || check.observedAt > existing.observedAt
      || (check.observedAt === existing.observedAt && check.inputIndex > existing.inputIndex)
    ) {
      latestByCheck.set(key, check);
    }
  });

  return [...latestByCheck.values()]
    .sort((left, right) => left.inputIndex - right.inputIndex)
    .map(({ name, status, conclusion }) => ({ name, status, conclusion }));
}

export function parseOpenPrs(stdout: string): { data: GitPullRequestStatus[]; warning?: string } {
  const parsed = parseJson<Array<Record<string, unknown>>>(stdout);
  if (!parsed) {
    return { data: [], warning: "Could not parse pull request status response." };
  }

  const data: GitPullRequestStatus[] = parsed.map((item) => {
    const rollup = Array.isArray(item.statusCheckRollup) ? item.statusCheckRollup : [];
    const checks = normalizeStatusCheckRollup(rollup);

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
    headSha: toStr(item.headSha),
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
