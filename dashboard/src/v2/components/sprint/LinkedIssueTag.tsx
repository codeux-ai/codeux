import type { FunctionComponent } from "preact";
import { Link2 } from "lucide-preact";

export interface LinkedIssueTagProps {
  issue: { id: string; issueKey: string; title: string; status?: string };
}

export const LinkedIssueTag: FunctionComponent<LinkedIssueTagProps> = ({ issue }) => {
  let bg = "bg-[var(--bg-status-info-subtle)]";
  let text = "text-[var(--text-status-info-bold)]";
  let border = "border-[var(--border-status-info-subtle)]";

  if (issue.status) {
    const s = issue.status.toLowerCase();
    if (s === "done" || s === "completed") {
      bg = "bg-[var(--bg-status-success-subtle)]";
      text = "text-[var(--text-status-success-bold)]";
      border = "border-[var(--border-status-success-subtle)]";
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[4px] border px-[8px] h-[20px] text-[11px] font-medium ${bg} ${text} ${border} dark:!bg-white/[0.04] dark:!border-white/[0.1] dark:!text-slate-300`}
      title={issue.title}
    >
      <Link2 className="h-3 w-3" strokeWidth={2.2} />
      {issue.issueKey}
    </span>
  );
};
