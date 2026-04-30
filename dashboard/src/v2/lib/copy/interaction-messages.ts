/**
 * Shared interaction messages for user feedback regions.
 * Standardizes the tone and copy for success, pending, and error states.
 */

export const InteractionMessages = {
  // Tasks
  taskSubmitted: "Task submitted successfully.",
  taskSubmitPending: "Submitting task...",
  taskSubmitError: (msg: string) => `Failed to submit task: ${msg}`,

  // Sprints
  sprintSubmitted: "Sprint configured successfully.",
  sprintSubmitPending: "Configuring sprint...",
  sprintSubmitError: (msg: string) => `Failed to configure sprint: ${msg}`,
  sprintImprovePending: "Improving sprint prompt...",
  sprintImproveError: (msg: string) => `Failed to improve prompt: ${msg}`,

  // Scripts / Browser
  scriptLoaded: "Script loaded successfully.",
  scriptLoadPending: "Loading script...",
  scriptLoadError: (msg: string) => `Failed to load script: ${msg}`,

  scriptSaved: "Script saved successfully.",
  scriptSavePending: "Saving script...",
  scriptSaveError: (msg: string) => `Failed to save script: ${msg}`,

  containerLaunched: "Container launched successfully.",
  containerLaunchPending: "Launching container...",
  containerLaunchError: (msg: string) => `Failed to launch container: ${msg}`,

  containerRebuilt: "Container rebuilt successfully.",
  containerRebuildPending: "Rebuilding container...",
  containerRebuildError: (msg: string) => `Failed to rebuild container: ${msg}`,

  containerStopped: "Container stopped successfully.",
  containerStopPending: "Stopping container...",
  containerStopError: (msg: string) => `Failed to stop container: ${msg}`,

  browserPreviewDisabled: "Browser Preview is disabled for this project.",

  // Chat/Threads
  routeUpdated: "Route updated successfully.",
  routeUpdateError: (msg: string) => `Failed to update route: ${msg}`,

  threadCompacted: "Thread compacted successfully.",
  threadCompactError: (msg: string) => `Failed to compact thread: ${msg}`,

  threadDeleted: "Thread deleted successfully.",
  threadDeleteError: (msg: string) => `Failed to delete thread: ${msg}`,

  // Actions
  actionPending: "Executing action...",
  actionSuccess: "Action executed successfully.",
  actionError: (msg: string) => `Action failed: ${msg}`,

  // Rerun
  rerunPending: "Requesting task rerun...",
  rerunSuccess: "Task rerun dispatched successfully.",
  rerunError: (msg: string) => `Failed to request rerun: ${msg}`,

  // Generic
  genericProcessing: "Processing...",
  genericError: (msg: string) => `An error occurred: ${msg}`,
  fetchError: (msg: string) => `Failed to fetch data: ${msg}`,
};

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
