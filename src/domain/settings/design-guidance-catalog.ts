import type { DesignGuidanceEntrySettings, DesignGuidanceSettings } from "../../contracts/app-types.js";

export const DESIGN_GUIDANCE_NONE_ID = "none";
export const CODE_UX_AWARD_WINNING_STYLEGUIDE_ID = "code-ux-award-winning";
export const CODE_UX_PRODUCT_TECH_STACK_ID = "code-ux-product-stack";

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

const createEntry = (
  id: string,
  name: string,
  summary: string,
  instructionMarkdown: string,
): DesignGuidanceEntrySettings => ({
  id,
  name,
  summary,
  instructionMarkdown,
});

export const NONE_DESIGN_GUIDANCE_ENTRY: DesignGuidanceEntrySettings = createEntry(
  DESIGN_GUIDANCE_NONE_ID,
  "None",
  "No additional project guidance is selected.",
  "Do not apply extra tech stack or styleguide guidance beyond the repository instructions and task prompt.",
);

const DEFAULT_STYLEGUIDES: DesignGuidanceEntrySettings[] = [
  NONE_DESIGN_GUIDANCE_ENTRY,
  createEntry(
    CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
    "Code UX",
    "A polished, product-grade interface direction for agentic developer tools.",
    [
      "Act as a senior product designer and frontend engineer for a professional developer workflow.",
      "Prioritize fast scanning, clear hierarchy, accessible controls, and confident interaction states over decorative novelty.",
      "Use visual rhythm, contrast, whitespace, and motion intentionally to make complex operational data feel calm and understandable.",
      "Choose palette, typography, iconography, and component density from the product context and existing design system instead of fixed visual recipes.",
      "Design real usable workflows first: empty, loading, error, disabled, mobile, keyboard, and long-content states should all feel deliberate.",
    ].join("\n"),
  ),
  createEntry(
    "saas-operations-dashboard",
    "SaaS Operations Dashboard",
    "Dense operational screens for repeated monitoring, triage, and action.",
    "Favor compact information architecture, predictable controls, visible status semantics, and comparison-friendly layouts. Preserve focus states, table ergonomics, and low-friction filtering for users who return daily.",
  ),
  createEntry(
    "developer-tools",
    "Developer Tools",
    "Interfaces for technical users inspecting code, logs, workflows, and automation.",
    "Make system state inspectable, command outcomes explicit, and advanced options discoverable without slowing the primary workflow. Prefer precise labels, resilient monospace treatment for technical values, and reversible actions.",
  ),
  createEntry(
    "data-analytics",
    "Data Analytics",
    "Analytical surfaces for trends, comparisons, cohorts, and decisions.",
    "Lead with trustworthy data hierarchy, chart readability, source context, and drill-down affordances. Avoid chart decoration that obscures scale, uncertainty, or relationships between measures.",
  ),
  createEntry(
    "ai-chat-workspace",
    "AI Chat Workspace",
    "Conversation-first tools with rich context, history, and generated artifacts.",
    "Balance conversational warmth with auditability. Keep user intent, tool progress, citations, attachments, and next actions easy to separate while preserving keyboard-friendly composition and transcript reading.",
  ),
  createEntry(
    "project-management",
    "Project Management",
    "Planning and execution views for tasks, ownership, timing, and dependencies.",
    "Make dependencies, priority, progress, and blocked states visible without overwhelming the board or list. Optimize for quick updates, batch scanning, and clear transitions between planning and delivery.",
  ),
  createEntry(
    "ecommerce",
    "Commerce",
    "Shopping and merchandising flows where confidence and conversion matter.",
    "Build trust through clear product evidence, transparent pricing states, frictionless comparison, and strong checkout feedback. Keep promotions subordinate to product comprehension and task completion.",
  ),
  createEntry(
    "marketing-site",
    "Marketing Site",
    "Narrative pages for positioning, proof, and conversion.",
    "Create an immediate first-viewport signal for the offer, then support it with concrete proof, crisp scannable sections, and purposeful calls to action. Avoid generic hero composition when product evidence can carry the story.",
  ),
  createEntry(
    "editor-creative-tool",
    "Editor or Creative Tool",
    "Creation surfaces with toolbars, inspectors, canvases, and asset workflows.",
    "Keep the canvas or primary work object central. Use familiar tool controls, stable dimensions, non-jarring panels, and clear selection feedback so users can stay in flow while editing.",
  ),
  createEntry(
    "mobile-first-consumer",
    "Mobile-First Consumer",
    "Consumer app flows optimized for small screens and quick decisions.",
    "Design for thumb-friendly progression, concise labels, resilient wrapping, and immediate feedback. Keep optional detail reachable without crowding the main path.",
  ),
  createEntry(
    "enterprise-admin",
    "Enterprise Admin",
    "Permissioned management tools for configuration, audit, and governance.",
    "Emphasize clarity, traceability, confirmation for risky actions, and robust form validation. Make scope, ownership, and consequences explicit before changes are saved.",
  ),
  createEntry(
    "fintech",
    "Fintech",
    "Financial workflows where trust, precision, and reviewability are critical.",
    "Surface balances, changes, assumptions, and irreversible actions with strong hierarchy and plain language. Design validation and confirmation paths that reduce ambiguity without adding unnecessary friction.",
  ),
  createEntry(
    "healthcare",
    "Healthcare",
    "Care, scheduling, records, and patient-support workflows.",
    "Use calm hierarchy, accessible language, high clarity for status and next steps, and careful error handling. Avoid visual choices that make critical information feel decorative or secondary.",
  ),
  createEntry(
    "education",
    "Education",
    "Learning experiences with lessons, practice, feedback, and progress.",
    "Guide attention through goals, examples, practice states, and reflection. Make progress understandable and feedback actionable without turning the learning path into a dashboard-only experience.",
  ),
  createEntry(
    "gaming-companion",
    "Gaming Companion",
    "Game-adjacent interfaces for stats, loadouts, matchmaking, or community.",
    "Support fast recognition, playful but legible interaction, and strong state changes. Keep competitive data, inventory, or social actions structured enough for repeated use.",
  ),
  createEntry(
    "documentation-knowledge-base",
    "Documentation and Knowledge Base",
    "Reference, learning, and support surfaces with browsable structured content.",
    "Optimize for findability, readable long-form content, stable navigation, and contextual next steps. Preserve deep links, search clarity, and examples that map directly to user tasks.",
  ),
];

