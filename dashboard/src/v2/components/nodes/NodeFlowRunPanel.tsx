import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Play, RefreshCw } from "lucide-preact";
import type {
  NodeFlowGraph,
  NodeFlowJsonObject,
  NodeFlowNodeRunRecord,
  NodeFlowRunRecord,
} from "../../types.js";
import {
  applyWidgetDefaults,
  formatNodeFlowRunStatus,
  redactNodeFlowSecrets,
} from "../../lib/node-flow-view-models.js";
import { NodeWidgetField } from "./NodeWidgetField.js";
import { translateNodesStatus, useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodeFlowRunPanelProps {
  graph: NodeFlowGraph;
  runs: NodeFlowRunRecord[];
  nodeRuns: NodeFlowNodeRunRecord[];
  selectedRunId: string | null;
  running?: boolean;
  loadingRuns?: boolean;
  runError?: string | null;
  onRun: (input: NodeFlowJsonObject) => void;
  onRefreshRuns: () => void;
  onSelectRun: (runId: string) => void;
}

const emptyObject: NodeFlowJsonObject = {};

export const NodeFlowRunPanel: FunctionComponent<NodeFlowRunPanelProps> = ({
  graph,
  runs,
  nodeRuns,
  selectedRunId,
  running = false,
  loadingRuns = false,
  runError,
  onRun,
  onRefreshRuns,
  onSelectRun,
}) => {
  const { locale, t } = useNodesI18n();
  const [inputValues, setInputValues] = useState<NodeFlowJsonObject>(() => applyWidgetDefaults(graph.inputSchema, emptyObject));
  const selectedRun = runs.find((run) => run.id === selectedRunId) ?? runs[0] ?? null;

  useEffect(() => {
    setInputValues(applyWidgetDefaults(graph.inputSchema, emptyObject));
  }, [graph.inputSchema]);

  return (
    <section className="grid gap-4 rounded-[1.6rem] border border-black/[0.08] bg-white/65 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]" aria-labelledby="node-flow-run-heading">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("run")}</p>
          <h2 id="node-flow-run-heading" className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">{t("manualInput")}</h2>
        </div>
        {(graph.inputSchema?.fields.length ?? 0) === 0 ? (
          <textarea
            aria-label={t("runInputJson")}
            className="min-h-40 rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 font-mono text-xs text-slate-800 outline-none focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100"
            value={JSON.stringify(inputValues, null, 2)}
            onInput={(event) => {
              try {
                setInputValues(JSON.parse(event.currentTarget.value) as NodeFlowJsonObject);
              } catch {
                setInputValues({});
              }
            }}
          />
        ) : (
          graph.inputSchema!.fields.map((field) => (
            <NodeWidgetField
              key={field.id}
              field={field}
              value={inputValues[field.id]}
              onChange={(fieldId, value) => setInputValues((current) => ({ ...current, [fieldId]: value }))}
            />
          ))
        )}
        {runError ? (
          <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.08] px-3 py-2 text-xs text-status-red">
            {runError}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onRun(inputValues)}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-xl bg-signal-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-void-900"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {t("runFlow")}
          </button>
          <button
            type="button"
            onClick={onRefreshRuns}
            disabled={loadingRuns}
            className="inline-flex items-center gap-2 rounded-xl border border-black/[0.08] bg-white/70 px-4 py-2 text-sm font-bold text-slate-600 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("refreshRuns")}
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("history")}</h3>
          {loadingRuns ? (
            <div role="status" className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">{t("loadingRuns")}</div>
          ) : runs.length === 0 ? (
            <div role="status" className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">{t("noPersistedRuns")}</div>
          ) : (
            runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => onSelectRun(run.id)}
                aria-current={selectedRun?.id === run.id ? "true" : undefined}
                className={`rounded-xl border px-3 py-2 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 ${
                  selectedRun?.id === run.id
                    ? "border-signal-500/45 bg-signal-500/[0.08]"
                    : "border-black/[0.06] bg-white/55 hover:border-signal-500/25 dark:border-white/[0.06] dark:bg-white/[0.03]"
                }`}
              >
                <span className="block truncate text-xs font-bold uppercase tracking-[0.13em] text-slate-500 dark:text-slate-400">{formatNodeFlowRunStatus(run, locale)}</span>
                <span className="mt-1 block truncate font-mono text-[11px] text-slate-400">{run.id}</span>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("result")}</h3>
          {selectedRun ? (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
                <p className="text-sm font-bold text-slate-900 dark:text-white">{translateNodesStatus(locale, selectedRun.status)}</p>
                {selectedRun.errorMessage ? <p className="mt-1 text-sm text-status-red">{selectedRun.errorMessage}</p> : null}
              </div>
              {nodeRuns.length > 0 ? (
                <div className="flex flex-col gap-2" aria-label={t("nodeRunStatuses")}>
                  {nodeRuns.map((nodeRun) => (
                    <div key={nodeRun.id} className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                      <p className="truncate text-xs font-bold uppercase tracking-[0.13em] text-slate-500 dark:text-slate-400">{nodeRun.nodeId} · {translateNodesStatus(locale, nodeRun.status)}</p>
                      {nodeRun.executionInvocationId ? <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{t("invocation", { id: nodeRun.executionInvocationId })}</p> : null}
                    </div>
                  ))}
                </div>
              ) : null}
              <pre className="max-h-72 overflow-auto rounded-xl border border-black/[0.06] bg-slate-950 p-3 text-xs leading-relaxed text-slate-100">
                {JSON.stringify(redactNodeFlowSecrets(selectedRun.output ?? selectedRun.input ?? {}), null, 2)}
              </pre>
            </div>
          ) : (
            <div role="status" className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">
              {t("selectRunOutput")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
