import type { JiraSettings } from "../../../contracts/app-types.js";
import { readBoolean, readString } from "../../../shared/config/value-readers.js";
import { sanitizeSettingsCredentialReference } from "./credential-reference-sanitizer.js";

export const sanitizeJira = (
  input: unknown,
  defaults: JiraSettings
): JiraSettings => {
  const jiraInput = (input && typeof input === "object" ? input : {}) as Partial<JiraSettings>;

  const host = readString(jiraInput.host, defaults.host).trim().replace(/\/+$/, "");
  const email = readString(jiraInput.email, defaults.email).trim();
  const apiToken = "";

  let autoTransitionLinkedIssuesOnImport = readBoolean(
    jiraInput.autoTransitionLinkedIssuesOnImport,
    defaults.autoTransitionLinkedIssuesOnImport,
  );
  if (
    typeof jiraInput.autoTransitionLinkedIssuesOnImport !== "boolean"
    && jiraInput.autoTransitionLinkedIssuesOnImport !== undefined
  ) {
    autoTransitionLinkedIssuesOnImport = false;
  }

  let autoCloseLinkedIssues = readBoolean(jiraInput.autoCloseLinkedIssues, defaults.autoCloseLinkedIssues);
  if (typeof jiraInput.autoCloseLinkedIssues !== "boolean" && jiraInput.autoCloseLinkedIssues !== undefined) {
    autoCloseLinkedIssues = false;
  }

  const defaultProject = readString(jiraInput.defaultProject, defaults.defaultProject).trim();

  const importTransitionNameString = readString(jiraInput.importTransitionName, defaults.importTransitionName).trim();
  const importTransitionName = importTransitionNameString === "" ? "In Work" : importTransitionNameString;

  const closeTransitionNameString = readString(jiraInput.closeTransitionName, defaults.closeTransitionName).trim();
  const closeTransitionName = closeTransitionNameString === "" ? "Done" : closeTransitionNameString;

  return {
    host,
    email,
    apiToken,
    apiTokenCredentialRef: sanitizeSettingsCredentialReference(jiraInput.apiTokenCredentialRef),
    autoTransitionLinkedIssuesOnImport,
    importTransitionName,
    autoCloseLinkedIssues,
    defaultProject,
    closeTransitionName,
  };
};
