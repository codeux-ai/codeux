export type GithubIntakeExternalKind = "issue" | "pull_request";
export type GithubIntakeActionClass = "implement" | "repair";
export type GithubIntakeStatus = "seen" | "claimed" | "dispatched" | "completed" | "failed" | "held" | "ignored";

export interface GithubIntakeItem {
  id: string;
  projectId: string;
  provider: string;
  hostDomain: string;
  repository: string;
  externalKind: GithubIntakeExternalKind;
  externalNumber: number;
  observedVersion: string;
  actionClass: GithubIntakeActionClass;
  policyVersion: string;
  idempotencyKey: string;
  disposition: string;
  status: GithubIntakeStatus;
  title: string;
  url: string;
  labels: unknown[];
  payload: Record<string, unknown>;
  sprintId: string | null;
  taskId: string | null;
  dispatchId: string | null;
  claimedAt: string | null;
  terminalAt: string | null;
  nextWakeAt: string | null;
  lastError: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}
