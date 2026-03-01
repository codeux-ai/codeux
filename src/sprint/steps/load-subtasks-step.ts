import type { Subtask } from "../../contracts/app-types.js";

export const runLoadSubtasksStep = async (loader: (dir: string) => Promise<Subtask[]>, subtasksDir: string): Promise<Subtask[]> => {
  return await loader(subtasksDir);
};
