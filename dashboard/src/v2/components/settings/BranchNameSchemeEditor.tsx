import type { FunctionComponent } from "preact";
import { TextInput } from "./SettingsFormFields.js";
import { BRANCH_NAME_TOKEN_LABELS } from "../../lib/settings-view-models.js";

export interface BranchNameSchemeEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export const BranchNameSchemeEditor: FunctionComponent<BranchNameSchemeEditorProps> = ({
  value,
  onChange,
  disabled,
}) => {
  return (
    <div className="flex flex-col gap-2 min-w-[320px]">
      <TextInput
        value={value || ""}
        onChange={onChange}
        disabled={disabled}
        mono={true}
        placeholder="e.g. feature/sprint{sprint_id}-implementation"
        aria-label="Sprint branch scheme"
        aria-description="Template used when naming sprint branches."
      />
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-slate-400 dark:text-slate-500">
        <span className="font-bold uppercase tracking-wider text-slate-500">Placeholders:</span>
        {Object.keys(BRANCH_NAME_TOKEN_LABELS).map((token) => (
          <code key={token} className="rounded bg-black/5 px-1 py-0.5 dark:bg-white/5">
            {`{${token}}`}
          </code>
        ))}
      </div>
    </div>
  );
};
