import { describe, it, expect } from "vitest";
import { extractJsonLikeBlock } from "../../../src/services/planning-json-extractor.js";

describe("extractJsonLikeBlock", () => {
  it("extracts plain top-level JSON", () => {
    const payload = JSON.stringify({ goal: "test", tasks: [] });
    expect(extractJsonLikeBlock(payload)).toEqual(payload);
  });

  it("extracts fenced JSON blocks with noise", () => {
    const payload = JSON.stringify({ goal: "test", tasks: [] });
    const input = `
Some log text before.
\`\`\`json
${payload}
\`\`\`
Some log text after.
`;
    expect(extractJsonLikeBlock(input)).toEqual(payload);
  });

  it("handles wrapped response objects", () => {
    const actualPayload = JSON.stringify({ goal: "test", tasks: [] });
    const envelope = JSON.stringify({
      session_id: "123",
      response: actualPayload,
      stats: { ok: true }
    });
    expect(extractJsonLikeBlock(envelope)).toEqual(actualPayload);
  });

  it("extracts double-encoded JSON strings", () => {
    const actualPayload = JSON.stringify({ goal: "test", tasks: [] });
    const envelope = JSON.stringify({
      message: JSON.stringify({ content: actualPayload })
    });
    expect(extractJsonLikeBlock(envelope)).toEqual(actualPayload);
  });

  it("handles top-level task arrays", () => {
    const payload = JSON.stringify([
      { title: "Task 1", prompt: "Prompt 1" },
      { title: "Task 2", prompt: "Prompt 2" }
    ]);
    expect(extractJsonLikeBlock(payload)).toEqual(payload);
  });

  it("skips stray log objects and returns the valid payload", () => {
    const validPayload = JSON.stringify({ goal: "test", tasks: [] });
    const input = `
{ "errno": -2, "code": "ENOENT" }
Some other log.
${validPayload}
`;
    expect(extractJsonLikeBlock(input)).toEqual(validPayload);
  });

  it("handles embedded fenced code in string literals", () => {
    const payload = JSON.stringify({
      goal: "test",
      tasks: [
        {
          title: "Test task",
          promptMarkdown: "Here is code:\n```json\n{ \"ignore\": \"me\" }\n```"
        }
      ]
    });
    const input = `
Some intro.
${payload}
Some outro.
`;
    expect(extractJsonLikeBlock(input)).toEqual(payload);
  });

  it("returns raw text if no json found", () => {
    const input = "Just some plain text.";
    expect(extractJsonLikeBlock(input)).toEqual("Just some plain text.");
  });

  it("recovers payload inside content", () => {
    const validPayload = JSON.stringify({ goal: "test", tasks: [] });
    const input = JSON.stringify({ content: validPayload });
    expect(extractJsonLikeBlock(input)).toEqual(validPayload);
  });

  it("recovers payload inside data array element", () => {
    const validPayload = JSON.stringify({ goal: "test", tasks: [] });
    const input = JSON.stringify({ data: [{ text: validPayload }] });
    expect(extractJsonLikeBlock(input)).toEqual(validPayload);
  });

  it("picks direct payload over wrapped fallback when multiple valid blocks exist", () => {
    const fallbackPayload = JSON.stringify({ response: JSON.stringify({ goal: "fallback", tasks: [] }) });
    const directPayload = JSON.stringify({ goal: "direct", tasks: [] });
    const input = `
Here is a fallback block:
\`\`\`json
${fallbackPayload}
\`\`\`

Here is the direct block:
\`\`\`json
${directPayload}
\`\`\`
`;
    expect(extractJsonLikeBlock(input)).toEqual(directPayload);
  });

  it("handles large markdown responses", () => {
    // Generate a markdown response with many small balanced bracket/brace pairs
    let input = "";
    for (let i = 0; i < 100; i++) {
      input += `Some text { "noise": ${i} } more noise [ ${i} ]\n`;
    }
    const directPayload = JSON.stringify({ goal: "direct", tasks: [] });
    input += `
\`\`\`json
${directPayload}
\`\`\`
`;
    for (let i = 100; i < 200; i++) {
      input += `Some text { "noise": ${i} } more noise [ ${i} ]\n`;
    }

    const start = Date.now();
    const result = extractJsonLikeBlock(input);
    const end = Date.now();

    // The Direct Payload should still be found (it's in fenced code, which is scanned before braces).
    expect(result).toEqual(directPayload);
    // Parsing should be fast
    expect(end - start).toBeLessThan(100);
  });
});
