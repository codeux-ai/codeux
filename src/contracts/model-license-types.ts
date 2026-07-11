export interface DownloadableModelLicense {
  /** Stable acceptance identifier. Change this whenever the offered terms change. */
  id: string;
  name: string;
  url: string;
  commercialUseAllowed: boolean;
  notice: string;
}

export interface ModelDownloadAcceptance {
  acceptedLicenseId: string;
}
