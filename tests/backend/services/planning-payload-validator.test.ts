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
          key: "T01",
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
    expect(result.tasks[0]?.key).toEqual("T01");
  });

  it("should reject payloads with aliased input fields", () => {
    const payloadsWithAliases = [
      { goal: "Goal", subtasks: [] },
      { goal: "Goal", tasks: [{ id: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown }] },
      { goal: "Goal", tasks: [{ key: "T01", name: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown }] },
      { goal: "Goal", tasks: [{ key: "T01", title: "Task 1", description: "Desc", prompt: validPromptMarkdown }] },
      { goal: "Goal", tasks: [{ key: "T01", title: "Task 1", description: "Desc", instructions: validPromptMarkdown }] },
      { goal: "Goal", tasks: [{ key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown, depends_on: [] }] },
      { goal: "Goal", tasks: [{ key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown, dependencies: [] }] }
    ];

    for (const payload of payloadsWithAliases) {
      expect(() => validator.validate(payload)).toThrow(/legacy/i);
    }
  });

  it("should reject missing or non-string required fields", () => {
    const invalidTasks = [
      { title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown }, // missing key
      { key: 123, title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown }, // numeric key
      { key: "T01", description: "Desc", promptMarkdown: validPromptMarkdown }, // missing title
      { key: "T01", title: 123, description: "Desc", promptMarkdown: validPromptMarkdown }, // numeric title
      { key: "T01", title: "Task 1", promptMarkdown: validPromptMarkdown }, // missing description
      { key: "T01", title: "Task 1", description: 123, promptMarkdown: validPromptMarkdown }, // numeric description
      { key: "T01", title: "Task 1", description: "Desc" }, // missing promptMarkdown
      { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: 123 }, // numeric promptMarkdown
    ];

    for (const task of invalidTasks) {
      expect(() => validator.validate({ goal: "Goal", tasks: [task] })).toThrow(/(must have a|is missing a|has invalid key)/i);
    }
  });

  it("should reject malformed dependsOn arrays", () => {
    const invalidDependencies = [
      "T01", // String instead of array
      [123], // Number in array
      [{ key: "T01" }] // Object in array
    ];

    for (const dependsOn of invalidDependencies) {
      expect(() => validator.validate({
        goal: "Goal",
        tasks: [
          { key: "T01", title: "Task 0", description: "Desc", promptMarkdown: validPromptMarkdown },
          { key: "T02", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown, dependsOn }
        ]
      })).toThrow(/must be an array of strings/i);
    }
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
          key: "T01",
          title: "Task 1",
          description: "Desc",
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
          key: "T01",
          title: "Task 1",
          description: "Desc",
          promptMarkdown: "## Objective\n1\n## Scope\n2",
        }
      ]
    };
    expect(() => validator.validate(badPayload)).toThrow("is missing required section");
  });

  it("should reject duplicate task keys", () => {
    const duplicatePayload = {
      tasks: [
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown },
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown }
      ]
    };
    // Rejects because the second item has an invalid key "T01" while "T02" is expected.
    expect(() => validator.validate(duplicatePayload)).toThrow('Task at index 1 has invalid key "T01". Expected "T02"');
  });

  it("should reject forward references", () => {
    const forwardPayload = {
      tasks: [
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown, dependsOn: ["T02"] },
        { key: "T02", title: "Task 2", description: "Desc", promptMarkdown: validPromptMarkdown }
      ]
    };
    expect(() => validator.validate(forwardPayload)).toThrow('Task "T01" depends on "T02" which is missing or defined later. Forward references are not allowed.');
  });

  it("should reject self dependencies", () => {
    const selfPayload = {
      tasks: [
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown, dependsOn: ["T01"] }
      ]
    };
    expect(() => validator.validate(selfPayload)).toThrow('Task "T01" cannot depend on itself.');
  });

  it("normalizes legacy mcp_worker to auto but rejects invalid executorType and priority", () => {
    const payloadInvalidPriority = {
      tasks: [
        {
          key: "T01",
          title: "Task 1",
          description: "Desc",
          promptMarkdown: validPromptMarkdown,
          priority: "INVALID"
        }
      ]
    };
    expect(() => validator.validate(payloadInvalidPriority)).toThrow('Task "T01" has invalid priority "INVALID".');

    const payloadInvalidExecutor = {
      tasks: [
        {
          key: "T01",
          title: "Task 1",
          description: "Desc",
          promptMarkdown: validPromptMarkdown,
          executorType: "INVALID"
        }
      ]
    };
    expect(() => validator.validate(payloadInvalidExecutor)).toThrow('Task "T01" has invalid executorType "INVALID".');

    const payloadWorkerFallback = {
      tasks: [
        {
          key: "T01",
          title: "Task 1",
          description: "Desc",
          promptMarkdown: validPromptMarkdown,
          executorType: "mcp_worker"
        }
      ]
    };
    const result = validator.validate(payloadWorkerFallback);
    expect(result.tasks[0]?.executorType).toEqual("auto"); // mcp_worker translates to auto
  });

  it("accepts allowed agentPresetId and rejects unlisted agents", () => {
    const payload = {
      tasks: [
        {
          key: "T01",
          title: "Task 1",
          description: "Desc",
          promptMarkdown: validPromptMarkdown,
          agentPresetId: "frontend-agent",
        },
      ],
    };

    expect(validator.validate(payload, { allowedAgentPresetIds: ["frontend-agent"] }).tasks[0]?.agentPresetId).toBe("frontend-agent");
    expect(() => validator.validate(payload, { allowedAgentPresetIds: ["backend-agent"] })).toThrow("not in the allowed coding-agent roster");
  });

  it("should reject gaps or out of order task keys", () => {
    const badPayload = {
      tasks: [
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown },
        { key: "T03", title: "Task 2", description: "Desc", promptMarkdown: validPromptMarkdown, dependsOn: ["T01"] }
      ]
    };
    expect(() => validator.validate(badPayload)).toThrow('Task at index 1 has invalid key "T03". Expected "T02" in strict DAG order.');
  });

  it("should reject duplicate dependency elements", () => {
    const badPayload = {
      tasks: [
        { key: "T01", title: "Task 1", description: "Desc", promptMarkdown: validPromptMarkdown },
        { key: "T02", title: "Task 2", description: "Desc", promptMarkdown: validPromptMarkdown, dependsOn: ["T01", "T01"] }
      ]
    };
    expect(() => validator.validate(badPayload)).toThrow('Task "T02" has duplicate dependency "T01".');
  });
});
