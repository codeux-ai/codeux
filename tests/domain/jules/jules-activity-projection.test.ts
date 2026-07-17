import { describe, expect, it } from "vitest";
import type { JulesActivity } from "../../../src/contracts/app-types.js";
import {
  JulesUsageConversationProjector,
} from "../../../src/domain/jules/jules-activity-projection.js";
import {
  estimateJulesUsage,
} from "../../../src/domain/jules/jules-usage-estimator.js";

function activity(
  id: string,
  patch: string,
  extra: Partial<JulesActivity> = {},
): JulesActivity {
  return {
    id,
    name: id,
    createTime: `2026-07-17T00:00:${id.padStart(2, "0")}Z`,
    originator: "agent",
    progressUpdated: { title: `Tool ${id}`, description: `Progress ${id}` },
    artifacts: [{
      changeSet: {
        source: "sources/repository",
        gitPatch: { unidiffPatch: patch },
      },
    }],
    ...extra,
  };
}

describe("JulesUsageConversationProjector", () => {
  it("keeps every activity but only the newest cumulative patch snapshot", () => {
    const projector = new JulesUsageConversationProjector();
    projector.addPage([
      activity("1", "+first"),
      activity("2", "+first"),
      activity("3", "+final"),
    ]);

    const result = projector.finish();

    expect(result.activities).toHaveLength(3);
    expect(result.activities.map((entry) => entry.progressUpdated?.title)).toEqual([
      "Tool 1",
      "Tool 2",
      "Tool 3",
    ]);
    const patches = result.activities.flatMap((entry) =>
      (entry.artifacts || [])
        .map((artifact) => artifact.changeSet?.gitPatch?.unidiffPatch)
        .filter((patch): patch is string => typeof patch === "string"),
    );
    expect(patches).toEqual(["+final"]);
    expect(result.diagnostics).toMatchObject({
      activitiesSeen: 3,
      activitiesRetained: 3,
      changeSetSnapshotsSeen: 3,
      changeSetSnapshotsRetained: 1,
      duplicateChangeSetSnapshots: 1,
      supersededChangeSetSnapshots: 1,
    });
  });

  it("preserves each discarded patch event as bounded context and tool metadata", () => {
    const projector = new JulesUsageConversationProjector();
    projector.addPage([
      activity("1", "a".repeat(400), { progressUpdated: undefined }),
      activity("2", "b".repeat(800), { progressUpdated: undefined }),
      activity("3", "c".repeat(1_200), { progressUpdated: undefined }),
    ]);

    const result = projector.finish();
    const estimate = estimateJulesUsage({
      prompt: "",
      activities: result.activities,
      countTokens: (text) => text.length,
    });

    expect(result.activities.map((entry) =>
      entry.codeUxUsageProjection?.patchSnapshots?.[0]?.patchChars,
    )).toEqual([400, 800, 1_200]);
    expect(result.activities.flatMap((entry) => entry.artifacts || [])).toHaveLength(1);
    expect(estimate.toolCallCount).toBe(3);
  });

  it("retains bash semantics and media presence without encoded media or unknown fields", () => {
    const projector = new JulesUsageConversationProjector();
    projector.addPage([{
      id: "1",
      name: "1",
      createTime: "2026-07-17T00:00:00Z",
      originator: "agent",
      unknownProviderPayload: "do not retain",
      artifacts: [
        {
          bashOutput: {
            command: "pnpm test",
            output: "passed",
            exitCode: 0,
            internalMetadata: "drop",
          },
        },
        {
          media: {
            data: "base64-data-that-must-not-be-retained",
            mimeType: "image/png",
            storageMetadata: "drop",
          },
        },
      ],
    }]);

    const result = projector.finish();
    const projected = result.activities[0]!;

    expect(projected).not.toHaveProperty("unknownProviderPayload");
    expect(projected.artifacts?.[0]).toEqual({
      bashOutput: {
        command: "pnpm test",
        output: "passed",
        exitCode: 0,
      },
    });
    expect(projected.artifacts?.[1]).toEqual({
      media: {
        data: "present",
        mimeType: "image/png",
      },
    });
    expect(result.diagnostics.mediaPayloadCharsDiscarded).toBe(
      "base64-data-that-must-not-be-retained".length,
    );
  });
});
