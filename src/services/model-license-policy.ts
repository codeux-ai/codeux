import type { DownloadableModelLicense } from "../contracts/model-license-types.js";

export function assertCatalogLicenseApproved(license: DownloadableModelLicense, modelId: string): void {
  if (!license.id.trim() || !license.name.trim() || !license.url.startsWith("https://")) {
    throw new Error(`Model "${modelId}" has incomplete license metadata.`);
  }
  if (!license.commercialUseAllowed) {
    throw new Error(`Model "${modelId}" is not approved for the built-in catalog because its terms do not permit commercial use.`);
  }
}

export function assertModelLicenseAccepted(
  license: DownloadableModelLicense,
  modelId: string,
  acceptedLicenseId: string | undefined,
): void {
  assertCatalogLicenseApproved(license, modelId);
  if (acceptedLicenseId !== license.id) {
    throw new Error(`Accept the ${license.name} terms before downloading "${modelId}".`);
  }
}
