export type FieldType = "toggle" | "input" | "select" | "range" | "textarea";

export interface BaseFieldDescriptor<T> {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  disabled?: (context: T) => boolean;
}

export interface ToggleFieldDescriptor<T> extends BaseFieldDescriptor<T> {
  type: "toggle";
  getValue: (context: T) => boolean;
  onToggle: (context: T, checked: boolean) => T;
}

export interface InputFieldDescriptor<T> extends BaseFieldDescriptor<T> {
  type: "input";
  inputType?: "text" | "number" | "password";
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  getValue: (context: T) => string | number;
  onInput: (context: T, value: string) => T;
}

export interface TextareaFieldDescriptor<T> extends BaseFieldDescriptor<T> {
  type: "textarea";
  rows?: number;
  placeholder?: string;
  getValue: (context: T) => string;
  onInput: (context: T, value: string) => T;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldDescriptor<T> extends BaseFieldDescriptor<T> {
  type: "select";
  options: SelectOption[];
  getValue: (context: T) => string;
  onChange: (context: T, value: string) => T;
}

export interface RangeFieldDescriptor<T> extends BaseFieldDescriptor<T> {
  type: "range";
  min: number;
  max: number;
  getValue: (context: T) => number;
  onInput: (context: T, value: number) => T;
  getLabelSuffix?: (value: number) => string;
}

export type FieldDescriptor<T> =
  | ToggleFieldDescriptor<T>
  | InputFieldDescriptor<T>
  | SelectFieldDescriptor<T>
  | RangeFieldDescriptor<T>
  | TextareaFieldDescriptor<T>;
