import { describe, expect, it } from "vitest";
import {
  formatTaskSprintDateRange,
  formatTaskTimeState,
} from "../../../../../dashboard/src/v2/lib/tasks/task-presentation.js";

describe("task presentation", () => {
  it("localizes dashboard-derived task-time states in German", () => {
    expect(formatTaskTimeState("Done", "de")).toBe("Erledigt");
    expect(formatTaskTimeState("Review", "de")).toBe("Prüfung");
    expect(formatTaskTimeState("Active", "de")).toBe("Aktiv");
    expect(formatTaskTimeState("--", "de")).toBe("Nicht gestartet");
    expect(formatTaskTimeState("...", "de")).toBe("Wird gespeichert");
  });

  it("preserves arbitrary runtime and API values verbatim", () => {
    expect(formatTaskTimeState("Provider phase: Active", "de")).toBe("Provider phase: Active");
    expect(formatTaskTimeState("2h 07m", "de")).toBe("2h 07m");
    expect(formatTaskTimeState("--", "en")).toBe("--");
    expect(formatTaskTimeState("...", "en")).toBe("...");
  });

  it("formats raw sprint dates in German with a localized undated fallback", () => {
    expect(formatTaskSprintDateRange("2026-07-14", "2026-07-20", "de")).toBe("14. Juli – 20. Juli");
    expect(formatTaskSprintDateRange("not-a-date", null, "de")).toBe("Zeitraum offen");
    expect(formatTaskSprintDateRange(null, null, "de")).toBe("Zeitraum offen");
  });
});