const DEFAULT_TECH_STACKS: DesignGuidanceEntrySettings[] = [
  NONE_DESIGN_GUIDANCE_ENTRY,
  createEntry(
    CODE_UX_PRODUCT_TECH_STACK_ID,
    "Code UX Product Stack",
    "Preact, TypeScript, Tailwind, lightweight state, and focused runtime APIs.",
    "Prefer typed Preact components, existing dashboard primitives, Tailwind utility composition, small testable modules, and lean client bundles. Reuse local API and settings contracts instead of introducing new client-side protocol shapes.",
  ),
  createEntry(
    "react-typescript-app",
    "React TypeScript App",
    "A modern React application with typed components and route-level composition.",
    "Use TypeScript-first component boundaries, accessible form and navigation patterns, and local state only where it reduces complexity. Keep async data states explicit and avoid adding dependencies for simple UI state.",
  ),
  createEntry(
    "node-typescript-service",
    "Node TypeScript Service",
    "A backend service using TypeScript, structured modules, and deterministic tests.",
    "Keep API contracts explicit, validate inputs at boundaries, preserve transaction and logging behavior, and write focused tests around success, validation failure, and operational error paths.",
  ),
  createEntry(
    "electron-desktop-app",
    "Electron Desktop App",
    "A desktop shell with web UI, local filesystem integration, and process lifecycle concerns.",
    "Respect process boundaries, startup recovery, filesystem safety, and native-window behavior. Keep renderer UI responsive while moving privileged work through typed main-process services.",
  ),
];

export const DEFAULT_DESIGN_GUIDANCE_SETTINGS: DesignGuidanceSettings = {
  selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
  selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
  hideDefaultStyleguides: false,
  customTechStacks: [],
  customStyleguides: [],
};

export function isValidDesignGuidanceId(id: string): boolean {
  return ID_PATTERN.test(id);
}

export function getDefaultDesignGuidanceTechStacks(): DesignGuidanceEntrySettings[] {
  return DEFAULT_TECH_STACKS.map((entry) => ({ ...entry }));
}

export function getDefaultDesignGuidanceStyleguides(): DesignGuidanceEntrySettings[] {
  return DEFAULT_STYLEGUIDES.map((entry) => ({ ...entry }));
}

