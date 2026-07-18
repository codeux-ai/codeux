import { describe, expect, it } from "vitest";
import {
  projectJulesActivityForLiveView,
  projectJulesSessionForOrchestration,
} from "../../../../src/domain/jules/jules-live-projection.js";
import type { JulesActivity, JulesSession } from "../../../../src/contracts/app-types.js";

describe("Jules live projections", () => {
  it("discards large artifacts and bounds every live activity text field", () => {
    const huge = `HEAD${"x".repeat(128 * 1024)}TAIL`;
    const activity: JulesActivity = {
      id: "activity-1",
      name: "sessions/1/activities/1",
      createTime: "2026-07-18T00:00:00.000Z",
      description: huge,
      agentMessaged: { agentMessage: huge },
      planGenerated: {
        plan: {
          steps: Array.from({ length: 100 }, (_, index) => ({
            title: `step-${index}-${huge}`,
            description: huge,
          })),
        },
      },
      artifacts: [
        { media: { data: "a".repeat(2 * 1024 * 1024), mimeType: "image/png" } },
        { changeSet: { gitPatch: { unidiffPatch: huge } } },
      ],
    };

    const projected = projectJulesActivityForLiveView(activity);

    expect(projected.artifacts).toBeUndefined();
    expect(projected.description).toHaveLength(8 * 1024);
    expect(projected.description).toContain("HEAD");
    expect(projected.description).toContain("TAIL");
    expect(projected.agentMessaged?.agentMessage).toHaveLength(8 * 1024);
    expect(projected.planGenerated?.plan?.steps).toHaveLength(20);
    expect(projected.planGenerated?.plan?.steps?.[0]?.description).toHaveLength(1_024);
    expect(JSON.stringify(projected).length).toBeLessThan(64 * 1024);
  });

  it("retains only bounded orchestration fields from large session responses", () => {
    const huge = "x".repeat(512 * 1024);
    const session = {
      id: "session-1",
      name: "sessions/session-1",
      title: huge,
      prompt: huge,
      state: "IN_PROGRESS",
      updateTime: "2026-07-18T00:00:00.000Z",
      outputs: Array.from({ length: 20 }, (_, index) => ({
        pullRequest: {
          url: `https://example.test/${index}`,
          workerBranch: `worker-${index}`,
          filesChanged: index,
          providerOwnedPayload: huge,
        },
      })),
      providerOwnedPayload: huge,
    } as JulesSession & { providerOwnedPayload: string };

    const projected = projectJulesSessionForOrchestration(session);

    expect(projected.title).toHaveLength(16 * 1024);
    expect(projected.prompt).toHaveLength(128 * 1024);
    expect(projected.outputs).toHaveLength(8);
    expect(projected.outputs?.[0]?.pullRequest).toEqual({
      url: "https://example.test/0",
      workerBranch: "worker-0",
      filesChanged: 0,
    });
    expect("providerOwnedPayload" in projected).toBe(false);
    expect(JSON.stringify(projected).length).toBeLessThan(192 * 1024);
  });
});
