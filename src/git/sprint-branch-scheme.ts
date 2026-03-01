export const DEFAULT_SPRINT_BRANCH_SCHEME = "feature/sprint{sprint}-implementation";

export const formatSprintBranch = (scheme: string | undefined, sprintNumber: number): string => {
  const raw = typeof scheme === "string" ? scheme.trim() : "";
  const template = raw.length > 0 ? raw : DEFAULT_SPRINT_BRANCH_SCHEME;
  return template
    .replaceAll("{sprint}", String(sprintNumber))
    .replaceAll("{n}", String(sprintNumber));
};
