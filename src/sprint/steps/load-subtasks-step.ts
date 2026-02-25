import type { Subtask } from "../../types.js";

export const runLoadSubtasksStep = async (loader: (dir: string) => Promise<Subtask[]>, subtasksDir: string): Promise<Subtask[]> => {
  return await loader(subtasksDir);
};
