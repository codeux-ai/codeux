import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { Plus, Trash2 } from "lucide-preact";
import type { NodeFlowJsonObject, NodeFlowJsonValue, NodeWidgetField as NodeWidgetFieldContract } from "../../types.js";
import { getWidgetFieldDefaultValue } from "../../lib/node-flow-view-models.js";
import { useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodeWidgetFieldProps {
  field: NodeWidgetFieldContract;
  value: NodeFlowJsonValue | undefined;
  validationMessages?: string[];
  onChange: (fieldId: string, value: NodeFlowJsonValue) => void;
}

const fieldBaseClass = "w-full rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100";

const stringifyJson = (value: NodeFlowJsonValue | undefined): string => {
  return JSON.stringify(value ?? {}, null, 2);
};

const isStringRecord = (value: NodeFlowJsonValue | undefined): value is NodeFlowJsonObject => (
  Boolean(value)
  && typeof value === "object"
  && !Array.isArray(value)
  && Object.values(value as NodeFlowJsonObject).every((entry) => typeof entry === "string")
);

export const NodeWidgetField: FunctionComponent<NodeWidgetFieldProps> = ({
  field,
  value,
  validationMessages = [],
  onChange,
}) => {
  const { t } = useNodesI18n();
  const resolvedValue = value === undefined ? getWidgetFieldDefaultValue(field) : value;
  const errorId = validationMessages.length > 0 ? `node-widget-${field.id}-error` : undefined;

  const renderInput = () => {
    if (field.type === "textarea") {
      return (
        <textarea
          id={`node-widget-${field.id}`}
          className={`${fieldBaseClass} min-h-24 resize-y`}
          value={typeof resolvedValue === "string" ? resolvedValue : ""}
          placeholder={field.placeholder}
          aria-describedby={errorId}
          onInput={(event) => onChange(field.id, event.currentTarget.value)}
        />
      );
    }

    if (field.type === "number") {
      return (
        <input
          id={`node-widget-${field.id}`}
          className={fieldBaseClass}
          type="number"
          min={field.min}
          max={field.max}
          step={field.step ?? 1}
          value={typeof resolvedValue === "number" ? String(resolvedValue) : ""}
          placeholder={field.placeholder}
          aria-describedby={errorId}
          onInput={(event) => {
            const next = Number(event.currentTarget.value);
            onChange(field.id, Number.isFinite(next) ? next : 0);
          }}
        />
      );
    }

    if (field.type === "boolean") {
      return (
        <label className="inline-flex items-center gap-3 rounded-xl border border-black/[0.08] bg-white/60 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200">
          <input
            id={`node-widget-${field.id}`}
            type="checkbox"
            checked={resolvedValue === true}
            aria-describedby={errorId}
            className="h-4 w-4 rounded border-slate-300 text-signal-500 focus:ring-signal-500"
            onChange={(event) => onChange(field.id, event.currentTarget.checked)}
          />
          {t("enabled")}
        </label>
      );
    }

    if (field.type === "select") {
      return (
        <select
          id={`node-widget-${field.id}`}
          className={fieldBaseClass}
          value={String(resolvedValue)}
          aria-describedby={errorId}
          onChange={(event) => {
            const selected = field.options?.find((option) => String(option.value) === event.currentTarget.value);
            onChange(field.id, selected?.value ?? event.currentTarget.value);
          }}
        >
          {(field.options ?? []).map((option) => (
            <option key={`${field.id}-${String(option.value)}`} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      );
    }

    if (field.type === "json") {
      return <JsonEditor field={field} value={resolvedValue} errorId={errorId} onChange={onChange} />;
    }

    if (field.type === "keyValue") {
      return <KeyValueEditor field={field} value={resolvedValue} errorId={errorId} onChange={onChange} />;
    }

    return (
      <input
        id={`node-widget-${field.id}`}
        className={fieldBaseClass}
        type="text"
        value={typeof resolvedValue === "string" ? resolvedValue : ""}
        placeholder={field.placeholder ?? (field.type === "secretRef" ? "secret://provider/name" : undefined)}
        autoComplete={field.type === "secretRef" ? "off" : undefined}
        aria-describedby={errorId}
        onInput={(event) => onChange(field.id, event.currentTarget.value)}
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={`node-widget-${field.id}`} className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
        {field.label}{field.required ? " *" : ""}
      </label>
      {renderInput()}
      {field.description ? (
        <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{field.description}</p>
      ) : null}
      {validationMessages.length > 0 ? (
        <div id={errorId} role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.08] px-3 py-2 text-xs text-status-red">
          {validationMessages.join(" ")}
        </div>
      ) : null}
    </div>
  );
};

const JsonEditor: FunctionComponent<{
  field: NodeWidgetFieldContract;
  value: NodeFlowJsonValue;
  errorId?: string;
  onChange: (fieldId: string, value: NodeFlowJsonValue) => void;
}> = ({ field, value, errorId, onChange }) => {
  const { t } = useNodesI18n();
  const [text, setText] = useState(() => stringifyJson(value));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(stringifyJson(value));
    setError(null);
  }, [value]);

  return (
    <div className="flex flex-col gap-2">
      <textarea
        id={`node-widget-${field.id}`}
        className={`${fieldBaseClass} min-h-36 font-mono text-xs`}
        value={text}
        aria-describedby={errorId}
        spellcheck={false}
        onInput={(event) => {
          const nextText = event.currentTarget.value;
          setText(nextText);
          try {
            const parsed = JSON.parse(nextText) as NodeFlowJsonValue;
            setError(null);
            onChange(field.id, parsed);
          } catch {
            setError(t("invalidJson"));
          }
        }}
      />
      {error ? <span role="alert" className="text-xs font-semibold text-status-red">{error}</span> : null}
    </div>
  );
};

const KeyValueEditor: FunctionComponent<{
  field: NodeWidgetFieldContract;
  value: NodeFlowJsonValue;
  errorId?: string;
  onChange: (fieldId: string, value: NodeFlowJsonValue) => void;
}> = ({ field, value, errorId, onChange }) => {
  const { t } = useNodesI18n();
  const entries = useMemo(() => Object.entries(isStringRecord(value) ? value : {}), [value]);

  const updateEntry = (index: number, key: string, entryValue: string): void => {
    const next = entries.reduce<Record<string, string>>((acc, [existingKey, existingValue], entryIndex) => {
      const finalKey = entryIndex === index ? key.trim() : existingKey;
      if (finalKey) {
        acc[finalKey] = entryIndex === index ? entryValue : String(existingValue);
      }
      return acc;
    }, {});
    onChange(field.id, next);
  };

  const removeEntry = (index: number): void => {
    const next = entries.reduce<Record<string, string>>((acc, [existingKey, existingValue], entryIndex) => {
      if (entryIndex !== index) {
        acc[existingKey] = String(existingValue);
      }
      return acc;
    }, {});
    onChange(field.id, next);
  };

  return (
    <div className="flex flex-col gap-2" aria-describedby={errorId}>
      {entries.map(([key, entryValue], index) => (
        <div key={`${field.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] gap-2">
          <input
            aria-label={t("keyEntry", { label: field.label, index: index + 1 })}
            className={fieldBaseClass}
            value={key}
            onInput={(event) => updateEntry(index, event.currentTarget.value, String(entryValue))}
          />
          <input
            aria-label={t("valueEntry", { label: field.label, index: index + 1 })}
            className={fieldBaseClass}
            value={String(entryValue)}
            onInput={(event) => updateEntry(index, key, event.currentTarget.value)}
          />
          <button
            type="button"
            aria-label={t("removeEntry", { label: field.label, index: index + 1 })}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/[0.08] bg-white/70 text-slate-500 transition hover:text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.04]"
            onClick={() => removeEntry(index)}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="inline-flex w-fit items-center gap-2 rounded-xl border border-signal-500/25 bg-signal-500/[0.08] px-3 py-2 text-xs font-bold text-signal-700 transition hover:bg-signal-500/[0.12] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-signal-300"
        onClick={() => onChange(field.id, { ...(isStringRecord(value) ? value : {}), key: "" })}
      >
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        {t("addEntry")}
      </button>
    </div>
  );
};
