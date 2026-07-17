import { createHash } from "node:crypto";
import type { JulesActivity, JulesActivityArtifact } from "../../contracts/app-types.js";

export const JULES_USAGE_ACTIVITY_PAGE_SIZE = 10;
export const JULES_MAX_USAGE_ACTIVITIES = 10_000;
export const JULES_MAX_USAGE_TEXT_CHARS = 32 * 1024 * 1024;
export const JULES_MAX_USAGE_PATCH_CHARS = 32 * 1024 * 1024;
export const JULES_MAX_USAGE_PATCH_TOTAL_CHARS = 64 * 1024 * 1024;
export const JULES_MAX_USAGE_FIELD_CHARS = 2 * 1024 * 1024;

const TRUNCATION_MARKER = "\n\n… [Jules history field truncated for memory safety] …\n\n";

export interface JulesUsageProjectionDiagnostics {
  activitiesSeen: number;
  activitiesRetained: number;
  activitiesOmitted: number;
  changeSetSnapshotsSeen: number;
  changeSetSnapshotsRetained: number;
  duplicateChangeSetSnapshots: number;
  supersededChangeSetSnapshots: number;
  mediaPayloadCharsDiscarded: number;
  textCharsOmitted: number;
  patchCharsOmitted: number;
}

export interface JulesUsageConversation {
  activities: JulesActivity[];
  diagnostics: JulesUsageProjectionDiagnostics;
}

export interface JulesUsagePatchSnapshot {
  source: string;
  patchChars: number;
}

export interface JulesUsageActivityProjection {
  patchSnapshots?: JulesUsagePatchSnapshot[];
}

export type ProjectedJulesActivity = JulesActivity & {
  codeUxUsageProjection?: JulesUsageActivityProjection;
};

interface RetainedPatch {
  activity: JulesActivity;
  artifact: JulesActivityArtifact;
  patch: string;
  originalChars: number;
  fingerprint: string;
}

function createDiagnostics(): JulesUsageProjectionDiagnostics {
  return {
    activitiesSeen: 0,
    activitiesRetained: 0,
    activitiesOmitted: 0,
    changeSetSnapshotsSeen: 0,
    changeSetSnapshotsRetained: 0,
    duplicateChangeSetSnapshots: 0,
    supersededChangeSetSnapshots: 0,
    mediaPayloadCharsDiscarded: 0,
    textCharsOmitted: 0,
    patchCharsOmitted: 0,
  };
}

function truncateWithMarker(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  if (maxChars <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, maxChars);
  }
  const contentBudget = maxChars - TRUNCATION_MARKER.length;
  const headChars = Math.ceil(contentBudget * 0.7);
  const tailChars = contentBudget - headChars;
  return `${value.slice(0, headChars)}${TRUNCATION_MARKER}${tailChars > 0 ? value.slice(-tailChars) : ""}`;
}

function removeArtifact(activity: JulesActivity, artifact: JulesActivityArtifact): void {
  const artifacts = activity.artifacts;
  if (!artifacts) {
    return;
  }
  const index = artifacts.indexOf(artifact);
  if (index >= 0) {
    artifacts.splice(index, 1);
  }
  if (artifacts.length === 0) {
    delete activity.artifacts;
  }
}

/**
 * Reduces Jules' cumulative activity feed to the fields needed for token
 * estimation and invocation rendering. The API commonly repeats the complete
 * current Git patch on every progress activity; only the newest snapshot for a
 * source is retained, while every progress/tool activity itself remains.
 */
export class JulesUsageConversationProjector {
  private readonly activities: JulesActivity[] = [];
  private readonly latestPatchBySource = new Map<string, RetainedPatch>();
  private readonly diagnostics = createDiagnostics();
  private retainedTextChars = 0;
  private retainedPatchChars = 0;

  addPage(rawActivities: JulesActivity[]): void {
    for (const raw of rawActivities) {
      this.addActivity(raw);
    }
  }

  finish(): JulesUsageConversation {
    this.diagnostics.activitiesRetained = this.activities.length;
    this.diagnostics.changeSetSnapshotsRetained = this.latestPatchBySource.size;
    return {
      activities: this.activities,
      diagnostics: { ...this.diagnostics },
    };
  }

