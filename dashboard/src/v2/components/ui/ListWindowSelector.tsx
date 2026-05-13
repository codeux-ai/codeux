import type { FunctionComponent } from "preact";
import { type ListWindowOption, LIST_WINDOW_OPTIONS } from "../../lib/list-window.js";
import { ListFilter } from "lucide-preact";
import { AvantgardeSelect } from "./AvantgardeSelect.js";

interface ListWindowSelectorProps {
  value: ListWindowOption;
  onChange: (value: ListWindowOption) => void;
  label?: string;
}

export const ListWindowSelector: FunctionComponent<ListWindowSelectorProps> = ({
  value,
  onChange,
  label = "Show",
}) => {
  const options = LIST_WINDOW_OPTIONS.map((option) => ({
    value: String(option),
    label: `${label} ${option}`,
    icon: <ListFilter className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.1} />,
  }));
  return (
    <AvantgardeSelect
      value={String(value)}
      onChange={(nextValue) => {
        const next = nextValue === "All" ? "All" : Number(nextValue);
        onChange(next as ListWindowOption);
      }}
      options={options}
      variant="default"
      className="min-w-[8.75rem]"
      aria-label="Select number of ledger entries"
    />
  );
};
