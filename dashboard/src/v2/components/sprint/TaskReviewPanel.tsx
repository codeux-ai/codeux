import { h } from "preact";
import { AlertCircle } from "lucide-preact";

export interface TaskReviewPanelProps {
  task: {
    status?: string;
    qa_review?: {
      error_reason?: string;
      [key: string]: any;
    };
  };
}

export function TaskReviewPanel({ task }: TaskReviewPanelProps) {
  if (task.status !== "QA_REVIEW_FAILED") {
    return null;
  }

  const errorReason = task.qa_review?.error_reason || "Review parsing failed";

  return (
    <div
      data-testid="task-review-panel"
      className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3"
    >
      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
      <div>
        <h4 className="text-sm font-semibold text-red-900 mb-1">QA Review Failed</h4>
        <p className="text-sm text-red-700" data-testid="qa-error-reason">
          {errorReason}
        </p>
      </div>
    </div>
  );
}
