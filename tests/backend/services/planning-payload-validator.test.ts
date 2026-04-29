import { describe, expect, it } from "vitest";
import { PlanningPayloadValidator } from "../../../src/services/planning-payload-validator.js";

describe("PlanningPayloadValidator", () => {
  const validator = new PlanningPayloadValidator();

  const validPromptMarkdown = "## Objective\n1\n## Scope\n2\n## Implementation Requirements\n3\n## Constraints\n4\n## Verification\n5";

  it("should validate a completely valid payload", () => {
    const validPayload = {
      goal: "Test Goal",
      tasks: [
        {
          key: "T1",
          title: "Task 1",
          description: "Description 1",
          promptMarkdown: validPromptMarkdown,
          priority: "high",
          executorType: "auto",
          dependsOn: []
        }
      ]
    };
    const result = validator.validate(validPayload);
    expect(result.goal).toEqual("Test Goal");
    expect(result.tasks.length).toEqual(1);
    expect(result.tasks[0]?.key).toEqual("T1");
  });

  it("should handle aliased input fields", () => {
    const aliasedPayload = {
      goal: "Alias Goal",
      subtasks: [
        {
          id: "T2",
          name: "Task 2",
          instructions: validPromptMarkdown,
          dependencies: []
        },
        {
          key: "T3",
          title: "Task 3",
          prompt: validPromptMarkdown,
          depends_on: ["T2"]
        }
      ]
    };
    const result = validator.validate(aliasedPayload);
    expect(result.tasks.length).toEqual(2);
    expect(result.tasks[0]?.key).toEqual("T2");
    expect(result.tasks[0]?.title).toEqual("Task 2");
    expect(result.tasks[0]?.promptMarkdown).toEqual(validPromptMarkdown);
    expect(result.tasks[1]?.key).toEqual("T3");
    expect(result.tasks[1]?.dependsOn).toEqual(["T2"]);
  });

  it("should reject non-object payloads", () => {
    expect(() => validator.validate(null)).toThrow("Planning payload must be an object.");
    expect(() => validator.validate("string")).toThrow("Planning payload must be an object.");
  });

  it("should reject missing tasks array", () => {
    expect(() => validator.validate({ goal: "Goal" })).toThrow("Planning payload 'tasks' must be an array.");
    expect(() => validator.validate({ goal: "Goal", tasks: "not-an-array" })).toThrow("Planning payload 'tasks' must be an array.");
  });

  it("should reject non-object tasks", () => {
    expect(() => validator.validate({ tasks: ["not-an-object"] })).toThrow("Task at index 0 is not an object.");
  });

  it("should reject out of order prompt sections", () => {
    const badPayload = {
      tasks: [
        {
          key: "T1",
          promptMarkdown: "## Objective\n1\n## Implementation Requirements\n2\n## Scope\n3\n## Constraints\n4\n## Verification\n5",
        }
      ]
    };
    expect(() => validator.validate(badPayload)).toThrow("sections are out of order");
  });

  it("should reject missing required prompt sections", () => {
    const badPayload = {
      tasks: [
        {
          key: "T1",
          promptMarkdown: "## Objective\n1\n## Scope\n2",
        }
      ]
    };
    expect(() => validator.validate(badPayload)).toThrow("is missing required section");
  });

  it("should reject duplicate task keys", () => {
    const duplicatePayload = {
      tasks: [
        { key: "T1", promptMarkdown: validPromptMarkdown },
        { key: "T1", promptMarkdown: validPromptMarkdown }
      ]
    };
    expect(() => validator.validate(duplicatePayload)).toThrow("Duplicate task key: T1");
  });

  it("should reject forward references", () => {
    const forwardPayload = {
      tasks: [
        { key: "T1", promptMarkdown: validPromptMarkdown, dependsOn: ["T2"] },
        { key: "T2", promptMarkdown: validPromptMarkdown }
      ]
    };
    expect(() => validator.validate(forwardPayload)).toThrow('Task "T1" depends on "T2" which is missing or defined later. Forward references are not allowed.');
  });

  it("should reject self dependencies", () => {
    const selfPayload = {
      tasks: [
        { key: "T1", promptMarkdown: validPromptMarkdown, dependsOn: ["T1"] }
      ]
    };
    expect(() => validator.validate(selfPayload)).toThrow('Task "T1" cannot depend on itself.');
  });

  it("normalizes priority and executorType with defaults", () => {
    const payload = {
      tasks: [
        {
          key: "T1",
          promptMarkdown: validPromptMarkdown,
          priority: "INVALID",
          executorType: "worker"
        }
      ]
    };
    const result = validator.validate(payload);
    expect(result.tasks[0]?.priority).toEqual("medium");
    expect(result.tasks[0]?.executorType).toEqual("auto"); // worker translates to auto
  });
});
