import type { QaReviewRepository, QaReviewRunRecord } from "../../repositories/qa-review-repository.js";
import type { QaReviewRunnerOutcome } from "./qa-review-runner.js";

export interface QaReviewStateDependencies {
  qaReviewRepository: QaReviewRepository;
}

export class QaReviewState {
  constructor(private readonly deps: QaReviewStateDependencies) {}

  markQaReviewSuccess(run: QaReviewRunRecord, outcome: Extract<QaReviewRunnerOutcome, { status: "success" }>, taskSnapshot?: string): QaReviewRunRecord {
    return this.deps.qaReviewRepository.updateRun(run.id, {
      status: "completed",
      outcome: outcome.review.verdict,
      summaryMarkdown: outcome.review.summary,
      fixInstructions: outcome.review.fixInstructions,
      targetTaskKey: outcome.review.targetTaskKey,
      payload: {
        ...outcome.review.raw,
        taskSnapshot,
      },
      finishedAt: new Date().toISOString(),
    });
  }

  markQaReviewFailed(run: QaReviewRunRecord, outcome: Extract<QaReviewRunnerOutcome, { status: "error" }>): QaReviewRunRecord {
    return this.deps.qaReviewRepository.updateRun(run.id, {
      status: "errored",
      summaryMarkdown: outcome.error.message,
      payload: {
        error_reason: outcome.error.code,
        error_code: outcome.error.code,
        errorMessage: outcome.error.message,
      },
      finishedAt: new Date().toISOString(),
    });
  }
}
