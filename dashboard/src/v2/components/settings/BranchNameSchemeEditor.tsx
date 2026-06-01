import type { FunctionComponent } from "preact";
import { SelectInput } from "./SettingsFormFields.js";
import { getBranchSchemeOptions, getCanonicalBranchNameToken } from "../../lib/settings-view-models.js";

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
  // Normalize the incoming value to its canonical token form
  const canonicalToken = getCanonicalBranchNameToken(value || "");
  const selectedValue = `{${canonicalToken}}`;

  const options = getBranchSchemeOptions();

  return (
    <SelectInput
      value={selectedValue}
      onChange={onChange}
      options={options}
      disabled={disabled}
      aria-label="Sprint branch name scheme"
    />
  );
};
