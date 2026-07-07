import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { AlertTriangle, ArrowLeft, Copy, ExternalLink, RefreshCw, ShieldAlert } from "lucide-preact";
import { IconButton } from "../IconButton.js";
import { Button } from "../ui/Button.js";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationReport,
} from "../../types.js";
import {
  buildPublishedCustomDashboardLink,
  createCustomDashboardRuntimeMessageHandler,
  resolvePublishedCustomDashboardRuntime,
} from "../../lib/custom-dashboard-runtime.js";

interface CustomDashboardViewerProps {
  dashboard: CustomDashboardRecord;
  revisions: CustomDashboardRevisionRecord[];
  onRefresh: () => void;
  onReturnToEditor: () => void;
  refreshing?: boolean;
}

export const CustomDashboardViewer: FunctionComponent<CustomDashboardViewerProps> = ({
  dashboard,
  revisions,
  onRefresh,
  onReturnToEditor,
  refreshing = false,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [frameError, setFrameError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const resolution = useMemo(
    () => resolvePublishedCustomDashboardRuntime(dashboard, revisions),
    [dashboard, revisions],
  );
  const dashboardLink = useMemo(() => buildPublishedCustomDashboardLink(dashboard.id), [dashboard.id]);

  useEffect(() => {
    setFrameError(null);
  }, [frameKey, resolution.status]);

  useEffect(() => {
    if (resolution.status !== "ready") {
      return;
    }
    const controller = new AbortController();
    const handler = createCustomDashboardRuntimeMessageHandler({
      frameWindow: iframeRef.current?.contentWindow ?? null,
      runtime: resolution.runtime,
      onRuntimeError: setFrameError,
      signal: controller.signal,
    });
    window.addEventListener("message", handler);
    return () => {
      controller.abort();
      window.removeEventListener("message", handler);
    };
  }, [frameKey, resolution]);

  const handleOpen = (): void => {
    window.open(dashboardLink, "_blank", "noopener,noreferrer");
  };

  const handleRefreshFrame = (): void => {
    setFrameKey((current) => current + 1);
    onRefresh();
  };

  const handleCopyLink = async (): Promise<void> => {
    if (!navigator.clipboard) {
      setCopyLabel("Copy unavailable");
      return;
    }
    await navigator.clipboard.writeText(dashboardLink);
    setCopyLabel("Copied");
    window.setTimeout(() => setCopyLabel("Copy link"), 1500);
  };

  if (resolution.status === "blocked") {
    return (
      <section
        aria-label="Published custom dashboard viewer"
        className="flex min-h-[34rem] min-w-0 flex-col rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]"
      >
        <ViewerToolbar
          title={dashboard.title}
          onOpen={handleOpen}
          onRefresh={handleRefreshFrame}
          onCopyLink={() => { void handleCopyLink(); }}
          onReturnToEditor={onReturnToEditor}
          copyLabel={copyLabel}
          refreshing={refreshing}
          openDisabled
        />
        <div className="mt-4 flex flex-1 items-center justify-center rounded-[1rem] border border-status-red/20 bg-status-red/[0.06] p-6">
          <div className="max-w-2xl text-center">
            <ShieldAlert aria-hidden="true" className="mx-auto h-8 w-8 text-status-red" />
            <h2 className="mt-3 font-display text-xl font-bold text-slate-950 dark:text-white">Published viewer unavailable</h2>
            <p className="mt-2 text-sm font-semibold text-status-red">{resolution.reason}</p>
            <ValidationReportSummary report={resolution.validationReport} />
            <Button className="mt-5" icon={ArrowLeft} variant="signal" onClick={onReturnToEditor}>
              Validate / Publish
            </Button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Published custom dashboard viewer"
      className="flex min-h-[34rem] min-w-0 flex-col rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]"
    >
      <ViewerToolbar
        title={`${dashboard.title} · Revision ${resolution.runtime.revision.revisionNumber}`}
        onOpen={handleOpen}
        onRefresh={handleRefreshFrame}
        onCopyLink={() => { void handleCopyLink(); }}
        onReturnToEditor={onReturnToEditor}
        copyLabel={copyLabel}
        refreshing={refreshing}
      />

      {frameError ? (
        <div
          role="alert"
          aria-label="Custom dashboard runtime failure"
          className="mt-4 flex items-start gap-2 rounded-[0.9rem] border border-status-red/20 bg-status-red/[0.06] px-3 py-2 text-sm font-semibold text-status-red"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{frameError}</span>
        </div>
      ) : null}

      <div className="mt-4 min-h-[30rem] flex-1 overflow-hidden rounded-[1rem] border border-black/[0.08] bg-white dark:border-white/[0.08] dark:bg-void-900">
        <iframe
          key={frameKey}
          ref={iframeRef}
          title={`Published custom dashboard: ${dashboard.title}`}
          srcdoc={resolution.runtime.document}
          sandbox="allow-forms allow-popups allow-scripts"
          className="h-full min-h-[30rem] w-full border-0 bg-white"
        />
      </div>
    </section>
  );
};

const ViewerToolbar: FunctionComponent<{
  title: string;
  onOpen: () => void;
  onRefresh: () => void;
  onCopyLink: () => void;
  onReturnToEditor: () => void;
  copyLabel: string;
  refreshing: boolean;
  openDisabled?: boolean;
}> = ({
  title,
  onOpen,
  onRefresh,
  onCopyLink,
  onReturnToEditor,
  copyLabel,
  refreshing,
  openDisabled = false,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">Published Viewer</p>
      <h2 className="truncate font-display text-lg font-bold text-slate-950 dark:text-white">{title}</h2>
    </div>
    <div className="flex items-center gap-1.5">
      <IconButton title="Open published dashboard" aria-label="Open published dashboard" onClick={onOpen} disabled={openDisabled}>
        <ExternalLink aria-hidden="true" className="h-4 w-4" />
      </IconButton>
      <IconButton title="Refresh published dashboard" aria-label="Refresh published dashboard" onClick={onRefresh} pending={refreshing}>
        <RefreshCw aria-hidden="true" className="h-4 w-4" />
      </IconButton>
      <IconButton title={copyLabel} aria-label={copyLabel} onClick={onCopyLink}>
        <Copy aria-hidden="true" className="h-4 w-4" />
      </IconButton>
      <IconButton title="Return to editor" aria-label="Return to editor" onClick={onReturnToEditor}>
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      </IconButton>
    </div>
  </div>
);

const ValidationReportSummary: FunctionComponent<{ report: CustomDashboardValidationReport | null }> = ({ report }) => {
  if (!report) {
    return (
      <p className="mt-3 rounded-[0.85rem] border border-black/[0.08] bg-white/70 px-3 py-2 text-sm text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300">
        No validation report is available for the selected dashboard.
      </p>
    );
  }
  return (
    <div className="mt-4 rounded-[0.85rem] border border-black/[0.08] bg-white/70 p-3 text-left dark:border-white/[0.08] dark:bg-white/[0.05]">
      <p className="text-sm font-bold text-slate-900 dark:text-white">{report.summary || (report.valid ? "Validation passed." : "Validation failed.")}</p>
      {report.issues.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
          {report.issues.map((issue) => (
            <ValidationIssueItem key={`${issue.field}:${issue.code}:${issue.message}`} issue={issue} />
          ))}
        </ul>
      ) : null}
    </div>
  );
};

const ValidationIssueItem: FunctionComponent<{ issue: CustomDashboardValidationReport["issues"][number] }> = ({ issue }) => (
  <li>
    <span className="font-semibold">{issue.field}</span>: {issue.message}
  </li>
);
