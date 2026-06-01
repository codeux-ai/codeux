import { BRANCH_NAME_TOKENS, BRANCH_NAME_TOKEN_ALIASES, LEGACY_BRANCH_NAME_TOKENS, type BranchNameMetadata } from "../settings/branch-name-tokens.js";

/**
 * Metadata for backward compatibility.
 */
export interface SprintBranchMetadata {
  number: number;
  slug: string;
  name: string;
  createdAt: string | Date;
  tasksCount: number;
}

export const DEFAULT_SPRINT_BRANCH_SCHEME = "feature/sprint{sprint_id}-implementation";

const sanitizeBranchName = (name: string): string => {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

const formatDate = (dateInput: string | Date): string => {
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) {
    return "00-00-00";
  }
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
};

/**
 * Resolves a token (canonical or alias) to its value from metadata.
 */
const resolveTokenValue = (token: string, metadata: BranchNameMetadata | SprintBranchMetadata): string => {
  const canonical = BRANCH_NAME_TOKEN_ALIASES[token] || (BRANCH_NAME_TOKENS.includes(token as any) ? token : null);
  
  if (!canonical) {
    // Legacy fallback for tokens that might not be in the canonical list but were supported
    if (token === "date" && "createdAt" in metadata) {
      return formatDate(metadata.createdAt);
    }
    if (token === "taskCount" && "tasksCount" in metadata) {
      return String(metadata.tasksCount);
    }
    return `{${token}}`;
  }

  // Map canonical tokens to metadata fields
  if ("sprint_id" in metadata) {
    // Full metadata provided (BranchNameMetadata)
    const m = metadata as BranchNameMetadata;
    const value = m[canonical as keyof BranchNameMetadata];
    // Special handling for sprint_name to sanitize it
    if (canonical === "sprint_name") {
      return sanitizeBranchName(String(value || ""));
    }
    return String(value || "");
  } else {
    // Legacy SprintBranchMetadata provided
    const m = metadata as SprintBranchMetadata;
    switch (canonical) {
      case "sprint_id": return m.slug;
      case "sprint_number": return String(m.number);
      case "sprint_name": return sanitizeBranchName(m.name || "");
      case "sprint_key_prefix": return m.slug.split("-")[0] || "";
      case "planning_agent": return "";
      case "agent_routing": return "";
      case "worker_agent": return "";
      default: return `{${token}}`;
    }
  }
};

export const formatSprintBranch = (scheme: string | undefined, metadata: number | BranchNameMetadata | SprintBranchMetadata): string => {
  const raw = typeof scheme === "string" ? scheme.trim() : "";
  const template = raw.length > 0 ? raw : DEFAULT_SPRINT_BRANCH_SCHEME;

  if (typeof metadata === "number") {
    // Extreme legacy backward compatibility
    return template
      .replaceAll("{sprint}", String(metadata))
      .replaceAll("{n}", String(metadata))
      .replaceAll("{sprint_id}", String(metadata))
      .replaceAll("{sprint_number}", String(metadata));
  }

  return template.replace(/\{([^}]+)\}/g, (match, token) => {
    return resolveTokenValue(token, metadata);
  });
};
