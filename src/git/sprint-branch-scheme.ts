export interface SprintBranchMetadata {
  number: number;
  slug: string;
  name: string;
  createdAt: string | Date;
  tasksCount: number;
}

export const DEFAULT_SPRINT_BRANCH_SCHEME = "feature/sprint{sprint}-implementation";

const sanitizeBranchName = (name: string): string => {
  return name
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

export const formatSprintBranch = (scheme: string | undefined, sprint: number | SprintBranchMetadata): string => {
  const raw = typeof scheme === "string" ? scheme.trim() : "";
  const template = raw.length > 0 ? raw : DEFAULT_SPRINT_BRANCH_SCHEME;

  if (typeof sprint === "number") {
    return template
      .replaceAll("{sprint}", String(sprint))
      .replaceAll("{n}", String(sprint));
  }

  const { number, slug, name, createdAt, tasksCount } = sprint;

  return template
    .replaceAll("{sprint}", slug)
    .replaceAll("{n}", String(number))
    .replaceAll("{sprintNumber}", String(number))
    .replaceAll("{sprintName}", sanitizeBranchName(name))
    .replaceAll("{date}", formatDate(createdAt))
    .replaceAll("{taskCount}", String(tasksCount));
};
