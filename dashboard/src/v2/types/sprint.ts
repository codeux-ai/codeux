import type { SprintStatus } from "../types.js";

export type SprintPauseSource = "manual" | "system" | "worker" | "unknown";

export interface SprintStatusPresentationInput {
  state: SprintStatus | string | null | undefined;
  pauseSource?: string | null;
  pauseReason?: string | null;
  stopReason?: string | null;
  stopReasonTitle?: string | null;
  stopReasonDetail?: string | null;
  humanInterventionTitle?: string | null;
  humanInterventionReason?: string | null;
  humanInterventionInstructions?: string | null;
  humanInterventionOwnerType?: string | null;
  attentionType?: string | null;
  completion?: number;
  latestReviewStatus?: string | null;
}

export interface SprintStatusPresentation {
  statusLabel: string;
  title: string;
  reason: string;
  detail: string;
  showHumanInterventionBadge: boolean;
  pauseSource: SprintPauseSource;
  isManualPause: boolean;
  isSystemStop: boolean;
}
