import { describe, expect, it, vi } from "vitest";
import type {
  CustomDashboardCredentialBinding,
  CustomDashboardCredentialSlot,
  CustomDashboardRevisionRecord,
} from "../../../src/contracts/custom-dashboard-types.js";
import type { CustomDashboardRepository } from "../../../src/repositories/custom-dashboard-repository.js";
import type { CredentialBroker } from "../../../src/services/credentials/credential-broker.js";
import type { EgressPolicyService } from "../../../src/services/node-flows/egress-policy-service.js";
import {
  CustomDashboardRuntimeError,
  CustomDashboardRuntimeService,
} from "../../../src/services/custom-dashboard-runtime-service.js";

const PROJECT_ID = "project-1";
const DASHBOARD_ID = "dashboard-1";
const REVISION_ID = "revision-1";

function slot(slotId: string, required: boolean): CustomDashboardCredentialSlot {
  return {
    slot: slotId,
    label: slotId,
    required,
    allowedKinds: ["api-token"],
    requiredCapability: "read",
    metadata: { headerName: "authorization", scheme: "Bearer" },
  };
}

function binding(slotId: string, credentialId: string): CustomDashboardCredentialBinding {
  return {
    slot: slotId,
    credentialId,
    capability: "read",
    bindingKey: `custom-dashboard:${DASHBOARD_ID}:${slotId}`,
    credential: {
      id: credentialId,
      name: `${slotId} credential`,
      kind: "api-token",
      scope: "project",
      capabilities: ["read"],
      status: "active",
      configured: true,
    },
  };
}

function createFixture(options: {
  slots: CustomDashboardCredentialSlot[];
  bindings?: CustomDashboardCredentialBinding[];
}): {
  service: CustomDashboardRuntimeService;
  credentialBroker: { withResolvedCredentialId: ReturnType<typeof vi.fn> };
  egressPolicyService: { request: ReturnType<typeof vi.fn> };
} {
  const revision = {
    id: REVISION_ID,
    dashboardId: DASHBOARD_ID,
    projectId: PROJECT_ID,
    validationStatus: "passed",
    validationReport: { valid: true, summary: "Passed", issues: [] },
    sourceNodeGraph: {
      nodes: [{
        id: "external",
        type: "external_api",
        title: "External",
        config: {
          baseUrl: "https://api.example.com/v1/",
          allowedHosts: ["api.example.com"],
          routes: [{ path: "/data", methods: ["GET"] }],
        },
        credentialSlots: options.slots,
      }],
      edges: [],
    },
    credentialBindings: options.bindings ?? [],
  } as unknown as CustomDashboardRevisionRecord;
  const repository = {
    getDashboardById: vi.fn(() => ({
      id: DASHBOARD_ID,
      projectId: PROJECT_ID,
      status: "published",
      publishedRevisionId: REVISION_ID,
      runtimeState: { status: "active" },
    })),
    getRevisionById: vi.fn(() => revision),
  } as unknown as CustomDashboardRepository;
  const credentialBroker = {
    withResolvedCredentialId: vi.fn(async (
      request: { credentialId: string },
      consumer: (secret: Buffer) => unknown,
    ) => consumer(Buffer.from(`secret-for-${request.credentialId}`))),
  };
  const egressPolicyService = {
    request: vi.fn(async () => ({
      status: 200,
      ok: true,
      headers: { "content-type": "application/json" },
      contentType: "application/json",
      body: new TextEncoder().encode("{}"),
      text: () => "{}",
      json: () => ({}),
    })),
  };
  return {
    service: new CustomDashboardRuntimeService({
      customDashboardRepository: repository,
      credentialBroker: credentialBroker as unknown as CredentialBroker,
      egressPolicyService: egressPolicyService as unknown as EgressPolicyService,
      getProjectExecutionSnapshot: () => ({}),
      getProjectStatsSnapshot: () => ({}),
      getOverviewTelemetrySnapshot: () => ({}),
    }),
    credentialBroker,
    egressPolicyService,
  };
}

function requestInput(credentialSlot?: string) {
  return {
    projectId: PROJECT_ID,
    dashboardId: DASHBOARD_ID,
    revisionId: REVISION_ID,
    access: { kind: "published" as const },
    sourceId: "external",
    route: "/data",
    ...(credentialSlot === undefined ? {} : { credentialSlot }),
  };
}

describe("CustomDashboardRuntimeService credential selection", () => {
  it("requires an explicit declared slot when multiple required slots are available", async () => {
    const first = binding("primary", "credential-primary");
    const second = binding("secondary", "credential-secondary");
    const { service, credentialBroker, egressPolicyService } = createFixture({
      slots: [slot("primary", true), slot("secondary", true)],
      bindings: [first, second],
    });

    await expect(service.requestSource("missing-slot", requestInput())).rejects.toMatchObject({
      statusCode: 403,
      code: "credential_slot_required",
    } satisfies Partial<CustomDashboardRuntimeError>);
    await expect(service.requestSource("unknown-slot", requestInput("unknown"))).rejects.toMatchObject({
      statusCode: 403,
      code: "credential_slot_denied",
    } satisfies Partial<CustomDashboardRuntimeError>);
    expect(credentialBroker.withResolvedCredentialId).not.toHaveBeenCalled();
    expect(egressPolicyService.request).not.toHaveBeenCalled();

    await service.requestSource("selected-slot", requestInput("secondary"));

    expect(credentialBroker.withResolvedCredentialId).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: "credential-secondary",
        bindingKey: second.bindingKey,
        capability: "read",
      }),
      expect.any(Function),
    );
    expect(egressPolicyService.request).toHaveBeenCalledWith(expect.objectContaining({
      credentialHeaders: { authorization: "Bearer secret-for-credential-secondary" },
    }));
  });

  it("keeps a multi-slot optional source unauthenticated when no slot is requested", async () => {
    const { service, credentialBroker, egressPolicyService } = createFixture({
      slots: [slot("primary", false), slot("secondary", false)],
    });

    await service.requestSource("optional-source", requestInput());

    expect(credentialBroker.withResolvedCredentialId).not.toHaveBeenCalled();
    expect(egressPolicyService.request).toHaveBeenCalledWith(expect.objectContaining({
      credentialHeaders: undefined,
    }));
  });

  it("rejects unavailable binding metadata before external egress", async () => {
    const unavailable = binding("required", "credential-required");
    unavailable.credential.status = "revoked";
    const { service, credentialBroker, egressPolicyService } = createFixture({
      slots: [slot("required", true)],
      bindings: [unavailable],
    });

    await expect(service.requestSource("revoked", requestInput())).rejects.toMatchObject({
      statusCode: 403,
      code: "credential_denied",
    } satisfies Partial<CustomDashboardRuntimeError>);
    expect(credentialBroker.withResolvedCredentialId).not.toHaveBeenCalled();
    expect(egressPolicyService.request).not.toHaveBeenCalled();
  });
});
