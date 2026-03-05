import { describe, expect, it } from "vitest";
import { SubtaskParser } from "../../../../src/infrastructure/repositories/subtask-parser.js";

describe("SubtaskParser", () => {
  it("parses a standard subtask correctly", () => {
    const content = `
title: Standard Task
depends_on: [T01, T02]
is_independent: false
merged: true
prompt:
This is a detailed prompt.
It spans multiple lines.
`.trim();

    const result = SubtaskParser.parse("T03", content);

    expect(result.id).toBe("T03");
    expect(result.title).toBe("Standard Task");
    expect(result.depends_on).toEqual(["T01", "T02"]);
    expect(result.is_independent).toBe(false);
    expect(result.is_merged).toBe(true);
    expect(result.prompt).toBe("This is a detailed prompt.\nIt spans multiple lines.");
  });

  it("handles prompt content on the same line as prompt:", () => {
    const content = `
title: Task
prompt: Same line prompt
Next line content.
`.trim();

    const result = SubtaskParser.parse("T01", content);
    expect(result.prompt).toBe("Same line prompt\nNext line content.");
  });

  it("handles missing prompt: section by using whole content", () => {
    const content = `
title: Only Title
is_independent: true
`.trim();

    const result = SubtaskParser.parse("T01", content);
    expect(result.title).toBe("Only Title");
    expect(result.prompt).toBe(content);
  });

  it("parses depends_on with various formats", () => {
    expect(SubtaskParser.parseDependsOn("[T01, T02]")).toEqual(["T01", "T02"]);
    expect(SubtaskParser.parseDependsOn('["T01", "T02"]')).toEqual(["T01", "T02"]);
    expect(SubtaskParser.parseDependsOn("[ 'T01' , 'T02' ]")).toEqual(["T01", "T02"]);
    expect(SubtaskParser.parseDependsOn("[T01]")).toEqual(["T01"]);
    expect(SubtaskParser.parseDependsOn("[]")).toEqual([]);
    expect(SubtaskParser.parseDependsOn("")).toEqual([]);
  });

  it("defaults is_independent to true if missing or not 'false'", () => {
    expect(SubtaskParser.parse("T1", "title: T1").is_independent).toBe(true);
    expect(SubtaskParser.parse("T1", "is_independent: true").is_independent).toBe(true);
    expect(SubtaskParser.parse("T1", "is_independent: foo").is_independent).toBe(true);
    expect(SubtaskParser.parse("T1", "is_independent: false").is_independent).toBe(false);
  });

  it("defaults is_merged to false if missing or not 'true'", () => {
    expect(SubtaskParser.parse("T1", "title: T1").is_merged).toBe(false);
    expect(SubtaskParser.parse("T1", "merged: false").is_merged).toBe(false);
    expect(SubtaskParser.parse("T1", "merged: true").is_merged).toBe(true);
  });

  it("handles multiline metadata", () => {
    const content = `
title: Multi Line
 Task Title
depends_on: [T01]
is_independent: true
prompt:
The prompt.
`.trim();
    const result = SubtaskParser.parse("T1", content);
    expect(result.title).toBe("Multi Line Task Title");
  });

  it("parses depends_on correctly with complex spacing and quotes", () => {
    expect(SubtaskParser.parseDependsOn('[  "T01, T02" , T03 , \'T04\'  ]')).toEqual(["T01, T02", "T03", "T04"]);
  });

  it("sorts depends_on in stringify for deterministic output", () => {
    const original: any = {
      id: "T01",
      title: "Round Trip",
      depends_on: ["T03", "T02"],
      is_independent: false,
      is_merged: true,
      prompt: "Original prompt content",
    };

    const stringified = SubtaskParser.stringify(original);
    expect(stringified).toContain('depends_on: ["T02", "T03"]');
  });

  it("is case-insensitive for metadata keys", () => {
    const content = `
TITLE: Case Task
DEPENDS_ON: [T1]
PROMPT: content
`.trim();
    const result = SubtaskParser.parse("T1", content);
    expect(result.title).toBe("Case Task");
    expect(result.depends_on).toEqual(["T1"]);
    expect(result.prompt).toBe("content");
  });

  it("handles colon in prompt", () => {
    const content = `
title: Colon Task
prompt:
Here is a colon: it should work.
Another key: value inside prompt.
`.trim();
    const result = SubtaskParser.parse("T1", content);
    expect(result.prompt).toBe("Here is a colon: it should work.\nAnother key: value inside prompt.");
  });

  it("handles round-trip (stringify and parse back)", () => {
    const original: any = {
      id: "T01",
      title: "Round Trip",
      depends_on: ["T03", "T02"], // Unordered to test deterministic sorting
      is_independent: false,
      is_merged: true,
      prompt: "Original prompt content",
    };

    const stringified = SubtaskParser.stringify(original);
    const parsed = SubtaskParser.parse(original.id, stringified);

    expect(parsed.id).toBe(original.id);
    expect(parsed.title).toBe(original.title);
    expect(parsed.depends_on).toEqual(["T02", "T03"]); // Should be parsed back sorted
    expect(parsed.is_independent).toBe(original.is_independent);
    expect(parsed.is_merged).toBe(original.is_merged);
    expect(parsed.prompt).toBe(original.prompt);
  });
});
