import * as fs from "fs/promises";

export const runPlanningPreflightStep = async (subtasksDir: string): Promise<boolean> => {
  try {
    await fs.access(subtasksDir);
    const files = await fs.readdir(subtasksDir);
    return files.some((file) => file.endsWith(".md"));
  } catch {
    return false;
  }
};
