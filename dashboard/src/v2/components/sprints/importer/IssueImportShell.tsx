import type { ComponentChildren, FunctionComponent } from "preact";
import { AlertTriangle, Github, Gitlab, X } from "lucide-preact";
import type {
  IssueImportErrorCopy,
  IssueImportProviderMetadata,
} from "../../../lib/issue-import-view-models.js";
import { JiraIcon } from "../../icons/JiraIcon.js";

interface IssueImportShellProps {
  provider: IssueImportProviderMetadata;
  title: string;
  description: string;
  onClose: () => void;
  closeLabel: string;
  summaryRail?: ComponentChildren;
  filters: ComponentChildren;
  children: ComponentChildren;
  footer: ComponentChildren;
}

interface IssueImportLoadingSkeletonListProps {
  count?: number;
}

interface IssueImportErrorPanelProps {
  error: IssueImportErrorCopy;
}

export const IssueImportLoadingSkeletonList: FunctionComponent<IssueImportLoadingSkeletonListProps> = ({
  count = 5,
}) => (
  <div className="grid gap-3" aria-label="Loading issues">
    {Array.from({ length: count }).map((_, index) => (
      <div
        key={index}
        className="h-28 animate-pulse rounded-[1.25rem] bg-black/[0.04] dark:bg-white/[0.04]"
      />
    ))}
  </div>
);

export const IssueImportErrorPanel: FunctionComponent<IssueImportErrorPanelProps> = ({ error }) => (
  <div
    role="alert"
    className="mb-4 rounded-[1.1rem] border border-status-red/20 bg-status-red/[0.08] px-4 py-3 text-sm text-status-red"
  >
    <div className="flex items-start gap-2">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.1} aria-hidden="true" />
      <div>
        <div className="font-black">{error.title}</div>
        <div className="mt-1 font-semibold leading-relaxed">{error.message}</div>
      </div>
    </div>
  </div>
);

export const IssueImportShell: FunctionComponent<IssueImportShellProps> = ({
  provider,
  title,
  description,
  onClose,
  closeLabel,
  summaryRail,
  filters,
  children,
  footer,
}) => (
  <div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/55 px-3 py-4 backdrop-blur-xl dark:bg-black/75 sm:px-4 sm:py-6">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="issue-import-title"
      aria-describedby="issue-import-description"
      className="flex max-h-[92vh] w-full max-w-7xl overflow-hidden rounded-[2rem] border border-white/70 bg-white shadow-[0_48px_120px_rgba(15,23,42,0.28)] outline-none dark:border-white/[0.08] dark:bg-void-800 dark:shadow-[0_48px_120px_rgba(0,0,0,0.72)]"
    >
      {summaryRail}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.06] px-4 py-4 dark:border-white/[0.06] sm:px-6 sm:py-5">
          <div className="min-w-0">
            <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${provider.accent.badgeClassName}`}>
              <ProviderIcon provider={provider} />
              {provider.importLabel}
            </div>
            <h2 id="issue-import-title" className="mt-3 font-display text-xl font-semibold leading-none text-slate-900 dark:text-white sm:text-3xl">
              {title}
            </h2>
            <p id="issue-import-description" className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              {description}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/[0.04] text-slate-400 transition-colors hover:bg-black/[0.08] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 ${provider.accent.focusRingClassName} dark:bg-white/[0.05] dark:hover:text-white`}
            aria-label={closeLabel}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7">
            {filters}
          </div>
          <div className="p-5 sm:p-7">
            {children}
          </div>
        </div>

        <footer className="border-t border-black/[0.06] p-5 dark:border-white/[0.06] sm:p-7">
          {footer}
        </footer>
      </div>
    </div>
  </div>
);

const ProviderIcon: FunctionComponent<{ provider: IssueImportProviderMetadata }> = ({ provider }) => {
  if (provider.icon === "gitlab") {
    return <Gitlab className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />;
  }
  if (provider.icon === "jira") {
    return <JiraIcon className="h-3.5 w-3.5" />;
  }
  return <Github className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />;
};
