import type { FunctionComponent } from "preact";
import { Plus, Trash2 } from "lucide-preact";
import type { PreviewEnvironmentVariable } from "../../../types.js";
import { useDashboardI18n } from "../../i18n/index.js";
import {
  browserPreviewMessages,
  type BrowserPreviewMessageKey,
  type BrowserPreviewMessageVariables,
} from "../../i18n/messages/browser-preview.js";

const isSecretKey = (key: string): boolean => /(TOKEN|KEY|SECRET|PASSWORD|AUTH|CREDENTIAL)/i.test(key);

const emptyVariable = (): PreviewEnvironmentVariable => ({ key: "", value: "", enabled: true });

export const PreviewEnvironmentEditor: FunctionComponent<{
  variables: PreviewEnvironmentVariable[];
  onChange: (variables: PreviewEnvironmentVariable[]) => void;
  disabled?: boolean;
  inheritedVariables?: PreviewEnvironmentVariable[];
  addLabel?: string;
  valueLabel?: string;
}> = ({
  variables,
  onChange,
  disabled = false,
  inheritedVariables = [],
  addLabel,
  valueLabel,
}) => {
  const { formatNumber, translate } = useDashboardI18n();
  const t = (key: BrowserPreviewMessageKey, variables?: BrowserPreviewMessageVariables) => (
    translate(browserPreviewMessages, key, variables)
  );
  const resolvedAddLabel = addLabel ?? t("addVariable");
  const resolvedValueLabel = valueLabel ?? t("environmentVariableValue");
  const rows = variables.length > 0 ? variables : [];
  const updateRow = (index: number, patch: Partial<PreviewEnvironmentVariable>): void => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };

  return (
    <div className="space-y-3">
      {inheritedVariables.length > 0 ? (
        <div className="rounded-2xl border border-signal-500/20 bg-signal-500/10 px-3 py-2.5 dark:border-signal-400/20 dark:bg-signal-400/10">
          <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-300">{t("inheritedDefaults")}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {inheritedVariables.filter((variable) => variable.enabled !== false).map((variable) => (
              <span key={variable.key} className="rounded-full border border-black/[0.06] bg-white/70 px-2.5 py-1 font-mono text-[10px] font-semibold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.06] dark:text-slate-300">
                {variable.key}={isSecretKey(variable.key) ? "••••" : variable.value || "\"\""}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        {rows.map((variable, index) => {
          const valueInputType = isSecretKey(variable.key) ? "password" : "text";
          const rowName = variable.key || formatNumber(index + 1);
          return (
            <div key={`env-${index}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-2xl border border-black/[0.06] bg-white/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.04]">
              <label className="flex h-10 items-center" title={variable.enabled === false ? t("variableDisabled") : t("variableEnabled")}>
                <input
                  type="checkbox"
                  checked={variable.enabled !== false}
                  disabled={disabled}
                  aria-label={t("enableEnvironmentVariable", { name: rowName })}
                  onChange={(event) => updateRow(index, { enabled: (event.currentTarget as HTMLInputElement).checked })}
                  className="h-4 w-4 rounded border-slate-300 text-signal-600 focus:ring-signal-500"
                />
              </label>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_auto]">
                <input
                  value={variable.key}
                  disabled={disabled}
                  placeholder="CODE_UX_ALLOW_PUBLIC_DASHBOARD"
                  aria-label={t("environmentVariableName")}
                  onInput={(event) => updateRow(index, { key: (event.currentTarget as HTMLInputElement).value })}
                  className="h-10 min-w-0 rounded-xl border border-black/[0.08] bg-white/80 px-3 font-mono text-xs text-slate-800 outline-none transition focus:border-signal-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-void-950 dark:text-slate-100"
                />
                <input
                  type={valueInputType}
                  value={variable.value}
                  disabled={disabled}
                  placeholder="1"
                  aria-label={resolvedValueLabel}
                  onInput={(event) => updateRow(index, { value: (event.currentTarget as HTMLInputElement).value })}
                  className="h-10 min-w-0 rounded-xl border border-black/[0.08] bg-white/80 px-3 font-mono text-xs text-slate-800 outline-none transition focus:border-signal-500/50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[0.08] dark:bg-void-950 dark:text-slate-100"
                />
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={t("removeEnvironmentVariable", { name: rowName })}
                  title={t("removeVariable")}
                  onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== index))}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] text-slate-500 transition hover:border-status-red/30 hover:bg-status-red/10 hover:text-status-red disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08]"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange([...rows, emptyVariable()])}
        className="inline-flex h-10 items-center gap-2 rounded-2xl border border-black/[0.08] px-3 text-xs font-semibold text-slate-700 transition hover:border-black/[0.16] hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-200 dark:hover:border-white/[0.16] dark:hover:text-white"
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
        {resolvedAddLabel}
      </button>
    </div>
  );
};
