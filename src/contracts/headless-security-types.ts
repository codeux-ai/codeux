export const CODE_UX_ROLES = [
  "credential_admin",
  "automation_author",
  "automation_publisher",
  "automation_runner",
  "viewer",
] as const;

export type CodeUxRole = typeof CODE_UX_ROLES[number];
export type PrincipalKind = "user" | "service" | "local_desktop";

export interface CodeUxPrincipal {
  id: string;
  displayName: string;
  kind: PrincipalKind;
  roles: CodeUxRole[];
  /** An empty array means the principal has no project access. */
  projectIds: string[];
  authenticatedAt: string;
  authenticationMethod: "local" | "trusted_proxy" | "service_token";
}

export interface RunnerServiceIdentity {
  id: string;
  displayName: string;
  tokenSha256: string;
  roles: CodeUxRole[];
  projectIds: string[];
  enabled: boolean;
}

export type HeadlessAuthMode = "local" | "trusted_proxy" | "service_token";

export interface HeadlessSecurityConfiguration {
  mode: HeadlessAuthMode;
  trustedProxySecret?: string;
  serviceIdentities: RunnerServiceIdentity[];
  allowInsecureHttp: boolean;
  remoteCredentialManagement: boolean;
}

export type AuditOutcome = "succeeded" | "denied" | "failed";

export interface AutomationAuditRecord {
  id: string;
  occurredAt: string;
  correlationId: string;
  principalId: string;
  principalKind: PrincipalKind;
  action: string;
  resourceType: string;
  resourceId: string | null;
  projectId: string | null;
  outcome: AuditOutcome;
  metadata: Record<string, unknown>;
}

export type OperationalReadinessComponentStatus = "ready" | "not_ready" | "not_required";

export interface OperationalReadinessComponent {
  status: OperationalReadinessComponentStatus;
  reason?: string;
  provider?: string;
}

export interface HeadlessOperationalReadiness {
  status: "READY" | "NOT_READY";
  checkedAt: string;
  components: {
    credentialKey: OperationalReadinessComponent;
    auditStore: OperationalReadinessComponent;
    distributedRunner: OperationalReadinessComponent;
  };
}

export interface AutomationSloSnapshot {
  windowStartedAt: string;
  sampledAt: string;
  managementRequestCount: number;
  managementErrorRate: number;
  managementLatencyP95Ms: number;
  runAttemptCount: number;
  outboxDeliveryErrorRate: number;
}
