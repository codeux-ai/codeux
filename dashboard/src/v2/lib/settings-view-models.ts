import type { AutomationCredentialCapability, AutomationCredentialMetadata } from "../../../../src/contracts/automation-credential-types.js";

export * from "./settings/branch-naming.js";
export * from "./settings/display-metadata.js";
export * from "./settings/design-guidance.js";
export * from "./settings/model-options.js";
export * from "./settings/model-pricing.js";
export * from "./settings/project-overrides.js";
export * from "./settings/provider-instances.js";
export * from "./settings/route-display.js";
export * from "./experience-mode.js";

/** Metadata-only options that are safe and authorized for a settings binding. */
export const getUsableCredentialOptions = (
  credentials: AutomationCredentialMetadata[],
  capability: AutomationCredentialCapability,
): AutomationCredentialMetadata[] => credentials.filter((credential) => (
  credential.configured
  && credential.status === "active"
  && credential.capabilities.includes(capability)
));
