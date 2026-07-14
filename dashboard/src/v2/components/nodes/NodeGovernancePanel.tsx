import type { FunctionComponent } from "preact";
import { CheckCircle2, FlaskConical, GitCompare, RotateCcw, ShieldAlert, UploadCloud } from "lucide-preact";
import type { NodeFlowDraftReview } from "../../types.js";
import type { NodeFlowDryRunResponse, NodeFlowVersionDiff } from "../../lib/node-flow-api.js";
import { Button } from "../ui/Button.js";
import { translateNodesStatus, useNodesI18n } from "../../i18n/messages/nodes.js";

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

export const NodeGovernancePanel: FunctionComponent<NodeGovernancePanelProps> = ({ review, dryRun, diff, busy, onValidate, onDryRun, onCompare, onPublish, onRollback }) => {
  const { locale, t, tp } = useNodesI18n();
  return <section className="rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035]" aria-labelledby="governance-heading">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("governanceEyebrow")}</p><h2 id="governance-heading" className="text-base font-bold text-slate-900 dark:text-white">{t("governanceHeading")}</h2></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" icon={CheckCircle2} onClick={onValidate} disabled={busy}>{t("validate")}</Button><Button size="sm" variant="secondary" icon={FlaskConical} onClick={onDryRun} disabled={busy}>{t("dryRun")}</Button><Button size="sm" variant="secondary" icon={GitCompare} onClick={onCompare} disabled={busy || !review?.publishedVersion}>{t("compare")}</Button><Button size="sm" variant="ghost" icon={RotateCcw} onClick={onRollback} disabled={busy || !review?.publishedVersion}>{t("rollback")}</Button><Button size="sm" icon={UploadCloud} onClick={onPublish} disabled={busy || !review?.valid}>{t("publish")}</Button></div></div>
    {!review ? <p role="status" className="mt-4 text-sm text-slate-500">{t("validatePrompt")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">{t("revision")}</p><p className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{t("draftRevision", { revision: review.draftRevision })} · {review.publishedVersion ? t("publishedVersion", { version: review.publishedVersion }) : t("unpublished")}</p><p className="mt-2 text-xs text-slate-500">{tp("nodeCount", review.nodeCount)} · {tp("edgeCount", review.edgeCount)}</p></div>
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">{t("permissions")}</p><p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{review.requestedCapabilities.length ? review.requestedCapabilities.join(", ") : t("noCapabilities")}</p>{review.sideEffectDiffs.map((item) => <p key={item.nodeId} className="mt-1 text-xs text-amber-600">{item.description}</p>)}</div>
      <div className="rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.06]"><p className="text-xs font-bold uppercase text-slate-400">{t("policy")}</p>{review.policyFindings.length ? review.policyFindings.map((finding) => <p key={`${finding.code}-${finding.nodeId ?? "graph"}`} className={`mt-1 text-xs ${finding.severity === "error" ? "text-status-red" : "text-amber-600"}`}><ShieldAlert className="mr-1 inline h-3 w-3" aria-hidden="true" />{finding.message}</p>) : <p className="mt-1 text-sm text-status-green">{t("noPolicyFindings")}</p>}</div>
    </div>}
    {dryRun ? <div role="status" className={`mt-3 rounded-xl border p-3 text-sm ${dryRun.status === "ready" ? "border-status-green/20 bg-status-green/[0.06]" : "border-amber-500/25 bg-amber-500/[0.06]"}`}>{t("dryRunSummary", { status: translateNodesStatus(locale, dryRun.status), count: dryRun.result.inputKeys.length })}</div> : null}
    {diff ? <div className="mt-3 rounded-xl border border-black/[0.06] p-3 text-sm dark:border-white/[0.06]" aria-label={t("publicationDiff")}><strong>{t("graphDiff", { from: diff.fromVersion, to: diff.toVersion })}</strong> {t("graphDiffSummary", { added: diff.addedNodeIds.length, removed: diff.removedNodeIds.length, fromNodes: diff.nodeCount.from, toNodes: diff.nodeCount.to, changes: diff.sideEffectDiffs.length })}</div> : null}
  </section>;
};