export function getDesignGuidanceCatalog(settings?: Pick<DesignGuidanceSettings, "customTechStacks" | "customStyleguides">): {
  techStacks: DesignGuidanceEntrySettings[];
  styleguides: DesignGuidanceEntrySettings[];
} {
  return {
    techStacks: [
      ...getDefaultDesignGuidanceTechStacks(),
      ...(settings?.customTechStacks ?? []).map((entry) => ({ ...entry })),
    ],
    styleguides: [
      ...getDefaultDesignGuidanceStyleguides(),
      ...(settings?.customStyleguides ?? []).map((entry) => ({ ...entry })),
    ],
  };
}

export function getVisibleDesignGuidanceStyleguides(settings: DesignGuidanceSettings): DesignGuidanceEntrySettings[] {
  const defaults = settings.hideDefaultStyleguides
    ? [NONE_DESIGN_GUIDANCE_ENTRY]
    : getDefaultDesignGuidanceStyleguides();
  return [
    ...defaults.map((entry) => ({ ...entry })),
    ...settings.customStyleguides.map((entry) => ({ ...entry })),
  ];
}

function sanitizeEntry(value: unknown): DesignGuidanceEntrySettings | null {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const id = typeof input.id === "string" ? input.id.trim() : "";
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const summary = typeof input.summary === "string" ? input.summary.trim() : "";
  const instructionMarkdown = typeof input.instructionMarkdown === "string"
    ? input.instructionMarkdown.trim()
    : "";

  if (!id || !name || !summary || !instructionMarkdown || !isValidDesignGuidanceId(id)) {
    return null;
  }

  return { id, name, summary, instructionMarkdown };
}

function sanitizeCustomEntries(value: unknown, reservedIds: Set<string>): DesignGuidanceEntrySettings[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: DesignGuidanceEntrySettings[] = [];
  const seen = new Set<string>(reservedIds);
  for (const entryInput of value) {
    const entry = sanitizeEntry(entryInput);
    if (!entry || seen.has(entry.id)) {
      continue;
    }
    seen.add(entry.id);
    entries.push(entry);
  }
  return entries;
}

function resolveSelectedId(value: unknown, availableIds: Set<string>): string {
  const selectedId = typeof value === "string" ? value.trim() : "";
  return selectedId && availableIds.has(selectedId) ? selectedId : DESIGN_GUIDANCE_NONE_ID;
}

export function cloneDesignGuidanceSettings(settings: DesignGuidanceSettings): DesignGuidanceSettings {
  return {
    selectedTechStackId: settings.selectedTechStackId,
    selectedStyleguideId: settings.selectedStyleguideId,
    hideDefaultStyleguides: settings.hideDefaultStyleguides,
    customTechStacks: settings.customTechStacks.map((entry) => ({ ...entry })),
    customStyleguides: settings.customStyleguides.map((entry) => ({ ...entry })),
  };
}

export function sanitizeDesignGuidanceSettings(value: unknown): DesignGuidanceSettings {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const defaultTechStackIds = new Set(DEFAULT_TECH_STACKS.map((entry) => entry.id));
  const defaultStyleguideIds = new Set(DEFAULT_STYLEGUIDES.map((entry) => entry.id));
  const customTechStacks = sanitizeCustomEntries(input.customTechStacks, defaultTechStackIds);
  const customStyleguides = sanitizeCustomEntries(input.customStyleguides, defaultStyleguideIds);
  const availableTechStackIds = new Set([
    ...defaultTechStackIds,
    ...customTechStacks.map((entry) => entry.id),
  ]);
  const availableStyleguideIds = new Set([
    ...defaultStyleguideIds,
    ...customStyleguides.map((entry) => entry.id),
  ]);

  return {
    selectedTechStackId: resolveSelectedId(input.selectedTechStackId, availableTechStackIds),
    selectedStyleguideId: resolveSelectedId(input.selectedStyleguideId, availableStyleguideIds),
    hideDefaultStyleguides: typeof input.hideDefaultStyleguides === "boolean"
      ? input.hideDefaultStyleguides
      : DEFAULT_DESIGN_GUIDANCE_SETTINGS.hideDefaultStyleguides,
    customTechStacks,
    customStyleguides,
  };
}
