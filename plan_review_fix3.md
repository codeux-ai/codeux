
1. Use the `run_in_bash_session` tool to run a Node.js script `patch_utils_fix.cjs` that reads `src/server/preview-host-utils.ts` and fixes the `requestBufferedPreviewResponse` function so that when the 5MB body size limit is exceeded, it explicitly rejects the Promise.
The patch script `patch_utils_fix.cjs` will contain:
```javascript
const fs = require('fs');
let code = fs.readFileSync('src/server/preview-host-utils.ts', 'utf8');
code = code.replace(
  /proxyResponse\.destroy\(new Error\("Response body exceeds maximum allowed size for buffered proxying"\)\);\n\s*return;/,
  `const err = new Error("Response body exceeds maximum allowed size for buffered proxying");
          proxyResponse.destroy(err);
          reject(err);
          return;`
);
fs.writeFileSync('src/server/preview-host-utils.ts', code);
```
2. Use the `run_in_bash_session` tool with `git diff` to verify that `src/server/preview-host-utils.ts` was updated successfully.
3. Use the `run_in_bash_session` tool to run a Node.js script `patch_service_fix.cjs` that modifies `src/services/sprint-preview-service.ts` to enforce the 5MB body size limit *during* the stream read by utilizing the `response.body` (which is a `ReadableStream`) or the Node.js stream, instead of waiting for `await response.arrayBuffer()` to buffer the whole payload.
The script will contain:
```javascript
const fs = require('fs');
let code = fs.readFileSync('src/services/sprint-preview-service.ts', 'utf8');

const regex = /const arrayBuffer = await response\.arrayBuffer\(\);[\s\S]*?const bodyBuffer = Buffer\.from\(arrayBuffer\);/;
const replaceWith = `const chunks: Buffer[] = [];
    let totalSize = 0;
    if (response.body) {
      for await (const chunk of response.body as any) {
        totalSize += chunk.length;
        if (totalSize > 5 * 1024 * 1024) {
          throw new Error("Response body exceeds maximum allowed size for proxied preview");
        }
        chunks.push(Buffer.from(chunk));
      }
    } else {
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength > 5 * 1024 * 1024) {
        throw new Error("Response body exceeds maximum allowed size for proxied preview");
      }
      chunks.push(Buffer.from(arrayBuffer));
    }
    const bodyBuffer = Buffer.concat(chunks);`;

code = code.replace(regex, replaceWith);
fs.writeFileSync('src/services/sprint-preview-service.ts', code);
```
4. Use the `run_in_bash_session` tool with `git diff` to verify that `src/services/sprint-preview-service.ts` was updated successfully.
5. Use the `run_in_bash_session` tool to run a Node.js script `patch_tests_fix.cjs` to append test cases for `set-cookie` suppression and bridge injection to `tests/backend/services/sprint-preview-service-unit.test.ts` and `tests/backend/server/preview-host-utils.test.ts`.
The script will contain:
```javascript
const fs = require('fs');

// Add test for set-cookie suppression to sprint-preview-service-unit.test.ts
let serviceTestCode = fs.readFileSync('tests/backend/services/sprint-preview-service-unit.test.ts', 'utf8');
const testCases = `
    it("suppresses set-cookie header from proxied response", async () => {
      const session = makeSession({ containerId: null, containerName: null });
      deps.sprintPreviewRepository.getSession.mockReturnValue(session);
      deps.sprintPreviewRepository.updateSession.mockImplementation(
        (id: string, patch: Partial<SprintPreviewSession>) => makeSession({ id, ...patch }),
      );

      vi.mocked(normalizePreviewPath).mockReturnValue("/test");

      const mockResponse = {
        status: 200,
        headers: new Headers({ "set-cookie": "secret=true", "x-custom": "allowed" }),
        body: (async function* () {
          yield new TextEncoder().encode("hello");
        })(),
      };
      vi.stubGlobal("fetch", vi.fn(async () => mockResponse));

      const service = new SprintPreviewService(deps as any);
      const res = await service.proxyRequest({ sessionId: "session-1", method: "GET", path: "/" });

      expect(res.headers).not.toHaveProperty("set-cookie");
      expect(res.headers).toHaveProperty("x-custom", "allowed");
    });
`;
serviceTestCode = serviceTestCode.replace(
  /it\("throws error when proxied response exceeds maximum allowed size", async \(\) => \{/,
  testCases + '\n    it("throws error when proxied response exceeds maximum allowed size", async () => {'
);
fs.writeFileSync('tests/backend/services/sprint-preview-service-unit.test.ts', serviceTestCode);

// Add test for bridge injection and set-cookie suppression to preview-host-utils.test.ts
let utilsTestCode = fs.readFileSync('tests/backend/server/preview-host-utils.test.ts', 'utf8');
const utilsTests = `
import { sendBufferedPreviewResponse, injectPreviewBridgeIntoHtml, PREVIEW_BRIDGE_PATH } from "../../../src/server/preview-host-utils.js";

  describe("injectPreviewBridgeIntoHtml", () => {
    it("injects bridge script into HTML", () => {
      const html = "<html><head></head><body>Hello</body></html>";
      const injected = injectPreviewBridgeIntoHtml(html);
      expect(injected).toContain(PREVIEW_BRIDGE_PATH);
      expect(injected).toContain("</head>");
    });
  });

  describe("sendBufferedPreviewResponse", () => {
    it("suppresses set-cookie header", () => {
      const req = { protocol: "http", headers: { host: "dashboard.local" } } as unknown as Request;
      let writtenHeaders: any;
      const res = {
        writeHead: (status: number, headers: any) => { writtenHeaders = headers; },
        end: () => {},
      } as any;

      sendBufferedPreviewResponse({
        req, res, upstreamPort: 3000,
        response: {
          statusCode: 200,
          headers: { "set-cookie": ["secret=1"], "content-type": "text/html" },
          body: Buffer.from("<html></html>")
        }
      });

      expect(writtenHeaders).not.toHaveProperty("set-cookie");
    });
  });
`;
utilsTestCode = utilsTestCode.replace(
  /}\);\n}\);\n\s*$/,
  '});\n' + utilsTests + '\n});\n'
);
fs.writeFileSync('tests/backend/server/preview-host-utils.test.ts', utilsTestCode);
```
6. Use the `run_in_bash_session` tool with `git diff` to verify the modifications.
7. Use the `run_in_bash_session` tool to run tests via `pnpm run test:backend -- tests/backend/services/sprint-preview-service-unit.test.ts tests/backend/server/preview-host-utils.test.ts tests/backend/services/sprint-preview-docker-plan.test.ts` and `pnpm run typecheck` to verify the fix does not break functionality.
8. Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
9. Use the `submit` tool to finish the task.
