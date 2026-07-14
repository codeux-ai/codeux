// @vitest-environment jsdom
import { cleanup,render as testingLibraryRender,screen,waitFor } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { AutomationCredentialManager } from "../AutomationCredentialManager.js";
import { fetchAutomationCredentials,fetchCredentialHealth } from "../../../lib/automation-credential-api.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

const render = (children: ComponentChildren, locale: DashboardLocale = "en") => testingLibraryRender(
  <DashboardI18nProvider initialLocale={locale} storage={null}>{children}</DashboardI18nProvider>,
);

vi.mock("../../../lib/automation-credential-api.js",()=>({
  fetchAutomationCredentials:vi.fn(), fetchCredentialHealth:vi.fn(), createAutomationCredential:vi.fn(),
  testAutomationCredential:vi.fn(), revokeAutomationCredential:vi.fn(),
}));

describe("AutomationCredentialManager",()=>{
  afterEach(cleanup);
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(fetchAutomationCredentials).mockResolvedValue([{id:"credential-1",name:"Deployment token",kind:"api-token",scope:"project",projectId:"project-1",managementProjectId:"project-1",allowedProjectIds:[],capabilities:["read"],status:"active",configured:true,keyId:"root",keyVersion:1,version:1,lastValidatedAt:null,validationStatus:"untested",createdAt:"now",updatedAt:"now"}]);vi.mocked(fetchCredentialHealth).mockResolvedValue({available:false,secure:false,provider:"electron-safe-storage",keyId:null,keyVersion:null,reason:"OS secure storage is unavailable."});});
  it("renders metadata and disables secret writes when secure storage is unavailable",async()=>{render(<AutomationCredentialManager projectId="project-1"/>);expect(await screen.findByText("Deployment token")).toBeTruthy();expect(screen.getByRole("alert").textContent).toContain("OS secure storage is unavailable.");await waitFor(()=>expect((screen.getByRole("button",{name:"Store credential"}) as HTMLButtonElement).disabled).toBe(true));expect(document.body.textContent).not.toContain("plain-secret");});
  it("localizes German controls while preserving the secure-storage diagnostic verbatim",async()=>{render(<AutomationCredentialManager projectId="project-1"/>,"de");expect(await screen.findByText("Deployment token")).toBeTruthy();expect(screen.getByRole("heading",{name:"Automatisierungs-Anmeldedaten"})).toBeTruthy();expect(screen.getByRole("alert").textContent).toContain("OS secure storage is unavailable.");expect((screen.getByRole("button",{name:"Anmeldedaten speichern"}) as HTMLButtonElement).disabled).toBe(true);});
});
