import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Clock, Timer } from "lucide-preact";

import {
  deriveLiveDurationDisplay,
  type LiveDurationDispatchTiming,
} from "../../lib/live-duration-display.js";
import type { LiveTaskTimingSummary } from "../../lib/live-stats.js";
import { formatDuration } from "../../lib/format-duration.js";
import { useLiveI18n } from "../../i18n/messages/live.js";

function extractRetryAfterIso(errorMessage: string): string | null {
  const match = errorMessage.match(/\[RETRY_AFTER:(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\]/);
  return match?.[1] ?? null;
}

export const QuotaCountdown: FunctionComponent<{ errorMessage: string }> = memo(({ errorMessage }) => {
  const { locale, t } = useLiveI18n();
  const retryIso = extractRetryAfterIso(errorMessage);
  const [remaining, setRemaining] = useState(() =>
    retryIso ? Math.max(0, Math.floor((new Date(retryIso).getTime() - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!retryIso) { setRemaining(null); return; }
    const update = () => Math.max(0, Math.floor((new Date(retryIso).getTime() - Date.now()) / 1000));
    setRemaining(update());
    const timer = window.setInterval(() => {
      const left = update();
      setRemaining(left);
      if (left <= 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryIso]);

  if (remaining == null) {
    return <div className="text-status-red">{errorMessage}</div>;
  }

  return (
    <div className="flex items-center gap-2 text-status-amber" role="status" aria-live="polite">
      <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
      <span>
        {remaining <= 0
          ? t("quotaAvailable")
          : t("quotaResetsIn", { duration: formatDuration(remaining, locale) })}
      </span>
    </div>
  );
});

export const TaskDuration: FunctionComponent<{
  taskTiming?: LiveTaskTimingSummary | null;
  dispatchTiming?: LiveDurationDispatchTiming | null;
}> = memo(({ taskTiming, dispatchTiming }) => {
  const { locale } = useLiveI18n();
  const [now, setNow] = useState(() => Date.now());
  const display = useMemo(() => deriveLiveDurationDisplay({
    taskTiming,
    dispatchTiming,
    now,
  }), [taskTiming, dispatchTiming, now]);

  useEffect(() => {
    setNow(Date.now());
  }, [
    dispatchTiming?.finishedAt,
    dispatchTiming?.startedAt,
    dispatchTiming?.status,
    taskTiming?.activeStage,
    taskTiming?.startedAt,
    taskTiming?.totalSeconds,
  ]);

  useEffect(() => {
    if (display.mode !== "live") {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [display.mode]);

  if (!display.visible) return null;

  return (
    <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400">
      <Timer className="w-3 h-3" strokeWidth={2} />
      <span>{formatDuration(display.elapsedSeconds, locale)}</span>
    </div>
  );
});
