import type { FunctionComponent } from "preact";
import { TextInput } from "./SettingsFormFields.js";
import { getBranchNameTokenLabels, getTaskPrTitleTokenLabels } from "../../lib/settings-view-models.js";
import { useSettingsOperationsTranslations } from "../../i18n/messages/settings-operations.js";

export interface BranchNameSchemeEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface TemplateSchemeEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder: string;
  ariaLabel: string;
  ariaDescription: string;
  tokenLabels: Record<string, string>;
}

const TemplateSchemeEditor: FunctionComponent<TemplateSchemeEditorProps> = ({
  value,
  onChange,
  disabled,
  placeholder,
  ariaLabel,
  ariaDescription,
  tokenLabels,
}) => {
  const { t } = useSettingsOperationsTranslations();
  return <div className="flex flex-col gap-2 min-w-0 w-full">
    <TextInput
      value={value || ""}
      onChange={onChange}
      disabled={disabled}
      mono={true}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-description={ariaDescription}
    />
    <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-400 dark:text-slate-500">
      <span className="font-bold uppercase tracking-wider text-slate-500">{t("Placeholders:")}</span>
      {Object.keys(tokenLabels).map((token) => (
        <code key={token} className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/5">
          {`{${token}}`}
        </code>
      ))}
    </div>
  </div>;
};

export const BranchNameSchemeEditor: FunctionComponent<BranchNameSchemeEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { locale, t } = useSettingsOperationsTranslations();
  return (
    <TemplateSchemeEditor
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder="e.g. feature/sprint{sprint_id}-implementation"
      ariaLabel={t("Sprint branch scheme")}
      ariaDescription={t("Template used when naming sprint branches.")}
      tokenLabels={getBranchNameTokenLabels(locale)}
    />
  );
};

export const TaskPrTitleSchemeEditor: FunctionComponent<BranchNameSchemeEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  const { locale, t } = useSettingsOperationsTranslations();
  return <TemplateSchemeEditor
    value={value}
    onChange={onChange}
    disabled={disabled}
    placeholder="e.g. ({sprint_tag}) {task_title}"
    ariaLabel={t("Task PR title scheme")}
    ariaDescription={t("Template used when naming automatically-created task pull requests.")}
    tokenLabels={getTaskPrTitleTokenLabels(locale)}
  />;
};
