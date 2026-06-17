## Objective
Upgrade `UsageFilterMenu.tsx` with amber active filter chips, improve `UsageGraphStates.tsx` loading and empty states, and refine `UsageGraphTooltip.tsx` typography and layout.

## Scope
- `dashboard/src/v2/pages/stats/components/UsageFilterMenu.tsx`
- `dashboard/src/v2/pages/stats/components/UsageFilterMenu.module.css`
- `dashboard/src/v2/pages/stats/components/UsageGraphStates.tsx`
- `dashboard/src/v2/pages/stats/components/UsageGraphTooltip.tsx`

## Steps

### 1. Update `UsageFilterMenu.tsx`
- In `UsageFilterMenu.tsx`, use `replace_with_git_merge_diff` for the header block:

```
<<<<<<< SEARCH
        <div className={`${styles.header} flex items-center justify-between`}>
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 dark:text-white">
            Graph Filters
          </span>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/[0.05] dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
=======
        <div className={`${styles.header} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 dark:text-white">
              Graph Filters
            </span>
            {activeSeriesCount > 0 && (
              <button
                type="button"
                onClick={() => setEnabledSeries({})}
                className="text-xs text-slate-400 transition-colors hover:text-amber-600"
              >
                Reset filters
              </button>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 hover:bg-black/[0.05] hover:text-slate-600 dark:hover:bg-white/[0.05] dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
>>>>>>> REPLACE
```

- And for the filter button:

```
<<<<<<< SEARCH
                          const active = enabledSeries[s.id] || false;
                          const disabled = activeSeriesCount === 1 && active;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (activeSeriesCount === 1 && enabledSeries[s.id]) return;
                                setEnabledSeries((curr) => ({ ...curr, [s.id]: !curr[s.id] }));
                              }}
                              disabled={disabled}
                              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all ${
                                active
                                  ? 'border-signal-500/20 bg-signal-500/[0.03] text-slate-900 dark:text-white'
                                  : 'border-black/[0.05] bg-transparent text-slate-500 hover:border-black/[0.1] dark:border-white/[0.05] dark:text-slate-400'
                              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: s.color || '#ccc' }}
                                />
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                                  {s.label}
                                </span>
                              </div>
                              {active && (
                                <div className="h-1.5 w-1.5 rounded-full bg-signal-500" />
                              )}
                            </button>
                          );
