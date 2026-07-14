import type { FunctionComponent } from "preact";
import { type ListWindowOption, LIST_WINDOW_OPTIONS } from "../../lib/list-window.js";
import { ListFilter } from "lucide-preact";
import { AvantgardeSelect } from "./AvantgardeSelect.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { shellMessages } from "../../i18n/messages/shell.js";

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
  label,
  totalItems,
  visibleCount,
  itemLabel,
  ariaLabel,
}) => {
  const { formatNumber, translate } = useOptionalDashboardI18n();
  const resolvedLabel = label ?? translate(shellMessages, "show");
  const resolvedItemLabel = itemLabel ?? translate(shellMessages, "items");
  const tokens = useInteractionTokens();
  const options = LIST_WINDOW_OPTIONS.map((option) => ({
    value: String(option),
    label: `${resolvedLabel} ${typeof option === "number" ? formatNumber(option) : translate(shellMessages, "all")}`,
    icon: <ListFilter className="h-3.5 w-3.5 text-slate-400" strokeWidth={2.1} />,
  }));
  const hasRange = typeof totalItems === "number" && typeof visibleCount === "number";
  const rangeText = hasRange
    ? totalItems === 0
      ? translate(shellMessages, "showingNone", { itemLabel: resolvedItemLabel })
      : translate(shellMessages, "showingRange", {
          visibleCount: formatNumber(Math.min(visibleCount, totalItems)),
          totalItems: formatNumber(totalItems),
          itemLabel: resolvedItemLabel,
        })
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
        aria-label={ariaLabel ?? translate(shellMessages, "selectLedgerEntries")}
      />
      {rangeText ? (
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {rangeText}
        </span>
      ) : null}
    </div>
  );
};
