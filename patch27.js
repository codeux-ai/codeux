import fs from 'fs';
let content = fs.readFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', 'utf8');

// The file restores to the original. Let's do it carefully.
// Remove mock of cli-process-runner
content = content.replace(/vi\.mock\("..\/..\/..\/src\/services\/cli-process-runner.js", \(\) => \(\{\n  runCommandStrict: vi.fn\(\),\n\}\)\);\n\nimport \{ runCommandStrict \} from "..\/..\/..\/src\/services\/cli-process-runner.js";\n/, '');

// Inside describe, add a `mockRunProviderForText`
content = content.replace('describe("WorkerInboxReplyService", () => {', 'describe("WorkerInboxReplyService", () => {\n  const mockRunProviderForText = vi.fn();');

// Clear it in beforeEach
content = content.replace('vi.clearAllMocks();', 'vi.clearAllMocks();\n    mockRunProviderForText.mockReset();');

// Replace runCommandStrict usage
content = content.replace(/vi\.mocked\(runCommandStrict\)\.mockResolvedValue\(\{\n\s*ok: true,\n\s*code: 0,\n\s*stdout: "(.*?)",\n\s*stderr: "",\n\s*\}\);/g, 'mockRunProviderForText.mockResolvedValue({ text: "$1" });');
content = content.replace(/vi\.mocked\(runCommandStrict\)\.mockResolvedValue\(\{\n\s*ok: true,\n\s*code: 0,\n\s*stdout: JSON\.stringify\(([\s\S]*?)\),\n\s*stderr: "",\n\s*\}\);/g, 'mockRunProviderForText.mockResolvedValue({ text: JSON.stringify($1) });');

content = content.replace(/getGithubToken: \(\) => "gh-token",/g, 'getGithubToken: () => "gh-token",\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');
content = content.replace(/getGithubToken: \(\) => undefined,/g, 'getGithubToken: () => undefined,\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');

// Replace expect logic
content = content.replace(/expect\(runCommandStrict\)\.toHaveBeenCalledWith\([\s\S]*?\}\),\n    \);/g, 'expect(mockRunProviderForText).toHaveBeenCalledWith(\n      expect.objectContaining({\n        provider: "gemini",\n        cwd: "/repo",\n        apiKey: "g-key",\n        model: "gemini-2.5-pro",\n        githubToken: "gh-token",\n      })\n    );');

fs.writeFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', content);
