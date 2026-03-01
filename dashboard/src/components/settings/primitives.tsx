import type { ComponentChildren, FunctionComponent } from "preact";

interface SettingsCardProps {
  title: string;
  description?: string;
  children: ComponentChildren;
}

export const SettingsCard: FunctionComponent<SettingsCardProps> = ({ title, description, children }) => {
  return (
    <article className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-sm font-bold text-white">{title}</h3>
      {description ? <p className="text-xs text-slate-500">{description}</p> : null}
      {children}
    </article>
  );
};

interface FieldLabelProps {
  children: ComponentChildren;
}

export const FieldLabel: FunctionComponent<FieldLabelProps> = ({ children }) => {
  return <span className="text-xs text-slate-400">{children}</span>;
};

interface ToggleRowProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onToggle: (checked: boolean) => void;
}

export const ToggleRow: FunctionComponent<ToggleRowProps> = ({ checked, disabled, label, onToggle }) => {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/70 bg-slate-950/50 px-3 py-2">
      <span className="text-sm text-slate-200">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(event.currentTarget.checked)}
        className="h-4 w-4 rounded border-slate-700 bg-slate-900 disabled:opacity-50"
      />
    </label>
  );
};
