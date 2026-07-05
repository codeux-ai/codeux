import type { ComponentChildren, FunctionComponent } from "preact";
import { Filter } from "lucide-preact";
import type { IssueImportProviderMetadata } from "../../../lib/issue-import-view-models.js";

export interface IssueImportSummaryRailItem {
  label: string;
  value: string;
}

interface IssueImportSummaryRailProps {
  provider: IssueImportProviderMetadata;
  eyebrow?: string;
  title: string;
  description: string;
  items: IssueImportSummaryRailItem[];
  footer?: ComponentChildren;
}

export const IssueImportSummaryRail: FunctionComponent<IssueImportSummaryRailProps> = ({
  provider,
  eyebrow = "Backlog Browser",
  title,
  description,
  items,
  footer,
}) => (
  <aside className="relative hidden w-72 shrink-0 flex-col justify-between overflow-hidden bg-slate-950 p-7 text-white xl:flex">
    <span className="pointer-events-none absolute -left-5 -top-3 select-none font-display text-[7.4rem] font-black leading-none tracking-tighter text-white/[0.035]">
      {provider.label.toUpperCase()}
    </span>
    <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-transparent via-white/18 to-transparent" />

    <div className="relative z-10">
      <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${provider.accent.badgeClassName}`}>
        <Filter className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        {eyebrow}
      </div>
      <h2 className="mt-6 font-display text-2xl font-semibold leading-[0.95] tracking-tight">
        {title}
      </h2>
      <p className="mt-4 text-sm leading-relaxed text-white/52">
        {description}
      </p>
    </div>

    <div className="relative z-10 grid gap-3">
      {items.map((item) => (
        <div key={item.label} className="rounded-[1.1rem] border border-white/10 bg-white/[0.04] p-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/34">
            {item.label}
          </div>
          <div className="mt-1 truncate text-xs font-bold text-white">
            {item.value}
          </div>
        </div>
      ))}
      {footer}
    </div>
  </aside>
);
