import type { HeadlessOperationalReadiness } from "../contracts/headless-security-types.js";
import type { AutomationCredentialRepository } from "../repositories/automation-credential-repository.js";
import type { AutomationAuditExportService } from "./automation-audit-export-service.js";
import type { KeyProvider } from "./credentials/key-provider.js";
import type { HeadlessSecurityConfiguration } from "../contracts/headless-security-types.js";

export class HeadlessOperationalReadinessService {
  private current: HeadlessOperationalReadiness = {
    status: "NOT_READY",
    checkedAt: new Date(0).toISOString(),
    components: {
      credentialKey: { status: "not_ready", reason: "Credential key readiness has not been checked." },
      auditStore: { status: "not_ready", reason: "Audit store readiness has not been checked." },
      distributedRunner: { status: "not_ready", reason: "Runner identity readiness has not been checked." },
    },
  };

  constructor(private readonly dependencies: {
    credentialRepository: AutomationCredentialRepository;
    keyProvider: KeyProvider;
    auditService: AutomationAuditExportService;
    security: HeadlessSecurityConfiguration;
  }) {}

  snapshot(): HeadlessOperationalReadiness {
    return structuredClone(this.current);
  }

  async refresh(): Promise<HeadlessOperationalReadiness> {
    const encryptedSecretCount = this.dependencies.credentialRepository.countEncryptedSecrets();
    const keyRequired = encryptedSecretCount > 0 || this.dependencies.security.remoteCredentialManagement;
    const credentialKey = keyRequired
      ? await this.checkRequiredCredentialKey()
      : { status: "not_required" as const, provider: this.dependencies.keyProvider.providerName };
    const auditStore = this.dependencies.auditService.health()
      ? { status: "ready" as const }
      : { status: "not_ready" as const, reason: "The durable audit store is unavailable." };
    const distributedRunner = this.dependencies.security.mode === "local"
      ? { status: "not_required" as const }
      : this.dependencies.security.serviceIdentities.some((identity) =>
          identity.enabled && identity.roles.includes("automation_runner") && identity.projectIds.length > 0
        )
        ? { status: "ready" as const }
        : { status: "not_ready" as const, reason: "No enabled, project-scoped service identity is configured." };
    const ready = credentialKey.status !== "not_ready"
      && auditStore.status !== "not_ready"
      && distributedRunner.status !== "not_ready";
    this.current = {
      status: ready ? "READY" : "NOT_READY",
      checkedAt: new Date().toISOString(),
      components: { credentialKey, auditStore, distributedRunner },
    };
    return this.snapshot();
  }

  private async checkRequiredCredentialKey(): Promise<HeadlessOperationalReadiness["components"]["credentialKey"]> {
    const keyHealth = await this.dependencies.keyProvider.health();
    return keyHealth.available && keyHealth.secure
      ? { status: "ready", provider: keyHealth.provider }
      : {
          status: "not_ready",
          provider: keyHealth.provider,
          reason: keyHealth.reason ?? "The configured credential key provider is unavailable.",
        };
  }

  async assertStartupReady(): Promise<void> {
    const status = await this.refresh();
    const encryptedSecretCount = this.dependencies.credentialRepository.countEncryptedSecrets();
    if (encryptedSecretCount > 0 && status.components.credentialKey.status !== "ready") {
      throw new Error(`Encrypted credential data exists but key recovery is unavailable: ${status.components.credentialKey.reason ?? "unknown reason"}`);
    }
  }
}
