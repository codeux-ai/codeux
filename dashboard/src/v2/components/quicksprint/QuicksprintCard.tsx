import type { FunctionComponent } from "preact";
import { Sparkles, ShieldCheck, Accessibility, Zap, Edit } from "lucide-preact";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

interface QuicksprintCardProps {
  template: QuicksprintTemplateRecord;
  selected: boolean;
  onSelect: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

const IconFallbackMap: Record<string, FunctionComponent<any>> = {
  Sparkles,
  ShieldCheck,
  Accessibility,
  Zap,
};

export const QuicksprintCard: FunctionComponent<QuicksprintCardProps> = ({
  template,
  selected,
  onSelect,
  onEdit,
}) => {
  const IconComponent = IconFallbackMap[template.icon] || Zap;

  let badgeStyles = "bg-void-800 text-gray-400";
  if (template.category === "engineering") {
    badgeStyles = "bg-signal-500/10 text-signal-500";
  } else if (template.category === "security") {
    badgeStyles = "bg-ember-500/10 text-ember-500";
  } else if (template.category === "design") {
    badgeStyles = "bg-purple-400/10 text-purple-400";
  }

  return (
    <div
      onClick={onSelect}
      className={`relative flex flex-col p-5 rounded-xl border cursor-pointer transition-all duration-200 group ${
        selected
          ? "border-signal-500 bg-signal-500/5 shadow-[0_0_15px_rgba(var(--color-signal-500),0.15)]"
          : "border-white/[0.06] bg-void-800/50 hover:border-signal-500/40 hover:shadow-[0_0_10px_rgba(var(--color-signal-500),0.1)] hover:bg-void-800"
      }`}
    >
      {!template.isBuiltIn && onEdit && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-white rounded-md hover:bg-white/10 transition-colors"
          title="Edit custom template"
        >
          <Edit className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-3">
        <div
          className={`p-2 rounded-lg ${
            selected ? "bg-signal-500/20 text-signal-400" : "bg-white/5 text-gray-300 group-hover:text-signal-400 group-hover:bg-signal-500/10 transition-colors"
          }`}
        >
          <IconComponent className="w-5 h-5" />
        </div>
        <div className="flex-1">
          <h3 className="text-white font-bold leading-tight">{template.name}</h3>
        </div>
      </div>

      <p className="text-gray-400 text-sm leading-relaxed mb-4 flex-1">
        {template.description}
      </p>

      <div className="flex items-center justify-between mt-auto pt-2">
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${badgeStyles} uppercase tracking-wider`}>
          {template.category}
        </span>
        <span className="text-xs text-gray-500">
          {template.defaultTaskCount} subtask{template.defaultTaskCount !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
};
