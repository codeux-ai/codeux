import type {
  SkillToggle,
  TechstackCatalogEntrySettings,
  TechstackCatalogSettings,
} from "../../contracts/app-types.js";

export const INTERNAL_SKILL_NAMES = [
  "git_manager",
  "git_manager_remote",
  "git_manager_local",
] as const;

export const DEFAULT_SKILLS: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
  name,
  enabled: name !== "git_manager_local",
  isInternal: true,
}));

export const BUILTIN_CODE_UX_TECHSTACK_ID = "code-ux-internal";

export const BUILTIN_CODE_UX_TECHSTACK: TechstackCatalogEntrySettings = {
  id: BUILTIN_CODE_UX_TECHSTACK_ID,
  label: "Code UX Stack",
  items: [
    { id: "preact", label: "Preact" },
    { id: "tanstack-router", label: "TanStack Router" },
    { id: "gsap", label: "GSAP" },
    { id: "three-js", label: "Three.js" },
    { id: "lucide-icons", label: "Lucide Icons" },
  ],
};

export const DEFAULT_TECHSTACK_CATALOG: TechstackCatalogSettings = {
  defaultTechstackId: BUILTIN_CODE_UX_TECHSTACK_ID,
  entries: [{
    ...BUILTIN_CODE_UX_TECHSTACK,
    items: BUILTIN_CODE_UX_TECHSTACK.items.map((item) => ({ ...item })),
  }],
};
