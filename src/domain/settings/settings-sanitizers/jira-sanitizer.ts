import type { JiraSettings } from "../../../contracts/app-types.js";
import { readBoolean, readString } from "../../../shared/config/value-readers.js";

export const sanitizeJira = (
  input: unknown,
  defaults: JiraSettings
): JiraSettings => {
  const jiraInput = (input && typeof input === "object" ? input : {}) as Partial<JiraSettings>;

  const host = readString(jiraInput.host, defaults.host).trim().replace(/\/+$/, "");
  const email = readString(jiraInput.email, defaults.email).trim();
  const apiToken = readString(jiraInput.apiToken, defaults.apiToken).trim();

  let autoCloseLinkedIssues = readBoolean(jiraInput.autoCloseLinkedIssues, defaults.autoCloseLinkedIssues);
  if (typeof jiraInput.autoCloseLinkedIssues !== "boolean" && jiraInput.autoCloseLinkedIssues !== undefined) {
    autoCloseLinkedIssues = false;
  }

  const defaultProject = readString(jiraInput.defaultProject, defaults.defaultProject).trim();

  const closeTransitionNameString = readString(jiraInput.closeTransitionName, defaults.closeTransitionName).trim();
  const closeTransitionName = closeTransitionNameString === "" ? "Done" : closeTransitionNameString;

  return {
    host,
    email,
    apiToken,
    autoCloseLinkedIssues,
    defaultProject,
    closeTransitionName,
  };
};