  private retainText(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length === 0) {
      return undefined;
    }
    const remaining = Math.max(0, JULES_MAX_USAGE_TEXT_CHARS - this.retainedTextChars);
    const limit = Math.min(JULES_MAX_USAGE_FIELD_CHARS, remaining);
    if (limit <= 0) {
      this.diagnostics.textCharsOmitted += value.length;
      return undefined;
    }
    const retained = truncateWithMarker(value, limit);
    this.retainedTextChars += retained.length;
    this.diagnostics.textCharsOmitted += Math.max(0, value.length - retained.length);
    return retained;
  }

  private retainPatch(value: string): string {
    const availableTotal = Math.max(
      0,
      JULES_MAX_USAGE_PATCH_TOTAL_CHARS - this.retainedPatchChars,
    );
    const limit = Math.min(JULES_MAX_USAGE_PATCH_CHARS, availableTotal);
    const retained = truncateWithMarker(value, limit);
    this.diagnostics.patchCharsOmitted += Math.max(0, value.length - retained.length);
    return retained;
  }

  private addActivity(raw: JulesActivity): void {
    this.diagnostics.activitiesSeen += 1;
    if (this.activities.length >= JULES_MAX_USAGE_ACTIVITIES) {
      this.diagnostics.activitiesOmitted += 1;
      return;
    }

    const activity: JulesActivity = {
      name: typeof raw.name === "string" ? raw.name : "",
      id: typeof raw.id === "string" ? raw.id : "",
      createTime: typeof raw.createTime === "string" ? raw.createTime : "",
      ...(typeof raw.originator === "string" ? { originator: raw.originator } : {}),
    };
    const description = this.retainText(raw.description);
    if (description) {
      activity.description = description;
    }

    const agentMessage = this.retainText(raw.agentMessaged?.agentMessage);
    if (agentMessage) {
      activity.agentMessaged = { agentMessage };
    }
    const userMessage = this.retainText(raw.userMessaged?.userMessage);
    if (userMessage) {
      activity.userMessaged = { userMessage };
    }
    if (Array.isArray(raw.planGenerated?.plan?.steps)) {
      activity.planGenerated = {
        plan: {
          steps: raw.planGenerated.plan.steps.map((step) => {
            const title = this.retainText(step.title);
            const stepDescription = this.retainText(step.description);
            return {
              ...(title ? { title } : {}),
              ...(stepDescription ? { description: stepDescription } : {}),
            };
          }),
        },
      };
    }
    const planId = this.retainText(raw.planApproved?.planId);
    if (planId) {
      activity.planApproved = { planId };
    }
    if (raw.progressUpdated) {
      const title = this.retainText(raw.progressUpdated.title);
      const progressDescription = this.retainText(raw.progressUpdated.description);
      activity.progressUpdated = {
        ...(title ? { title } : {}),
        ...(progressDescription ? { description: progressDescription } : {}),
      };
    }
    const failureReason = this.retainText(raw.sessionFailed?.reason);
    if (failureReason) {
      activity.sessionFailed = { reason: failureReason };
    }
    if (raw.sessionCompleted !== undefined && raw.sessionCompleted !== null) {
      activity.sessionCompleted = {};
    }

    this.activities.push(activity);
    for (const rawArtifact of raw.artifacts || []) {
      this.addArtifact(activity, rawArtifact);
    }
  }

  private addArtifact(activity: JulesActivity, raw: JulesActivityArtifact): void {
    const patch = raw.changeSet?.gitPatch?.unidiffPatch;
    if (typeof patch === "string") {
      this.addChangeSetArtifact(activity, raw, patch);
      return;
    }

    if (raw.bashOutput) {
      const command = this.retainText(raw.bashOutput.command);
      const output = this.retainText(raw.bashOutput.output);
      activity.artifacts ??= [];
      activity.artifacts.push({
        bashOutput: {
          ...(command ? { command } : {}),
          ...(output ? { output } : {}),
          ...(typeof raw.bashOutput.exitCode === "number"
            ? { exitCode: raw.bashOutput.exitCode }
            : {}),
        },
      });
      return;
    }

    if (raw.media) {
      const dataChars = typeof raw.media.data === "string" ? raw.media.data.length : 0;
      this.diagnostics.mediaPayloadCharsDiscarded += dataChars;
      activity.artifacts ??= [];
      activity.artifacts.push({
        media: {
          ...(dataChars > 0 ? { data: "present" } : {}),
          ...(typeof raw.media.mimeType === "string" ? { mimeType: raw.media.mimeType } : {}),
        },
      });
    }
  }

  private addChangeSetArtifact(
    activity: ProjectedJulesActivity,
    raw: JulesActivityArtifact,
    patch: string,
  ): void {
    this.diagnostics.changeSetSnapshotsSeen += 1;
    const source = typeof raw.changeSet?.source === "string" && raw.changeSet.source
      ? raw.changeSet.source
      : "default";
    activity.codeUxUsageProjection ??= {};
    activity.codeUxUsageProjection.patchSnapshots ??= [];
    activity.codeUxUsageProjection.patchSnapshots.push({
      source,
      patchChars: patch.length,
    });
    const previous = this.latestPatchBySource.get(source);
    const fingerprint = createHash("sha256").update(patch).digest("hex");
    if (previous?.originalChars === patch.length && previous.fingerprint === fingerprint) {
      this.diagnostics.duplicateChangeSetSnapshots += 1;
    } else if (previous) {
      this.diagnostics.supersededChangeSetSnapshots += 1;
    }
    if (previous) {
      removeArtifact(previous.activity, previous.artifact);
      this.retainedPatchChars -= previous.patch.length;
    }
    if (patch.length === 0) {
      this.latestPatchBySource.delete(source);
      return;
    }

    const retainedPatch = this.retainPatch(patch);
    const suggestedCommitMessage = this.retainText(
      raw.changeSet?.gitPatch?.suggestedCommitMessage,
    );
    const artifact: JulesActivityArtifact = {
      changeSet: {
        ...(source !== "default" ? { source } : {}),
        gitPatch: {
          unidiffPatch: retainedPatch,
          ...(typeof raw.changeSet?.gitPatch?.baseCommitId === "string"
            ? { baseCommitId: raw.changeSet.gitPatch.baseCommitId }
            : {}),
          ...(suggestedCommitMessage ? { suggestedCommitMessage } : {}),
        },
      },
    };
    activity.artifacts ??= [];
    activity.artifacts.push(artifact);
    this.retainedPatchChars += retainedPatch.length;
    this.latestPatchBySource.delete(source);
    this.latestPatchBySource.set(source, {
      activity,
      artifact,
      patch: retainedPatch,
      originalChars: patch.length,
      fingerprint,
    });
  }
}
