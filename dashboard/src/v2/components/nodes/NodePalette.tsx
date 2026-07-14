import type { FunctionComponent } from "preact";
import { Box, LockKeyhole, Plus } from "lucide-preact";
import type { NodeDefinitionSummary } from "../../lib/node-flow-api.js";
import { useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodePaletteProps {
  definitions: NodeDefinitionSummary[];
  disabled?: boolean;
  loading?: boolean;
  onCreateNode: (definition: NodeDefinitionSummary) => void;
}

export const NodePalette: FunctionComponent<NodePaletteProps> = ({ definitions, disabled = false, loading = false, onCreateNode }) => {
  const { t } = useNodesI18n();
  const categories = new Map<string, NodeDefinitionSummary[]>();
  for (const definition of definitions) {
    categories.set(definition.category, [...(categories.get(definition.category) ?? []), definition]);
  }
  return (
    <aside className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035] xl:w-[300px] xl:shrink-0" aria-labelledby="node-palette-heading">
      <div className="flex items-center justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("registryEyebrow")}</p><h2 id="node-palette-heading" className="text-base font-bold text-slate-900 dark:text-white">{t("nodeCatalog")}</h2></div>
        <Plus className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>
      {loading ? <p role="status" className="text-sm text-slate-500">{t("loadingDefinitions")}</p> : null}
      {!loading && definitions.length === 0 ? <p role="status" className="text-sm text-slate-500">{t("noDefinitions")}</p> : null}
      {[...categories.entries()].map(([category, entries]) => (
        <section key={category} aria-labelledby={`node-category-${category}`}>
          <h3 id={`node-category-${category}`} className="mb-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{category}</h3>
          <div className="grid gap-2">
            {entries.map((definition) => (
              <button key={`${definition.type}@${definition.version}`} type="button" disabled={disabled || !definition.executable} onClick={() => onCreateNode(definition)} className="rounded-xl border border-black/[0.07] bg-white/70 p-3 text-left transition hover:border-signal-500/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:cursor-not-allowed disabled:opacity-55 dark:border-white/[0.07] dark:bg-white/[0.03]" aria-label={t("addNode", { label: definition.label })}>
                <span className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Box className="h-4 w-4 text-signal-500" aria-hidden="true" />{definition.label}<span className="ml-auto text-[10px] text-slate-400">v{definition.version}</span></span>
                <span className="mt-1 block text-xs leading-relaxed text-slate-500">{definition.description}</span>
                <span className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  <span>{definition.executionKind}</span><span>{definition.sideEffect}</span>{definition.credentials.length ? <span className="inline-flex items-center gap-1"><LockKeyhole className="h-3 w-3" aria-hidden="true" />{t("credential")}</span> : null}{!definition.executable ? <span>{t("unavailable")}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </aside>
  );
};
