import type {
  GuardrailJobType,
  GuardrailOnLimitAction,
  GuardrailSettings,
} from "../contracts/app-types.js";
import type { ProjectSettings } from "../contracts/settings-scope-types.js";
import type { GuardrailRepository, GuardrailLedgerPurpose } from "../repositories/guardrail-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface GuardrailScope {
  projectId: string;
  sprintId?: string | null;
}

export interface GuardrailEvaluation {
  /** Whether another invocation of this job type is permitted for the task. */
  allowed: boolean;
  /** Current recorded count BEFORE this invocation. */
  count: number;
  /** Effective cap (0 = unlimited). */
  cap: number;
  /** Action to take when the cap is exceeded. */
  action: GuardrailOnLimitAction;
  /** Whether the per-task total ceiling (not the per-job cap) was the blocking limit. */
  blockedByTotalCeiling?: boolean;
  /** Human-readable summary for attention items / logs. */
  reason?: string;
}

/** Thrown by the central provider execution path when a guardrail cap is exceeded. */
export class GuardrailLimitError extends Error {
  constructor(
    public readonly purpose: GuardrailLedgerPurpose,
    public readonly evaluation: GuardrailEvaluation,
  ) {
    super(evaluation.reason ?? `Guardrail limit reached for ${purpose}`);
    this.name = "GuardrailLimitError";
  }
}

export type ResolveGuardrailSettings = (scope: GuardrailScope) => GuardrailSettings;

/**
 * Single source of truth for per-task, per-job-type invocation guardrails. Backed by the
 * persisted {@link GuardrailRepository} (survives restarts, shared across the orchestrator
 * and virtual worker). Replaces the legacy in-memory retry Maps.
 */
export class GuardrailService {
  constructor(
    private readonly repo: GuardrailRepository,
    private readonly resolveSettings: ResolveGuardrailSettings,
    private readonly logger?: Logger,
  ) {}

  private settingsFor(scope: GuardrailScope): GuardrailSettings | null {
    try {
      return this.resolveSettings(scope);
    } catch (error) {
      this.logger?.warn("Failed to resolve guardrail settings; allowing invocation", { scope, error });
      return null;
    }
  }

  private evaluateInternal(
    scope: GuardrailScope,
    taskId: string,
    purpose: GuardrailLedgerPurpose,
    cap: number,
    action: GuardrailOnLimitAction,
    settings: GuardrailSettings,
  ): GuardrailEvaluation {
    const count = this.repo.getCount(taskId, purpose);

    // Per-task total ceiling (across all job types) acts as a hard upper bound.
    const ceiling = settings.perTaskTotalCeiling;
    if (ceiling > 0) {
      const total = this.repo.getTotal(taskId);
      if (total >= ceiling) {
        return {
          allowed: false,
          count,
          cap,
          action,
          blockedByTotalCeiling: true,
          reason: `Per-task total invocation ceiling reached (${total}/${ceiling}).`,
        };
      }
    }

    if (cap <= 0) {
      return { allowed: true, count, cap, action };
    }
    const allowed = count < cap;
    return {
      allowed,
      count,
      cap,
      action,
      reason: allowed ? undefined : `Reached max ${purpose} invocations for this task (${count}/${cap}).`,
    };
  }

  /** Evaluate a per-job-type guardrail. Allowed by default when guardrails are disabled. */
  evaluate(scope: GuardrailScope, taskId: string, purpose: GuardrailJobType): GuardrailEvaluation {
    const settings = this.settingsFor(scope);
    const jobConfig = settings?.jobs[purpose];
    if (!settings || !settings.enabled || !jobConfig) {
      return { allowed: true, count: 0, cap: 0, action: jobConfig?.onLimit ?? "WARN_ONLY" };
    }
    return this.evaluateInternal(scope, taskId, purpose, jobConfig.cap, jobConfig.onLimit, settings);
  }

  /** Record one invocation of the given purpose for the task. Returns the new count. */
  record(scope: GuardrailScope, taskId: string, purpose: GuardrailLedgerPurpose): number {
    const count = this.repo.record({ projectId: scope.projectId, taskId, purpose });
    this.logger?.debug?.("Guardrail invocation recorded", { taskId, purpose, count });
    return count;
  }

  getCounts(taskId: string): Record<GuardrailLedgerPurpose, number> {
    return this.repo.getCounts(taskId);
  }

  /** Clears all guardrail counters for a task (e.g. on merge-ready or manual retry). */
  reset(taskId: string): void {
    this.repo.reset(taskId);
  }
}
