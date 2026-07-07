import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { CheckCircle2, ExternalLink, FileClock, MoreHorizontal, Play, RadioTower, Rocket, ScrollText, ShieldCheck } from "lucide-preact";
import { Button } from "../ui/Button.js";
import { DropdownMenu, DropdownMenuItem } from "../ui/DropdownMenu.js";
import type {
  CustomDashboardRecord,
  CustomDashboardRevisionRecord,
  CustomDashboardValidationSessionRecord,
} from "../../types.js";
import {
  buildValidationPreviewPath,
  canPublishRevision,
  getRevisionValidationLabel,
  getValidationStages,
} from "../../lib/custom-dashboard-view-models.js";

interface CustomDashboardValidationPanelProps {
  dashboard: CustomDashboardRecord;
  revisions: CustomDashboardRevisionRecord[];
  selectedRevision: CustomDashboardRevisionRecord | null;
  selectedRevisionId: string | null;
  onSelectedRevisionIdChange: (revisionId: string) => void;
  validationSession: CustomDashboardValidationSessionRecord | null;
  logs: string;
  creatingRevision: boolean;
  validating: boolean;
  refreshingLogs: boolean;
  publishing: boolean;
  archiving: boolean;
  onCreateRevision: () => void;
  onStartValidation: () => void;
  onRefreshLogs: () => void;
  onPublish: () => void;
  onArchive: () => void;
}

export const CustomDashboardValidationPanel: FunctionComponent<CustomDashboardValidationPanelProps> = ({
  dashboard,
  revisions,
  selectedRevision,
  selectedRevisionId,
  onSelectedRevisionIdChange,
  validationSession,
  logs,
  creatingRevision,
  validating,
  refreshingLogs,
  publishing,
  archiving,
  onCreateRevision,
  onStartValidation,
  onRefreshLogs,
  onPublish,
  onArchive,
}) => {
  const [revisionMenuOpen, setRevisionMenuOpen] = useState(false);
  const revisionMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const stages = getValidationStages(validationSession?.status ?? selectedRevision?.validationStatus ?? null);
  const previewPath = buildValidationPreviewPath(validationSession?.id);
  const publishEnabled = canPublishRevision(selectedRevision, validationSession);

  return (
    <aside
      aria-label="Custom dashboard validation and publication"
      className="flex min-h-[34rem] min-w-0 flex-col gap-4 rounded-[1.4rem] border border-black/[0.08] bg-white/70 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.05]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">Revision Gate</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            Publish only immutable revisions with a passed validation report.
          </p>
        </div>
        <DropdownMenu
          isOpen={revisionMenuOpen}
          onOpenChange={setRevisionMenuOpen}
          triggerRef={revisionMenuTriggerRef}
          menuAriaLabel="Select dashboard revision"
          content={(
            <div className="flex min-w-[14rem] flex-col gap-1 rounded-[1rem] border border-black/[0.08] bg-white/95 p-1.5 shadow-xl dark:border-white/[0.08] dark:bg-void-800/95">
              {revisions.map((revision) => (
                <DropdownMenuItem
                  key={revision.id}
                  onClick={() => {
                    onSelectedRevisionIdChange(revision.id);
                    setRevisionMenuOpen(false);
                  }}
                  className="rounded-[0.75rem] px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-900/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 dark:text-slate-200 dark:hover:bg-white/[0.06]"
                >
                  Revision {revision.revisionNumber} · {getRevisionValidationLabel(revision.validationStatus)}
                </DropdownMenuItem>
              ))}
            </div>
          )}
        >
          <button
            ref={revisionMenuTriggerRef}
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[0.9rem] border border-black/[0.08] bg-white/70 text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300"
            aria-label="Open revision menu"
            aria-haspopup="menu"
            aria-expanded={revisionMenuOpen}
          >
            <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
          </button>
        </DropdownMenu>
      </div>

      <div className="rounded-[1rem] border border-black/[0.06] bg-slate-900/[0.03] p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
        <div className="flex min-w-0 items-center gap-2">
          <FileClock aria-hidden="true" className="h-4 w-4 shrink-0 text-signal-500" />
          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900 dark:text-white">
            {selectedRevision ? `Revision ${selectedRevision.revisionNumber}` : "No revision"}
          </span>
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-slate-500 ring-1 ring-black/[0.06] dark:bg-white/[0.06] dark:ring-white/[0.08]">
            {getRevisionValidationLabel(selectedRevision?.validationStatus ?? null)}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {stages.map((stage) => (
            <div
              key={stage.id}
              className={`min-h-[4rem] rounded-[0.85rem] border p-2 ${
                stage.state === "passed"
                  ? "border-status-green/25 bg-status-green/[0.08] text-status-green"
                  : stage.state === "active"
                    ? "border-sky-500/25 bg-sky-500/[0.08] text-sky-500"
                    : stage.state === "failed"
                      ? "border-status-red/25 bg-status-red/[0.08] text-status-red"
                      : "border-black/[0.06] bg-white/50 text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.04]"
              }`}
            >
              <div className="flex items-center gap-1.5">
                {stage.state === "passed" ? <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" /> : <RadioTower aria-hidden="true" className="h-3.5 w-3.5" />}
                <span className="text-[11px] font-bold uppercase tracking-[0.12em]">{stage.label}</span>
              </div>
              <p className="mt-2 text-xs font-semibold capitalize">{stage.state}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
        <Button icon={FileClock} onClick={onCreateRevision} pending={creatingRevision} disabled={dashboard.status === "archived"}>
          Create Revision
        </Button>
        <Button icon={Play} onClick={onStartValidation} pending={validating} disabled={!selectedRevision || dashboard.status === "archived"}>
          Validate
        </Button>
        <Button
          icon={Rocket}
          variant="signal"
          onClick={onPublish}
          pending={publishing}
          disabled={!publishEnabled || dashboard.status === "archived"}
          disabledReason="A selected revision must pass validation before it can be published."
        >
          Publish
        </Button>
        <Button variant="danger" onClick={onArchive} pending={archiving} disabled={dashboard.status === "archived"}>
          Archive
        </Button>
      </div>

      {previewPath ? (
        <a
          href={previewPath}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-[0.9rem] border border-signal-500/25 bg-signal-500/[0.08] px-3 text-sm font-bold text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 dark:text-signal-300"
        >
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          Open validation preview
        </a>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ScrollText aria-hidden="true" className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Validation Logs</h3>
          </div>
          <Button size="sm" variant="ghost" onClick={onRefreshLogs} pending={refreshingLogs} disabled={!validationSession}>
            Refresh
          </Button>
        </div>
        <pre
          aria-label="Validation logs"
          className="min-h-[12rem] flex-1 overflow-auto whitespace-pre-wrap rounded-[1rem] border border-black/[0.08] bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100"
        >
          {logs || "No validation logs yet."}
        </pre>
      </div>

      {dashboard.publishedRevisionId ? (
        <div className="flex items-center gap-2 rounded-[0.9rem] bg-status-green/[0.08] px-3 py-2 text-xs font-semibold text-status-green ring-1 ring-status-green/20">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
          Published revision {revisions.find((revision) => revision.id === dashboard.publishedRevisionId)?.revisionNumber ?? selectedRevisionId}
        </div>
      ) : null}
    </aside>
  );
};
