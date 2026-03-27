import type { SprintCollectionResponse } from "../types.js";
import type { Sprint } from "../types.js";
import { areSprintListsEqual } from "../hooks/project-resource-utils.js";
import { toSprintViewModel } from "./view-models.js";

export const areSprintCollectionsEqual = (
  prev: SprintCollectionResponse,
  next: SprintCollectionResponse
): boolean => {
  if (prev.selectedSprintId !== next.selectedSprintId) {
    return false;
  }

  const prevSprints = prev.sprints.map(toSprintViewModel);
  const nextSprints = next.sprints.map(toSprintViewModel);

  return areSprintListsEqual(prevSprints, nextSprints);
};

export const resolveSelectedSprint = (sprints: Sprint[], selectedSprintId: string | null): Sprint | null => {
  if (!selectedSprintId) {
    return null;
  }
  return sprints.find(s => s.id === selectedSprintId) || null;
};

export function isSprintScopeEqual(
  currentProjectId: string | null,
  currentSprintId: string | undefined | null,
  nextProjectId: string | null,
  nextSprintId: string | undefined | null
): boolean {
  return currentProjectId === nextProjectId && currentSprintId === nextSprintId;
}
