import type { ComponentChildren, FunctionComponent } from "preact";
import { Search } from "lucide-preact";

interface IssueImportEmptyStateProps {
  title: string;
  description: string;
  action?: ComponentChildren;
}

export const IssueImportEmptyState: FunctionComponent<IssueImportEmptyStateProps> = ({
  title,
  description,
  action,
}) => (
  <section className="rounded-[1.5rem] border border-dashed border-black/[0.1] bg-black/[0.015] p-8 text-center dark:border-white/[0.1] dark:bg-white/[0.02] sm:p-10">
    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[1rem] bg-black/[0.04] text-slate-400 dark:bg-white/[0.05] dark:text-slate-500">
      <Search className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
    </div>
    <h3 className="mt-4 text-sm font-black text-slate-900 dark:text-white">
      {title}
    </h3>
    <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-500 dark:text-slate-400">
      {description}
    </p>
    {action && (
      <div className="mt-5 flex justify-center">
        {action}
      </div>
    )}
  </section>
);
