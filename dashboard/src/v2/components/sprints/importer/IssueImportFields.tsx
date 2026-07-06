import type { ComponentChildren, ComponentProps, FunctionComponent } from "preact";
import type { IssueImportProviderMetadata } from "../../../lib/issue-import-view-models.js";

interface IssueImportFilterSectionProps {
  title: string;
  description?: string;
  children: ComponentChildren;
  action?: ComponentChildren;
  compact?: boolean;
}

interface IssueImportFieldProps {
  label: string;
  hint?: string;
  children: ComponentChildren;
  disabled?: boolean;
  required?: boolean;
  className?: string;
}

type IssueImportTextInputProps = ComponentProps<"input"> & {
  provider: IssueImportProviderMetadata;
};

type IssueImportTextareaProps = ComponentProps<"textarea"> & {
  provider: IssueImportProviderMetadata;
};

type IssueImportSelectProps = ComponentProps<"select"> & {
  provider: IssueImportProviderMetadata;
};

const normalizeClassName = (className: ComponentProps<"input">["className"]): string => (
  typeof className === "string" ? className : ""
);

export const issueImportInputClassName = (
  provider: IssueImportProviderMetadata,
  className = "",
): string => [
  "min-h-11 w-full min-w-0 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-sm text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-signal-500 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200 dark:placeholder:text-slate-600",
  provider.accent.focusRingClassName,
  className,
].filter(Boolean).join(" ");

export const issueImportSelectClassName = (
  provider: IssueImportProviderMetadata,
  className = "",
): string => [
  "min-h-11 w-full min-w-0 rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500 outline-none transition-colors focus:border-signal-500 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-300",
  provider.accent.focusRingClassName,
  className,
].filter(Boolean).join(" ");

export const issueImportTextareaClassName = (
  provider: IssueImportProviderMetadata,
  className = "",
): string => [
  "min-h-28 w-full min-w-0 resize-y rounded-[1rem] border border-black/[0.07] bg-black/[0.025] px-3 py-3 text-sm leading-relaxed text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-signal-500 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[0.08] dark:bg-white/[0.035] dark:text-slate-200 dark:placeholder:text-slate-600",
  provider.accent.focusRingClassName,
  className,
].filter(Boolean).join(" ");

export const IssueImportFilterSection: FunctionComponent<IssueImportFilterSectionProps> = ({
  title,
  description,
  children,
  action,
  compact = false,
}) => (
  <section className={`grid gap-4 rounded-[1.25rem] border border-black/[0.06] bg-white/62 dark:border-white/[0.06] dark:bg-white/[0.025] ${compact ? "p-3" : "p-4"}`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-xs leading-relaxed text-slate-400 dark:text-slate-500">
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
    {children}
  </section>
);

export const IssueImportField: FunctionComponent<IssueImportFieldProps> = ({
  label,
  hint,
  children,
  disabled = false,
  required = false,
  className = "",
}) => (
  <label className={`grid min-w-0 gap-1.5 ${disabled ? "opacity-50" : ""} ${className}`}>
    <span className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
      {label}
      {required && (
        <>
          <span className="text-status-red" aria-hidden="true"> *</span>
          <span className="sr-only"> Required</span>
        </>
      )}
    </span>
    {children}
    {hint && <span className="text-xs leading-relaxed text-slate-400 dark:text-slate-500">{hint}</span>}
  </label>
);

export const IssueImportMultiSelectField: FunctionComponent<IssueImportFieldProps> = (props) => (
  <IssueImportField {...props} />
);

export const IssueImportTextInput: FunctionComponent<IssueImportTextInputProps> = ({
  provider,
  className,
  ...props
}) => (
  <input
    {...props}
    className={issueImportInputClassName(provider, normalizeClassName(className))}
  />
);

export const IssueImportDateInput: FunctionComponent<IssueImportTextInputProps> = ({
  type: _type,
  ...props
}) => (
  <IssueImportTextInput
    {...props}
    type="date"
  />
);

export const IssueImportNumberInput: FunctionComponent<IssueImportTextInputProps> = ({
  type: _type,
  ...props
}) => (
  <IssueImportTextInput
    {...props}
    type="number"
  />
);

export const IssueImportSelect: FunctionComponent<IssueImportSelectProps> = ({
  provider,
  className,
  children,
  ...props
}) => (
  <select
    {...props}
    className={issueImportSelectClassName(provider, normalizeClassName(className))}
  >
    {children}
  </select>
);

export const IssueImportTextarea: FunctionComponent<IssueImportTextareaProps> = ({
  provider,
  className,
  ...props
}) => (
  <textarea
    {...props}
    className={issueImportTextareaClassName(provider, normalizeClassName(className))}
  />
);
