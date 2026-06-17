import type { FunctionComponent, VNode } from "preact";
import { Row, TextInput } from "./SettingsFormFields.js";

interface SprintKeyEditorProps {
  value: string;
  onChange: (value: string) => void;
  badge?: VNode | string;
}

export const SprintKeyEditor: FunctionComponent<SprintKeyEditorProps> = ({
  value,
  onChange,
  badge,
}) => {
  const handleChange = (newValue: string) => {
    // Strip non-alphanumeric characters, enforce uppercase, and limit to 10 chars max
    const sanitizedValue = newValue.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10);
    onChange(sanitizedValue);
  };

  return (
    <Row
      label="Sprint key prefix"
      description="Prefix used when generating sprint keys (e.g. SPR-1)."
      badge={badge}
    >
      <TextInput
        value={value}
        onChange={handleChange}
        mono
        aria-label="Sprint key prefix"
        aria-description="Prefix used when generating sprint keys (e.g. SPR-1)."
      />
    </Row>
  );
};
