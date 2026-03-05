const sanitizeSegment = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export const buildTaskRunKey = (projectId: string, sprintId: string, taskId: string): string => {
  const projectSegment = sanitizeSegment(projectId) || "project";
  const sprintSegment = sanitizeSegment(sprintId) || "0";
  const taskSegment = sanitizeSegment(taskId) || "task";
  return `${projectSegment}/s${sprintSegment}/${taskSegment}`;
};

export const buildTaskRunTag = (projectId: string, sprintId: string, taskId: string): string => {
  return `[run:${buildTaskRunKey(projectId, sprintId, taskId)}]`;
};

export const extractTaskRunKeyFromTitle = (title: string | undefined): string | null => {
  if (!title) {
    return null;
  }
  const match = title.match(/\[run:([^\]]+)\]/);
  return match ? match[1] : null;
};
