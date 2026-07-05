import type { FunctionComponent } from "preact";
import { type ListWindowOption, LIST_WINDOW_OPTIONS } from "../../lib/list-window.js";
import { ListFilter } from "lucide-preact";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";

interface ListWindowSelectorProps {
  value: ListWindowOption;
  onChange: (value: ListWindowOption) => void;
  label?: string;
  totalItems?: number;
  visibleCount?: number;
  itemLabel?: string;
  ariaLabel?: string;
}

export const ListWindowSelector: FunctionComponent<ListWindowSelectorProps> = ({
  value,
  onChange,
  label = "Show",
  totalItems,
  visibleCount,
  itemLabel = "items",
  ariaLabel = "Select number of ledger entries",
}) => {
  const tokens = useInteractionTokens();
  const options = LIST_WINDOW_OPTIONS.map((option) => ({
    value: String(option),
    label: `${label} ${option}`,
    icon: <ListFilter className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.1} />,
  }));
  const hasRange = typeof totalItems === "number" && typeof visibleCount === "number";
  const rangeText = hasRange
    ? totalItems === 0
      ? `Showing 0 ${itemLabel}.`
      : `Showing 1 to ${Math.min(visibleCount, totalItems).toLocaleString()} of ${totalItems.toLocaleString()} ${itemLabel}.`
    : null;

  return (
    <div
      className="inline-flex min-w-0 flex-col gap-1"
      style={{
        transitionDuration: tokens.listReorder.duration,
        transitionTimingFunction: tokens.listReorder.ease,
      }}
      data-list-window-selector
    >
      <AvantgardeSelect
        value={String(value)}
        onChange={(nextValue) => {
          const next = nextValue === "All" ? "All" : Number(nextValue);
          onChange(next as ListWindowOption);
        }}
        options={options}
        variant="default"
        className="min-w-[8.75rem] motion-reduce:transition-none"
        aria-label={ariaLabel}
      />
      {rangeText ? (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {rangeText}
        </span>
      ) : null}
    </div>
  );
};
