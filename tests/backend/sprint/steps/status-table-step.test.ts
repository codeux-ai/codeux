import { describe, expect, it } from "vitest";
import { runStatusTableStep } from "../../../../src/sprint/steps/status-table-step.js";
import type { Subtask } from "../../../../src/contracts/app-types.js";

describe("runStatusTableStep", () => {
  it("formats task status correctly with all states", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "T1", title: "Task 1", status: "PENDING" },
      { id: "T2", title: "Task 2", status: "RUNNING", provider: "jules" },
      { id: "T3", title: "Task 3", status: "COMPLETED" },
      { id: "T4", title: "Task 4", status: "CODING_COMPLETED", is_merged: false },
      { id: "T5", title: "Task 5", status: "CODING_COMPLETED", is_merged: true },
      { id: "T6", title: "Task 6", status: "CODING_COMPLETED", merge_indicator: "MERGED" },
      { id: "T7", title: "Task 7", status: "CODING_COMPLETED", merge_indicator: "AUTOMERGE" },
      { id: "T8", title: "Task 8", status: "FAILED" },
      { id: "T9", title: "Task 9", status: "BLOCKED" },
      { id: "T10", title: "Task 10", status: "QUOTA" },
    ];

    const result = runStatusTableStep(subtasks as Subtask[]);

    expect(result).toContain("- 💤 **T1**: `PENDING` - Task 1");
    expect(result).toContain("- ⏳ **T2**: `RUNNING` [jules] - Task 2");
    expect(result).toContain("- ✅ **T3**: `COMPLETED` - Task 3");
    expect(result).toContain("- 🛠️ **T4**: `CODING_COMPLETED` **(Awaiting Merge)** - Task 4");
    expect(result).toContain("- ✅ **T5**: `CODING_COMPLETED` - Task 5");
    expect(result).toContain("- ✅ **T6**: `CODING_COMPLETED` - Task 6");
    expect(result).toContain("- ✅ **T7**: `CODING_COMPLETED` - Task 7");
    expect(result).toContain("- ❌ **T8**: `FAILED` - Task 8");
    expect(result).toContain("- 🚫 **T9**: `BLOCKED` - Task 9");
    expect(result).toContain("- ⏸️ **T10**: `QUOTA` - Task 10");
  });
});
