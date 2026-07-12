import type { FunctionComponent } from "preact";
import { CheckCircle2, FlaskConical, GitCompare, RotateCcw, ShieldAlert, UploadCloud } from "lucide-preact";
import type { NodeFlowDraftReview } from "../../types.js";
import type { NodeFlowDryRunResponse, NodeFlowVersionDiff } from "../../lib/node-flow-api.js";
import { Button } from "../ui/Button.js";

interface NodeGovernancePanelProps {
  review: NodeFlowDraftReview | null;
  dryRun: NodeFlowDryRunResponse | null;
  diff: NodeFlowVersionDiff | null;
  busy?: boolean;
  onValidate: () => void;
  onDryRun: () => void;
  onCompare: () => void;
  onPublish: () => void;
  onRollback: () => void;
}

export const NodeGovernancePanel: FunctionComponent<NodeGovernancePanelProps> = ({ review, dryRun, diff, busy, onValidate, onDryRun, onCompare, onPublish, onRollback }) => (
  <section className="rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035]" aria-labelledby="governance-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">T06 control plane</p><h2 id="governance-heading" className="text-base font-bold text-slate-900 dark:text-white">Validation, policy & publication</h2></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={CheckCircle2} onClick={onValidate} disabled={busy}>Validate</Button><Button size="sm" variant="secondary" icon={FlaskConical} onClick={onDryRun} disabled={busy}>Dry run</Button><Button size="sm" variant="secondary" icon={GitCompare} onClick={onCompare} disabled={busy || !review?.publishedVersion}>Compare</Button><Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRollback} disabled={busy || !review?.publishedVersion}>Rollback</Button><Button size="sm" icon={UploadCloud} onClick={onPublish} disabled={busy || !review?.valid}>Publish</Button></div></div>
    {!review ? <p role="status" className="mt-4 text-sm text-slate-500">Validate the draft to load its governed review.</p> : <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">Revision</p><p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">Draft r{review.draftRevision} · {review.publishedVersion ? `published v${review.publishedVersion}` : "unpublished"}</p><p className="mt-2 text-xs text-slate-500">{review.nodeCount} nodes · {review.edgeCount} edges</p></div>
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">Permissions</p><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{review.requestedCapabilities.length ? review.requestedCapabilities.join(", ") : "No capabilities requested"}</p>{review.sideEffectDiffs.map((item) => <p key={item.nodeId} className="mt-1 text-xs text-amber-600">{item.description}</p>)}</div>
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">Policy</p>{review.policyFindings.length ? review.policyFindings.map((finding) => <p key={`${finding.code}-${finding.nodeId ?? "graph"}`} className={`mt-1 text-xs ${finding.severity === "error" ? "text-status-red" : "text-amber-600"}`}><ShieldAlert className="mr-1 inline h-3 w-3" aria-hidden="true" />{finding.message}</p>) : <p className="mt-1 text-sm text-status-green">No policy findings</p>}</div>
    </div>}
    {dryRun ? <div role="status" className={`mt-3 rounded-xl border p-3 text-sm ${dryRun.status === "ready" ? "border-status-green/20 bg-status-green/[0.06]" : "border-amber-500/25 bg-amber-500/[0.06]"}`}><strong>Dry run {dryRun.status}.</strong> No nodes executed; reviewed {dryRun.result.inputKeys.length} input keys.</div> : null}
    {diff ? <div className="mt-3 rounded-xl border border-black/[0.06] p-3 text-sm dark:border-white/[0.06]" aria-label="Publication diff"><strong>Graph diff v{diff.fromVersion} → v{diff.toVersion}:</strong> {diff.addedNodeIds.length} added, {diff.removedNodeIds.length} removed; nodes {diff.nodeCount.from} → {diff.nodeCount.to}. Permission/side-effect changes: {diff.sideEffectDiffs.length}.</div> : null}
  </section>
);