=======
                          const active = enabledSeries[s.id] || false;
                          const disabled = activeSeriesCount === 1 && active;
                          const groupActiveCount = groups[groupKey].filter((item) => enabledSeries[item.id]).length;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => {
                                if (activeSeriesCount === 1 && enabledSeries[s.id]) return;
                                setEnabledSeries((curr) => ({ ...curr, [s.id]: !curr[s.id] }));
                              }}
                              disabled={disabled}
                              className={`flex items-center justify-between rounded-xl border px-3 py-2 transition-all ${
                                active
                                  ? 'border-amber-500/28 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                  : 'border-black/[0.05] bg-transparent text-slate-500 hover:border-black/[0.1] dark:border-white/[0.05] dark:text-slate-400'
                              } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                            >
                              <div className="flex items-center gap-2">
                                <span
                                  className="h-2 w-2 rounded-full"
                                  style={{ backgroundColor: s.color || '#ccc' }}
                                />
                                <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                                  {s.label}
                                </span>
                              </div>
                              {active && (
                                <div className="flex items-center gap-1.5">
                                  {groupActiveCount > 1 && (
                                    <div className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[8px] font-bold text-amber-700 dark:bg-amber-500/30 dark:text-amber-200">
                                      +{groupActiveCount - 1}
                                    </div>
                                  )}
                                  <div className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                </div>
                              )}
                            </button>
                          );
>>>>>>> REPLACE
```

### 2. Update `UsageGraphStates.tsx`

```
<<<<<<< SEARCH
import type { FunctionComponent } from 'preact';
import { Activity, AlertCircle, Inbox } from 'lucide-preact';
import { Button } from '../../../components/ui/Button.js';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="relative">
      <div className="absolute inset-0 animate-ping rounded-full bg-signal-500/20" />
      <Activity className="relative h-8 w-8 animate-pulse text-signal-500" strokeWidth={1.5} />
    </div>
    <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
      Synchronizing Telemetry...
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <Inbox className="h-8 w-8 text-[var(--stats-detail-color)] opacity-40" strokeWidth={1.5} />
    <div className="flex flex-col items-center text-center gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
          No Activity Detected
        </div>
        <div className="mt-2 text-xs text-[var(--stats-detail-color)]">
          Telemetry will appear once the project starts executing tasks.
        </div>
      </div>
      {onReset && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReset}
        >
          Reset Filters
        </Button>
      )}
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-rose-500/20 bg-rose-500/5">
    <AlertCircle className="h-8 w-8 text-rose-500 opacity-60" strokeWidth={1.5} />
    <div className="flex flex-col items-center text-center gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-500/80">
          Telemetry Synchronisation Failed
        </div>
        <div className="mt-2 text-xs text-[var(--stats-detail-color)] max-w-xs px-6">
          {message || "An unexpected error occurred while retrieving graph data. Please try refreshing the page."}
        </div>
      </div>
      {onRetry && (
        <Button
          type="button"
          variant="danger"
          size="sm"
          onClick={onRetry}
        >
          Retry
        </Button>
      )}
    </div>
  </div>
);
=======
import type { FunctionComponent } from 'preact';
import { AlertCircle, BarChart3, RefreshCcw } from 'lucide-preact';
import { Button } from '../../../components/ui/Button.js';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="flex w-full max-w-[200px] flex-col gap-3">
      <div className="animate-pulse rounded-xl bg-slate-200 dark:bg-void-700 h-6 w-3/4" />
      <div className="animate-pulse rounded-xl bg-slate-200 dark:bg-void-700 h-6 w-1/2" />
      <div className="animate-pulse rounded-xl bg-slate-200 dark:bg-void-700 h-6 w-full" />
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <BarChart3 className="h-8 w-8 text-slate-300 dark:text-void-500" strokeWidth={1.5} />
    <div className="flex flex-col items-center text-center gap-4">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--stats-label-color)]">
          No data for this window
        </div>
        <div className="mt-2 text-xs text-[var(--stats-detail-color)]">
          Telemetry will appear once the project starts executing tasks.
        </div>
      </div>
      {onReset && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onReset}
        >
          Reset Filters
        </Button>
      )}
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex h-[24rem] w-full flex-col items-center justify-center gap-4 rounded-[1.85rem] border border-dashed border-[var(--stats-card-border)] bg-[var(--stats-card-bg)]/30">
    <div className="flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/8 p-4">
      <AlertCircle className="mb-4 h-8 w-8 text-rose-500 opacity-60" strokeWidth={1.5} />
      <div className="flex flex-col items-center text-center gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.25em] text-rose-500/80">
            Telemetry Synchronisation Failed
          </div>
          <div className="mt-2 text-xs text-[var(--stats-detail-color)] max-w-xs px-6">
            {message || "An unexpected error occurred while retrieving graph data. Please try refreshing the page."}
          </div>
        </div>
        {onRetry && (
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={onRetry}
          >
            <RefreshCcw className="mr-2 h-4 w-4" /> Retry
          </Button>
        )}
      </div>
    </div>
  </div>
);
>>>>>>> REPLACE
```

### 3. Update `UsageGraphTooltip.tsx`

```
<<<<<<< SEARCH
  label,
  bucketStart,
  activeSeries,
}) => {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute top-3 z-50 w-64 -translate-x-1/2 rounded-[1.25rem] border border-[var(--stats-card-border)] bg-[var(--stats-card-bg)] px-5 py-4 shadow-[var(--stats-card-shadow)] backdrop-blur-2xl transition-all duration-200"
      style={{ left: `${Math.min(92, Math.max(8, left))}%` }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--stats-label-color)]">{label}</div>
      <div className="mt-2 text-sm font-black text-[var(--stats-value-color)]">{formatDateTime(bucketStart)}</div>
      <div className="mt-4 space-y-2.5">
=======
  label,
  bucketStart,
  activeSeries,
}) => {
  if (!visible) return null;

  const date = new Date(bucketStart);
  let formattedDate = bucketStart;
  if (!Number.isNaN(date.getTime())) {
    const isHourlyOrDaily = date.getMinutes() === 0 && date.getSeconds() === 0;
    formattedDate = isHourlyOrDaily
      ? new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).replace('24:00', '00:00')
      : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(date).replace('24:00', '00:00');
  }

  return (
    <div
      className="pointer-events-none absolute top-3 z-50 w-64 -translate-x-1/2 rounded-[1.25rem] border border-[var(--stats-card-border)] border-t-2 border-t-amber-500/60 bg-[var(--stats-card-bg)] px-5 py-4 shadow-[var(--stats-card-shadow)] backdrop-blur-2xl transition-all duration-200"
      style={{ left: `${Math.min(92, Math.max(8, left))}%` }}
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-2 text-sm font-black text-[var(--stats-value-color)]">{formattedDate}</div>
      <div className="mt-4 space-y-2.5">
>>>>>>> REPLACE
```

### 4. Verification
- Use `run_in_bash_session` to run:
  - `pnpm run typecheck`
  - `pnpm run test:dashboard -- dashboard/src/v2/pages/stats/__tests__/UsageFilterMenu.test.tsx`
  - `pnpm run build`

### 5. Pre commit steps
- Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
