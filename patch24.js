import fs from 'fs';
let content = fs.readFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', 'utf8');

content = content.replace('vi.mock("../../../src/services/cli-process-runner.js"', '// vi.mock');
content = content.replace('import { runCommandStrict } from "../../../src/services/cli-process-runner.js";', '');
content = content.replace('vi.mocked(runCommandStrict)', 'const mockRunProviderForText = vi.fn()');

content = content.replace(/vi\.mocked\(runCommandStrict\)\.mockResolvedValue\(\{[\s\S]*?\}\);/g, 'mockRunProviderForText.mockResolvedValue({ text: "$$$$$" });');
content = content.replace('expect(runCommandStrict).toHaveBeenCalledWith', 'expect(mockRunProviderForText).toHaveBeenCalledWith');
content = content.replace('"/repo",\n      expect.objectContaining({\n        GEMINI_API_KEY: "g-key",\n        GEMINI_MODEL: "gemini-2.5-pro",\n        GITHUB_TOKEN: "gh-token",\n      }),', 'expect.objectContaining({\n        cwd: "/repo",\n        apiKey: "g-key",\n        model: "gemini-2.5-pro",\n        githubToken: "gh-token",\n      })');

content = content.replace(/getGithubToken: \(\) => .*,/g, 'getGithubToken: () => undefined,\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');
content = content.replace('getGithubToken: () => "gh-token",', 'getGithubToken: () => "gh-token",\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');

content = content.replace('Current status: one task is running.', 'Current status: one task is running.');

fs.writeFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', content);
