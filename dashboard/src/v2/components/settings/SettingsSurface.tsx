import type { ComponentChildren, FunctionComponent } from "preact";
import { RefreshCw } from "lucide-preact";

export const NoticePanel: FunctionComponent<{
  tone?: "neutral" | "warning" | "success";
  title: string;
  children: ComponentChildren;
}> = ({ tone = "neutral", title, children }) => {
  const toneClass = tone === "warning"
    ? "border-status-red/20 bg-status-red/[0.06] text-status-red"
    : tone === "success"
      ? "border-signal-500/20 bg-signal-500/[0.07] text-signal-700 dark:text-signal-300"
      : "border-black/[0.06] bg-black/[0.03] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300";

  return (
    <div className={`rounded-xl border px-5 py-4 ${toneClass}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.16em]">{title}</div>
      <div className="mt-2 text-sm font-medium leading-relaxed">{children}</div>
    </div>
  );
};

export const ActionButton: FunctionComponent<{
  label: string;
  onClick: () => void;
  tone?: "primary" | "secondary" | "danger";
  busy?: boolean;
  disabled?: boolean;
}> = ({ label, onClick, tone = "secondary", busy = false, disabled = false }) => {
  const toneClass = tone === "primary"
    ? "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100"
    : tone === "danger"
      ? "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]"
      : "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${toneClass}`}
    >
      {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} /> : null}
      {label}
    </button>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SettingsHeader: FunctionComponent<{
  icon: FunctionComponent<any>;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ComponentChildren;
}> = ({ icon: Icon, eyebrow, title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-5 border-b border-black/[0.05] px-7 py-6 dark:border-white/[0.04]">
    <div>
      <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-signal-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.3} />
        {eyebrow}
      </div>
      <h2 className="mt-3 font-display text-4xl font-black tracking-tight text-slate-900 dark:text-white">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const SettingsBody: FunctionComponent<{
  error?: string | null;
  message?: string | null;
  loading?: boolean;
  loadingLabel?: string;
  children: ComponentChildren;
}> = ({ error, message, loading, loadingLabel = "Loading\u2026", children }) => (
  <div className="px-7 py-6">
    {error ? (
      <div className="mb-5">
        <NoticePanel title="Error" tone="warning">{error}</NoticePanel>
      </div>
    ) : null}

    {message ? (
      <div className="mb-5">
        <NoticePanel title="Success" tone="success">{message}</NoticePanel>
      </div>
    ) : null}

    {loading ? (
      <NoticePanel title="Loading">{loadingLabel}</NoticePanel>
    ) : (
      children
    )}
  </div>
);
