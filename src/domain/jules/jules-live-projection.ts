import type {
  JulesActivity,
  JulesSession,
  PullRequestOutput,
  SessionOutput,
} from "../../contracts/app-types.js";

const MAX_SESSION_IDENTITY_CHARS = 2_048;
const MAX_SESSION_TITLE_CHARS = 16 * 1024;
const MAX_SESSION_PROMPT_CHARS = 128 * 1024;
const MAX_SESSION_OUTPUTS = 8;
const MAX_PULL_REQUEST_FIELD_CHARS = 16 * 1024;
const MAX_ACTIVITY_IDENTITY_CHARS = 2_048;
const MAX_ACTIVITY_TEXT_CHARS = 8 * 1024;
const MAX_ACTIVITY_PLAN_STEPS = 20;
const MAX_ACTIVITY_PLAN_FIELD_CHARS = 1_024;

const truncateText = (value: unknown, maxChars: number): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length <= maxChars) {
    return value;
  }
  const marker = "\n… [truncated for live-view memory safety] …\n";
  const retainedChars = Math.max(0, maxChars - marker.length);
  const headChars = Math.ceil(retainedChars * 0.7);
  const tailChars = retainedChars - headChars;
  return `${value.slice(0, headChars)}${marker}${tailChars > 0 ? value.slice(-tailChars) : ""}`;
};

const projectPullRequestOutput = (raw: PullRequestOutput | undefined): PullRequestOutput | undefined => {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const url = truncateText(raw.url, MAX_PULL_REQUEST_FIELD_CHARS);
  const workerBranch = truncateText(raw.workerBranch, MAX_PULL_REQUEST_FIELD_CHARS);
  const projected: PullRequestOutput = {
    ...(url ? { url } : {}),
    ...(workerBranch ? { workerBranch } : {}),
  };
  for (const field of ["insertions", "deletions", "filesChanged"] as const) {
    const value = raw[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      projected[field] = value;
    } else {
      const text = truncateText(value, 64);
      if (text !== undefined) {
        projected[field] = text;
      }
    }
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
};

/**
 * Projects a list/get session response to the fields used by orchestration.
 * Jules responses may contain large provider-owned fields that the scheduler
 * never reads; retaining those for every cached account session causes heap
 * usage to grow with session age.
 */
export const projectJulesSessionForOrchestration = (raw: JulesSession): JulesSession => {
  const outputs: SessionOutput[] = [];
  for (const output of Array.isArray(raw.outputs) ? raw.outputs.slice(0, MAX_SESSION_OUTPUTS) : []) {
    const pullRequest = projectPullRequestOutput(output?.pullRequest);
    if (pullRequest) {
      outputs.push({ pullRequest });
    }
  }
  const title = truncateText(raw.title, MAX_SESSION_TITLE_CHARS);
  const state = truncateText(raw.state, 128);
  const createTime = truncateText(raw.createTime, 128);
  const updateTime = truncateText(raw.updateTime, 128);

  return {
    name: truncateText(raw.name, MAX_SESSION_IDENTITY_CHARS) || "",
    id: truncateText(raw.id, MAX_SESSION_IDENTITY_CHARS) || "",
    ...(title !== undefined ? { title } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(raw.provider ? { provider: raw.provider } : {}),
    prompt: truncateText(raw.prompt, MAX_SESSION_PROMPT_CHARS) || "",
    ...(createTime !== undefined ? { createTime } : {}),
    ...(updateTime !== undefined ? { updateTime } : {}),
    ...(outputs.length > 0 ? { outputs } : {}),
  };
};

/**
 * Creates the compact activity representation consumed by the live dashboard.
 * Artifacts are deliberately excluded: cumulative git patches, shell output,
 * and base64 media are the dominant source of long-session memory spikes and
 * are not rendered by the live activity feed.
 */
export const projectJulesActivityForLiveView = (raw: JulesActivity): JulesActivity => {
  const originator = truncateText(raw.originator, 128);
  const activity: JulesActivity = {
    name: truncateText(raw.name, MAX_ACTIVITY_IDENTITY_CHARS) || "",
    id: truncateText(raw.id, MAX_ACTIVITY_IDENTITY_CHARS) || "",
    createTime: truncateText(raw.createTime, 128) || "",
    ...(originator !== undefined ? { originator } : {}),
  };

  const agentMessage = truncateText(raw.agentMessaged?.agentMessage, MAX_ACTIVITY_TEXT_CHARS);
  if (agentMessage !== undefined) {
    activity.agentMessaged = { agentMessage };
  }
  const userMessage = truncateText(raw.userMessaged?.userMessage, MAX_ACTIVITY_TEXT_CHARS);
  if (userMessage !== undefined) {
    activity.userMessaged = { userMessage };
  }
  if (raw.progressUpdated) {
    const title = truncateText(raw.progressUpdated.title, MAX_ACTIVITY_TEXT_CHARS);
    const description = truncateText(raw.progressUpdated.description, MAX_ACTIVITY_TEXT_CHARS);
    activity.progressUpdated = {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  }
  if (Array.isArray(raw.planGenerated?.plan?.steps)) {
    activity.planGenerated = {
      plan: {
        steps: raw.planGenerated.plan.steps
          .slice(0, MAX_ACTIVITY_PLAN_STEPS)
          .map((step) => {
            const title = truncateText(step.title, MAX_ACTIVITY_PLAN_FIELD_CHARS);
            const description = truncateText(step.description, MAX_ACTIVITY_PLAN_FIELD_CHARS);
            return {
              ...(title !== undefined ? { title } : {}),
              ...(description !== undefined ? { description } : {}),
            };
          }),
      },
    };
  }
  const planId = truncateText(raw.planApproved?.planId, MAX_ACTIVITY_IDENTITY_CHARS);
  if (planId !== undefined) {
    activity.planApproved = { planId };
  }
  const failureReason = truncateText(raw.sessionFailed?.reason, MAX_ACTIVITY_TEXT_CHARS);
  if (failureReason !== undefined) {
    activity.sessionFailed = { reason: failureReason };
  }
  if (raw.sessionCompleted !== undefined && raw.sessionCompleted !== null) {
    activity.sessionCompleted = {};
  }
  const description = truncateText(raw.description, MAX_ACTIVITY_TEXT_CHARS);
  if (description !== undefined) {
    activity.description = description;
  }

  return activity;
};
