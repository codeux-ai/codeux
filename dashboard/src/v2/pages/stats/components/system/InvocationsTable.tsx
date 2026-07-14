import { Fragment, type FunctionComponent } from "preact";
import { useState, useMemo } from "preact/hooks";
import {
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Loader2,
  PauseCircle,
  MinusCircle,
  AlertTriangle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Inbox,
  type LucideIcon,
} from "lucide-preact";
import type { ExecutionInvocationRecord } from "../../../../types.js";
import type { SystemSort, SystemSortKey } from "../../hooks/use-system-view-data.js";
import { formatTokens, formatStatsDuration, formatDateTime } from "../../stats-utils.js";
import { DEFAULT_LIST_WINDOW, resolveListWindow } from "../../../../lib/list-window.js";
import {
  LEDGER_ROW_MODERN_CLASS,
  CHIP_CLASS,
  STATUS_TONE_CLASS,
  TAB_IDLE_CLASS,
  TRACK_CLASS,
  getProviderIcon,
  SUBPANEL_CLASS,
  CONTROL_FOCUS_CLASS,
} from "../StatsShared.js";
import { InvocationMessagesPanel } from "./InvocationMessagesPanel.js";
import { useStatsI18n } from "../../stats-i18n.js";

export interface InvocationsTableProps {
  invocations: ExecutionInvocationRecord[];
  sort: SystemSort;
  onSortChange: (sort: SystemSort) => void;
  expandedId: string | null;
  onRowExpand: (id: string | null) => void;
  loading?: boolean;
  error?: string | null;
}

