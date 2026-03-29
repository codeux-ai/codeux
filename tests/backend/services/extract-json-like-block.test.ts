import { describe, expect, it } from "vitest";
import { extractJsonLikeBlock } from "../../../src/services/planning-json-extractor.js";

describe("extractJsonLikeBlock", () => {
  it("extracts plain JSON object", () => {
    const result = extractJsonLikeBlock('{"goal":"test","tasks":[]}');
    expect(JSON.parse(result)).toEqual({ goal: "test", tasks: [] });
  });

  it("extracts JSON from a fenced code block", () => {
    const input = "Here is the plan:\n```json\n{\"goal\":\"test\",\"tasks\":[]}\n```\nDone.";
    expect(JSON.parse(extractJsonLikeBlock(input))).toEqual({ goal: "test", tasks: [] });
  });

  it("extracts JSON buried after installation logs", () => {
    const input = [
      "Setting up Claude Code... ✔ Successfully installed!",
      "Version: 2.1.81",
      "Now I have a thorough understanding of the codebase.",
      "",
      '{"goal":"Add feature","tasks":[{"key":"T01","title":"First task","description":"desc","promptMarkdown":"## Objective\\nDo stuff","priority":"high","executorType":"auto","dependsOn":[]}]}',
    ].join("\n");
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.goal).toBe("Add feature");
    expect(parsed.tasks).toHaveLength(1);
  });

  it("skips fenced code blocks containing non-JSON (e.g. TypeScript with backticks in promptMarkdown)", () => {
    // Simulates the real bug: promptMarkdown contains ```ts ... ``` which
    // tricks the fenced-block regex into extracting TypeScript code instead of JSON.
    const input = [
      "Let me produce the plan.",
      "",
      '{',
      '  "goal": "Add types",',
      '  "tasks": [',
      '    {',
      '      "key": "T01",',
      '      "title": "Define types",',
      '      "description": "Create type definitions.",',
      '      "promptMarkdown": "## Objective\\nCreate types.\\n\\n## Implementation\\n\\n```ts\\nexport interface Foo {\\n  id: string;\\n}\\n```\\n\\n## Verification\\n- typecheck passes",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": []',
      '    }',
      '  ]',
      '}',
    ].join("\n");
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.goal).toBe("Add types");
    expect(parsed.tasks[0].key).toBe("T01");
  });

  it("skips stray brace objects in preamble and finds the valid planning JSON", () => {
    const input = [
      'Error: { errno: -2, code: "ENOENT" }',
      "Some other log output",
      '{"goal":"Real plan","tasks":[{"key":"T01","title":"Task","description":"d","promptMarkdown":"p","priority":"medium","executorType":"auto","dependsOn":[]}]}',
    ].join("\n");
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.goal).toBe("Real plan");
  });

  it("handles JSON array at top level", () => {
    const input = 'Some preamble\n["item1","item2"]';
    expect(JSON.parse(extractJsonLikeBlock(input))).toEqual(["item1", "item2"]);
  });

  it("returns the full input when no JSON is found", () => {
    const input = "No JSON here at all.";
    expect(extractJsonLikeBlock(input)).toBe(input);
  });

  it("unwraps a virtual worker session envelope with stringified response", () => {
    const planJson = JSON.stringify({
      goal: "SPR-27: Code Quality Audit",
      tasks: [{ key: "T01", title: "Optimize sync", description: "d", promptMarkdown: "p", priority: "high", executorType: "auto", dependsOn: [] }],
    });
    const envelope = JSON.stringify({
      session_id: "f0a53b65-5620-4f9c-9ced-02bcc0a7490e",
      response: planJson,
      stats: { models: {} },
    });
    const input = `MCP issues detected. Run /mcp list for status.${envelope} YOLO mode is enabled.`;
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.goal).toBe("SPR-27: Code Quality Audit");
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.tasks[0].key).toBe("T01");
  });

  it("unwraps envelope even when response contains escaped JSON", () => {
    const innerJson = '{"goal":"Test","tasks":[{"key":"T01","title":"Task","description":"d","promptMarkdown":"## Obj\\nDo stuff","priority":"medium","executorType":"auto","dependsOn":[]}]}';
    const envelope = JSON.stringify({ session_id: "abc", response: innerJson });
    const parsed = JSON.parse(extractJsonLikeBlock(envelope));
    expect(parsed.goal).toBe("Test");
  });

  it("does not unwrap when response field is not JSON", () => {
    const input = JSON.stringify({ session_id: "abc", response: "just a text response" });
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.session_id).toBe("abc");
    expect(parsed.response).toBe("just a text response");
  });

  it("handles MCP errors and grep errors surrounding the envelope", () => {
    const planJson = JSON.stringify({ goal: "Plan", tasks: [{ key: "T01", title: "T", description: "d", promptMarkdown: "p", priority: "low", executorType: "auto", dependsOn: [] }] });
    const envelope = JSON.stringify({ session_id: "x", response: planJson, stats: {} });
    const input = [
      "MCP issues detected. Run /mcp list for status.",
      envelope,
      "YOLO mode is enabled. All tool calls will be automatically approved.",
      "[MCP error] Error during discovery for MCP server 'jules': spawn jules-agent ENOENT",
      'Error during GrepLogic execution: Error: Process exited with code 2: regex parse error',
    ].join("\n");
    const parsed = JSON.parse(extractJsonLikeBlock(input));
    expect(parsed.goal).toBe("Plan");
  });
});
