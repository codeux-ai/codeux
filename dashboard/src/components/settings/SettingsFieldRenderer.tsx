import type { FunctionComponent, JSX } from "preact";
import type { FieldDescriptor } from "./field-descriptors.js";
import { FieldLabel, ToggleRow } from "./primitives.js";
import { AvantgardeSelect } from "../../v2/components/ui/AvantgardeSelect.js";

interface SettingsFieldRendererProps<T> {
  descriptor: FieldDescriptor<T>;
  context: T;
  onChange: (next: T) => void;
  className?: string;
}

export const SettingsFieldRenderer = <T,>({
  descriptor,
  context,
  onChange,
  className = "block space-y-2",
}: SettingsFieldRendererProps<T>) => {
  const isDisabled = descriptor.disabled ? descriptor.disabled(context) : false;

  switch (descriptor.type) {
    case "toggle":
      return (
        <div className="space-y-1">
          <ToggleRow
            label={descriptor.label}
            checked={descriptor.getValue(context)}
            disabled={isDisabled}
            onToggle={(checked) => onChange(descriptor.onToggle(context, checked))}
          />
          {descriptor.description && (
            <p className="text-[11px] text-slate-500 px-1">{descriptor.description}</p>
          )}
        </div>
      );

    case "input": {
      const isNumber = descriptor.inputType === "number";
      return (
        <label className={className}>
          <FieldLabel>{descriptor.label}</FieldLabel>
          <input
            type={descriptor.inputType || "text"}
            min={descriptor.min}
            max={descriptor.max}
            step={descriptor.step}
            value={descriptor.getValue(context)}
            disabled={isDisabled}
            placeholder={descriptor.placeholder}
            onInput={(event: JSX.TargetedEvent<HTMLInputElement>) =>
              onChange(descriptor.onInput(context, event.currentTarget.value))
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
          />
          {descriptor.description && (
            <p className="text-[11px] text-slate-500">{descriptor.description}</p>
          )}
        </label>
      );
    }

    case "textarea":
      return (
        <label className={className}>
          <FieldLabel>{descriptor.label}</FieldLabel>
          <textarea
            rows={descriptor.rows || 4}
            value={descriptor.getValue(context)}
            disabled={isDisabled}
            placeholder={descriptor.placeholder}
            onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement>) =>
              onChange(descriptor.onInput(context, event.currentTarget.value))
            }
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 disabled:opacity-50"
          />
          {descriptor.description && (
            <p className="text-[11px] text-slate-500">{descriptor.description}</p>
          )}
        </label>
      );

    case "select":
      return (
        <div className={className}>
          <FieldLabel>{descriptor.label}</FieldLabel>
          <AvantgardeSelect
            value={descriptor.getValue(context)}
            disabled={isDisabled}
            onChange={(val) => onChange(descriptor.onChange(context, val))}
            options={descriptor.options}
          />
          {descriptor.description && (
            <p className="text-[11px] text-slate-500">{descriptor.description}</p>
          )}
        </div>
      );

    case "range":
      return (
        <label className={className}>
          <FieldLabel>
            {descriptor.label}
            {descriptor.getLabelSuffix && ` (${descriptor.getLabelSuffix(descriptor.getValue(context))})`}
          </FieldLabel>
          <input
            type="range"
            min={descriptor.min}
            max={descriptor.max}
            value={descriptor.getValue(context)}
            disabled={isDisabled}
            onInput={(event: JSX.TargetedEvent<HTMLInputElement>) =>
              onChange(descriptor.onInput(context, Number(event.currentTarget.value)))
            }
            className="w-full"
          />
          {descriptor.description && (
            <p className="text-[11px] text-slate-500">{descriptor.description}</p>
          )}
        </label>
      );

    default:
      return null;
  }
};