const SystemFeedbackState: FunctionComponent<{
  icon: LucideIcon;
  title: string;
  detail: string;
  role: "status" | "alert";
  ariaLabel: string;
  tone?: keyof typeof STATUS_TONE_CLASS;
  busy?: boolean;
  children?: import("preact").ComponentChildren;
}> = ({ icon: Icon, title, detail, role, ariaLabel, tone = "neutral", busy, children }) => (
  <div
    role={role}
    aria-label={ariaLabel}
    aria-live={role === "status" ? "polite" : undefined}
    aria-busy={busy ? "true" : undefined}
    className={`${SUBPANEL_CLASS} flex min-w-0 flex-col gap-4 p-4 text-left sm:flex-row sm:items-start`}
  >
    <div className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--stats-chip-radius)] ${STATUS_TONE_CLASS[tone]}`}>
      <Icon className={busy ? "h-4 w-4 motion-safe:animate-spin" : "h-4 w-4"} strokeWidth={2.2} aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-bold text-[color:var(--stats-value-color)]">{title}</div>
      <div className="mt-1 text-sm leading-relaxed text-[color:var(--stats-detail-color)]">{detail}</div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  </div>
);

export function useInvocationsWindow(
  invocations: ExecutionInvocationRecord[],
  expandedId: string | null,
  initialWindow = DEFAULT_LIST_WINDOW
) {
  const initialCount = typeof initialWindow === "number" ? initialWindow : resolveListWindow(initialWindow, invocations.length);
  const [visibleCount, setVisibleCount] = useState(initialCount);

  const visibleInvocations = useMemo(() => {
    let visible = invocations.slice(0, visibleCount);
    if (expandedId) {
      const isVisible = visible.some((i) => i.id === expandedId);
      if (!isVisible) {
        const expandedItem = invocations.find((i) => i.id === expandedId);
        if (expandedItem) {
          visible = [...visible, expandedItem];
        }
      }
    }
    return visible;
  }, [invocations, visibleCount, expandedId]);

  return {
    visibleInvocations,
    visibleCount,
    hasMore: visibleCount < invocations.length,
    revealMore: () => setVisibleCount((c: number) => c + (typeof initialWindow === "number" ? initialWindow : 20)),
  };
}

export const InvocationsTable: FunctionComponent<InvocationsTableProps> = ({
  invocations,
  sort,
  onSortChange,
  expandedId,
  onRowExpand,
  loading,
  error,
  }) => {
  const { locale, formatNumber } = useStatsI18n();
  const expandedInvocation = expandedId === null
    ? null
    : invocations.find((invocation) => invocation.id === expandedId) ?? null;

  const { visibleInvocations, visibleCount, hasMore, revealMore } = useInvocationsWindow(invocations, expandedId);

  const handleSort = (key: SystemSortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
    } else {
      onSortChange({ key, dir: "desc" });
    }
  };

  const getAriaSort = (key: SystemSortKey): "ascending" | "descending" | undefined => {
    if (sort.key !== key) {
      return undefined;
    }

    return sort.dir === "asc" ? "ascending" : "descending";
  };

  const getSortButtonLabel = (label: string, key: SystemSortKey): string => {
    if (sort.key !== key) {
      return locale === "de" ? `Aufrufe nach ${label} sortieren` : `Sort invocations by ${label}`;
    }

    return locale === "de" ? `Aufrufe nach ${label} sortieren, aktuell ${sort.dir === "asc" ? "aufsteigend" : "absteigend"}` : `Sort invocations by ${label}, currently sorted ${sort.dir === "asc" ? "ascending" : "descending"}`;
  };

  const renderSortIcon = (key: SystemSortKey) => {
    if (sort.key !== key) return <ArrowUpDown aria-hidden="true" className="ml-1 h-3 w-3" />;
    return sort.dir === "asc" ? (
      <ArrowUp aria-hidden="true" className="ml-1 h-3 w-3 text-[color:var(--stats-signal-text)]" />
    ) : (
      <ArrowDown aria-hidden="true" className="ml-1 h-3 w-3 text-[color:var(--stats-signal-text)]" />
    );
  };

  const renderStatusChip = (status: string) => {
    switch (status) {
      case "running":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.signal}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-signal-text)]" />
            <Loader2 className="h-3 w-3 animate-spin" />
            {locale === "de" ? "Laufend" : "Running"}
          </div>
        );
      case "completed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.positive}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-positive-text)]" />
            <CheckCircle2 className="h-3 w-3" />
            {locale === "de" ? "Abgeschlossen" : "Completed"}
          </div>
        );
      case "failed":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.negative}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-negative-text)]" />
            <XCircle className="h-3 w-3" />
            {locale === "de" ? "Fehlgeschlagen" : "Failed"}
          </div>
        );
      case "cancelled":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.neutral}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-detail-color)]" />
            <MinusCircle className="h-3 w-3" />
            {locale === "de" ? "Abgebrochen" : "Cancelled"}
          </div>
        );
      case "paused":
        return (
          <div className={`${CHIP_CLASS} flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${STATUS_TONE_CLASS.warning}`}>
            <div className="h-2 w-2 rounded-full bg-[color:var(--stats-warning-text)]" />
            <PauseCircle className="h-3 w-3" />
            {locale === "de" ? "Pausiert" : "Paused"}
          </div>
        );
      default:
        return (
          <div className={`${CHIP_CLASS} px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[color:var(--stats-label-color)]`}>
            {status}
          </div>
        );
    }
  };

  const cellClass = "block min-w-0 break-words px-3 py-2 align-middle [overflow-wrap:anywhere] lg:table-cell lg:px-2 lg:py-3";
  const mobileLabelClass = "mb-1 text-[9px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-label-color)] lg:hidden";

  if (loading && invocations.length === 0) {
    return (
      <SystemFeedbackState
        icon={Loader2}
        title={locale === "de" ? "Aufrufdatensätze werden geladen" : "Loading invocation records"}
        detail={locale === "de" ? "Ledger-Zeilen und Ziele für die Protokollerweiterung werden aktualisiert." : "Refreshing the ledger rows and transcript expansion targets."}
        role="status"
        ariaLabel={locale === "de" ? "Aufrufdatensätze werden geladen" : "Loading invocation records"}
        tone="signal"
        busy
      >
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${SUBPANEL_CLASS} h-10 !p-0 motion-safe:animate-pulse ${TRACK_CLASS}`} />
          ))}
        </div>
      </SystemFeedbackState>
    );
  }

  if (error) {
    return (
      <SystemFeedbackState
        icon={AlertTriangle}
        title={locale === "de" ? "Aufrufdatensätze konnten nicht geladen werden" : "Failed to load invocation records"}
        detail={error}
        role="alert"
        ariaLabel={locale === "de" ? "Aufrufdatensätze konnten nicht geladen werden" : "Invocation records failed to load"}
        tone="negative"
      />
    );
  }

  if (invocations.length === 0) {
    return (
      <SystemFeedbackState
        icon={Inbox}
        title={locale === "de" ? "Keine Aufrufdatensätze anzuzeigen" : "No invocation records to show"}
        detail={locale === "de" ? "Keine Datensätze entsprechen den aktuellen Filtern oder der Datensatzansicht." : "No records match the current filters or record view."}
        role="status"
        ariaLabel={locale === "de" ? "Keine Aufrufdatensätze" : "No invocation records"}
      />
    );
  }

  return (
    <div className="min-w-0 overflow-visible">
      {loading ? (
        <div role="status" aria-live="polite" aria-atomic="true" className={`${SUBPANEL_CLASS} mb-3 flex items-center gap-2 p-3 text-[11px] font-bold uppercase tracking-[0.14em] text-[color:var(--stats-detail-color)]`}>
          <Loader2 className="h-3.5 w-3.5 text-[color:var(--stats-signal-text)] motion-safe:animate-spin" aria-hidden="true" />
          {locale === "de" ? "Aufrufdatensätze werden aktualisiert. Zwischengespeicherte Zeilen werden angezeigt, während das aktuelle Ledger lädt." : "Updating invocation records. Showing cached rows while the latest ledger loads."}
        </div>
      ) : null}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {locale === "de" ? `${formatNumber(Math.min(visibleCount, invocations.length))} von ${formatNumber(invocations.length)} Aufrufdatensätzen werden angezeigt.` : `Showing ${formatNumber(Math.min(visibleCount, invocations.length))} of ${formatNumber(invocations.length)} invocation records.`}
      </div>
      <table className="block w-full border-separate border-spacing-y-2 lg:table">
        <caption className="sr-only">
          {locale === "de" ? "Aufruf-Ledger mit sortierbaren Zeit-, Token- und Dauerspalten. Zeilen enthalten Status, Typ, Modell, Token-Zahlen, Kontext und Steuerelemente zur Protokollerweiterung." : "Invocation ledger with sortable time, token, and duration columns. Rows include status, type, model, token counts, context, and transcript expansion controls."}
        </caption>
        <thead className="sticky top-0 z-10 hidden bg-[color:var(--stats-surface-panel)] lg:table-header-group">
          <tr className="text-left text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]">
            <th id="invocations-time" scope="col" aria-sort={getAriaSort("startedAt")} className="pb-2 pl-6">
              <button
                type="button"
                onClick={() => handleSort("startedAt")}
                aria-label={getSortButtonLabel("time", "startedAt")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                {locale === "de" ? "Zeit" : "Time"} {renderSortIcon("startedAt")}
              </button>
            </th>
            <th id="invocations-status" scope="col" className="pb-2">Status</th>
            <th id="invocations-type" scope="col" className="pb-2">{locale === "de" ? "Typ" : "Type"}</th>
            <th id="invocations-model" scope="col" className="pb-2">{locale === "de" ? "Modell" : "Model"}</th>
            <th id="invocations-input" scope="col" aria-sort={getAriaSort("inputTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("inputTokens")}
                aria-label={getSortButtonLabel("input tokens", "inputTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                In {renderSortIcon("inputTokens")}
              </button>
            </th>
            <th id="invocations-output" scope="col" aria-sort={getAriaSort("outputTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("outputTokens")}
                aria-label={getSortButtonLabel("output tokens", "outputTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                Out {renderSortIcon("outputTokens")}
              </button>
            </th>
            <th id="invocations-cached" scope="col" className="pb-2">{locale === "de" ? "Im Cache" : "Cached"}</th>
            <th id="invocations-total" scope="col" aria-sort={getAriaSort("totalTokens")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("totalTokens")}
                aria-label={getSortButtonLabel("total tokens", "totalTokens")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                {locale === "de" ? "Gesamt" : "Total"} {renderSortIcon("totalTokens")}
              </button>
            </th>
            <th id="invocations-duration" scope="col" aria-sort={getAriaSort("durationMs")} className="pb-2">
              <button
                type="button"
                onClick={() => handleSort("durationMs")}
                aria-label={getSortButtonLabel("average duration", "durationMs")}
                className={`flex items-center ${TAB_IDLE_CLASS}`}
              >
                {locale === "de" ? "Durchschn. Dauer" : "Avg Duration"} {renderSortIcon("durationMs")}
              </button>
            </th>
            <th id="invocations-context" scope="col" className="pb-2">{locale === "de" ? "Kontext" : "Context"}</th>
            <th id="invocations-expand" scope="col" className="pb-2 pr-6 text-right">{locale === "de" ? "Erweitern" : "Expand"}</th>
          </tr>
        </thead>
        <tbody className="block lg:table-row-group">
          {visibleInvocations.map((invocation) => {
            const isExpanded = expandedId === invocation.id;
            const { icon: ProviderIcon, bg: providerBg, text: providerText } = getProviderIcon(invocation.provider);
            const duration = invocation.finishedAt
              ? formatStatsDuration(Date.parse(invocation.finishedAt) - Date.parse(invocation.startedAt), locale)
              : locale === "de" ? "laufend" : "running";

            return (
              <Fragment key={invocation.id}>
                <tr
                  key={invocation.id}
                  className={`${LEDGER_ROW_MODERN_CLASS} block overflow-hidden lg:table-row ${
                    invocation.status === "running"
                      ? "border-l-2 border-l-[color:var(--stats-signal-text)]"
                      : invocation.status === "failed"
                        ? "border-l-2 border-l-[color:var(--stats-negative-text)]"
                        : ""
                  }`}
                >
                  <td headers="invocations-time" className={`${cellClass} lg:pl-6`}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Zeit" : "Time"}</div>
                    <div className="text-[11px] font-mono text-[color:var(--stats-label-color)]">{formatDateTime(invocation.startedAt, locale)}</div>
                  </td>
                  <td headers="invocations-status" className={cellClass}>
                    <div className={mobileLabelClass}>Status</div>
                    {renderStatusChip(invocation.status)}
                    {invocation.status === "failed" && (invocation.lastErrorMessage || invocation.errorMessage) ? (
                      <div className="mt-2 flex min-w-0 items-start gap-1.5 text-[11px] text-[color:var(--stats-negative-text)]">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{invocation.lastErrorMessage || invocation.errorMessage}</span>
                      </div>
                    ) : null}
                  </td>
                  <td headers="invocations-type" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Typ" : "Type"}</div>
                    <div className={`${CHIP_CLASS} max-w-full px-2 py-0.5 text-[10px] font-medium capitalize text-[color:var(--stats-detail-color)]`}>
                      <span className="block truncate">{invocation.type || (locale === "de" ? "unbekannt" : "unknown")}</span>
                    </div>
                  </td>
                  <td headers="invocations-model" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Modell" : "Model"}</div>
                    <div className="flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--stats-detail-color)]">
                      <div className={`shrink-0 rounded-lg p-1.5 ${providerBg} ${providerText}`}>
                        <ProviderIcon className="h-3 w-3" strokeWidth={2.5} />
                      </div>
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                        <span className="font-bold text-[color:var(--stats-value-color)]">{invocation.provider || (locale === "de" ? "unbekannt" : "unknown")}</span>
                        <span className="mx-1 text-[color:var(--stats-label-color)]">·</span>
                        {invocation.model || "—"}
                      </span>
                    </div>
                  </td>
                  <td headers="invocations-input" className={cellClass}>
                    <div className={mobileLabelClass}>In</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.inputTokens ?? 0, locale)}</div>
                  </td>
                  <td headers="invocations-output" className={cellClass}>
                    <div className={mobileLabelClass}>Out</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.outputTokens ?? 0, locale)}</div>
                  </td>
                  <td headers="invocations-cached" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Im Cache" : "Cached"}</div>
                    <div className="text-[11px] text-[color:var(--stats-detail-color)]">{formatTokens(invocation.cachedInputTokens ?? 0, locale)}</div>
                  </td>
                  <td headers="invocations-total" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Gesamt" : "Total"}</div>
                    <div className="text-[11px] font-bold text-[color:var(--stats-value-color)]">{formatTokens(invocation.totalTokens ?? 0, locale)}</div>
                  </td>
                  <td headers="invocations-duration" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Dauer" : "Duration"}</div>
                    <div className={`text-[11px] ${invocation.finishedAt ? "text-[color:var(--stats-detail-color)]" : "text-[color:var(--stats-signal-text)]"}`}>
                      {duration}
                    </div>
                  </td>
                  <td headers="invocations-context" className={cellClass}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Kontext" : "Context"}</div>
                    <div className="flex min-w-0 flex-wrap gap-1">
                      {invocation.sprintNumber !== null && invocation.sprintNumber !== undefined ? (
                        <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--stats-label-color)]`}>
                          S{invocation.sprintNumber}
                        </div>
                      ) : null}
                      {invocation.taskKey !== null && invocation.taskKey !== undefined ? (
                        <div className={`${CHIP_CLASS} px-1.5 py-0.5 text-[9px] font-bold text-[color:var(--stats-label-color)]`}>
                          {invocation.taskKey}
                        </div>
                      ) : null}
                      {invocation.sprintNumber == null && invocation.taskKey == null ? (
                        <span className="text-[11px] text-[color:var(--stats-label-color)]">—</span>
                      ) : null}
                    </div>
                  </td>
                  <td headers="invocations-expand" className={`${cellClass} lg:pr-6 lg:text-right`}>
                    <div className={mobileLabelClass}>{locale === "de" ? "Nachrichten" : "Messages"}</div>
                    <button
                      type="button"
                      onClick={() => onRowExpand(isExpanded ? null : invocation.id)}
                      aria-expanded={isExpanded}
                      aria-controls={`invocation-messages-${invocation.id}`}
                      aria-label={isExpanded ? (locale === "de" ? `Aufruf ${invocation.id} reduzieren` : `Collapse invocation ${invocation.id}`) : (locale === "de" ? `Aufruf ${invocation.id} erweitern` : `Expand invocation ${invocation.id}`)}
                      className={`${CHIP_CLASS} p-2 transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] ${CONTROL_FOCUS_CLASS} ${
                        isExpanded ? "text-[color:var(--stats-signal-text)]" : "text-[color:var(--stats-label-color)]"
                      }`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  </td>
                </tr>

                {/* Expanded Detail Row */}
                {isExpanded && expandedInvocation ? (
                  <tr key={`${invocation.id}-detail`} className="block lg:table-row">
                    <td colSpan={11} className="block px-0 pb-2 lg:table-cell lg:px-6">
                      <InvocationMessagesPanel invocation={expandedInvocation} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {hasMore && (
        <div className="mt-4 flex justify-center pb-4">
          <button
            type="button"
            onClick={revealMore}
            aria-label={locale === "de" ? `Weitere Aufrufe anzeigen, aktuell ${formatNumber(Math.min(visibleCount, invocations.length))} von ${formatNumber(invocations.length)}` : `Show more invocations, currently showing ${formatNumber(Math.min(visibleCount, invocations.length))} of ${formatNumber(invocations.length)}`}
            className={`${CHIP_CLASS} px-4 py-2 text-xs font-bold text-[color:var(--stats-detail-color)] transition-colors hover:bg-[color:var(--stats-surface-chip-hover)] ${CONTROL_FOCUS_CLASS}`}
          >
            {locale === "de" ? "Weitere Aufrufe anzeigen" : "Show more invocations"}
          </button>
        </div>
      )}
    </div>
  );
};
