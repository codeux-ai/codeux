import fs from 'fs';
let content = fs.readFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', 'utf8');

// Replace vi.mock("...cli-process-runner.js")
content = content.replace(/vi\.mock\("\.\.\/\.\.\/\.\.\/src\/services\/cli-process-runner\.js", \(\) => \(\{\n  runCommandStrict: vi\.fn\(\),\n\}\)\);/, '');
content = content.replace('import { runCommandStrict } from "../../../src/services/cli-process-runner.js";', '');

// For each test, replace vi.mocked(runCommandStrict).mockResolvedValue(...) with const mockRunProviderForText = vi.fn().mockResolvedValue(...)
content = content.replace(/vi\.mocked\(runCommandStrict\)\.mockResolvedValue\(\{\n\s*ok: true,\n\s*code: 0,\n\s*stdout: "([^"]+)",\n\s*stderr: "",\n\s*\}\);/g, 'const mockRunProviderForText = vi.fn().mockResolvedValue({ text: "$1" });');

content = content.replace(/vi\.mocked\(runCommandStrict\)\.mockResolvedValue\(\{\n\s*ok: true,\n\s*code: 0,\n\s*stdout: JSON\.stringify\(([\s\S]*?)\),\n\s*stderr: "",\n\s*\}\);/g, 'const mockRunProviderForText = vi.fn().mockResolvedValue({ text: JSON.stringify($1) });');

content = content.replace(/getDashboardSettings: \(\) => settings,\n\s*getGithubToken: \(\) => "gh-token",/g, 'getDashboardSettings: () => settings,\n      getGithubToken: () => "gh-token",\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');
content = content.replace(/getDashboardSettings: \(\) => settings,\n\s*getGithubToken: \(\) => undefined,/g, 'getDashboardSettings: () => settings,\n      getGithubToken: () => undefined,\n      providerRunner: { runProviderForText: mockRunProviderForText } as any,');

// Replace expect(runCommandStrict).toHaveBeenCalledWith(...)
content = content.replace(/expect\(runCommandStrict\)\.toHaveBeenCalledWith\(\n\s*"gemini",\n\s*expect\.arrayContaining\(\["--yolo", "--p", expect\.stringContaining\("What is the current worker status\?"\)]\),\n\s*"\/repo",\n\s*expect\.objectContaining\(\{\n\s*GEMINI_API_KEY: "g-key",\n\s*GEMINI_MODEL: "gemini-2.5-pro",\n\s*GITHUB_TOKEN: "gh-token",\n\s*\}\),\n\s*\);/g, 'expect(mockRunProviderForText).toHaveBeenCalledWith(\n      expect.objectContaining({\n        provider: "gemini",\n        cwd: "/repo",\n        apiKey: "g-key",\n        model: "gemini-2.5-pro",\n        githubToken: "gh-token",\n      })\n    );');

fs.writeFileSync('tests/backend/services/worker-inbox-reply-service.test.ts', content);
