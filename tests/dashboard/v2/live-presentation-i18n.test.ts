import { describe, expect, it } from "vitest";

import { getBoatRaceCheckpoints } from "../../../dashboard/src/v2/lib/boat-race.js";
import { formatDuration, formatDurationTight } from "../../../dashboard/src/v2/lib/format-duration.js";
import { getOriginatorCfg, getTaskCfg } from "../../../dashboard/src/v2/lib/live-session-config.js";
import { buildSprintDagModel } from "../../../dashboard/src/v2/lib/sprint-dag.js";
import type { Subtask } from "../../../dashboard/src/types.js";

describe("Live pure presentation localization", () => {
  it("localizes German duration, stage, and originator labels", () => {
    expect(formatDuration(3_661, "de")).toBe("1 Std. 1 Min. 1 Sek.");
    expect(formatDurationTight(3_661, "de")).toBe("1 Std. 1 Min.");
    expect(getTaskCfg("RUNNING", "de").label).toBe("Laufend");
    expect(getOriginatorCfg("provider", "de").label).toBe("Anbieter");
    expect(getBoatRaceCheckpoints("de").map((checkpoint) => checkpoint.label)).toEqual([
      "CODIERUNG",
      "CODE FERTIG",
      "CI",
      "QA",
      "ZUSAMMENFÜHRUNG",
      "ABGESCHLOSSEN",
    ]);
  });

  it("localizes DAG fallbacks without changing task-authored names or prompts", () => {
    const dependency: Subtask = {
      id: "T-0",
      title: "KEEP dependency title verbatim",
      prompt: "",
      status: "COMPLETED",
      depends_on: [],
      is_independent: true,
    };
    const task: Subtask = {
      id: "T-1",
      title: "KEEP task title verbatim",
      prompt: "KEEP task prompt verbatim",
      status: "PENDING",
      depends_on: ["T-0"],
      is_independent: false,
    };

    const model = buildSprintDagModel([dependency, task], "de");
    const taskNode = model.nodes.find((node) => node.task.id === "T-1");
    const dependencyNode = model.nodes.find((node) => node.task.id === "T-0");

    expect(taskNode?.task.title).toBe("KEEP task title verbatim");
    expect(taskNode?.hover.prompt).toBe("KEEP task prompt verbatim");
    expect(taskNode?.hover.dependencies[0]?.title).toBe("KEEP dependency title verbatim");
    expect(dependencyNode?.hover.prompt).toBe("Kein Prompt angegeben");
  });
});
