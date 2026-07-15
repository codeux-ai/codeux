import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CustomNodeManifest } from "../../contracts/custom-node-types.js";
import { CUSTOM_NODE_SCHEMA_VERSION } from "../../contracts/custom-node-types.js";
import { ValidationError } from "../../repositories/repository-utils.js";

const NODE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

export interface GenerateCustomNodeProjectInput {
  projectRoot: string;
  nodeId: string;
  name: string;
  description?: string;
  overwrite?: boolean;
}

export interface GeneratedCustomNodeProject {
  root: string;
  manifest: CustomNodeManifest;
  files: string[];
}

export class CustomNodeProjectService {
  generatedRunnerSource(): string {
    return runnerSource();
  }

  async generate(input: GenerateCustomNodeProjectInput): Promise<GeneratedCustomNodeProject> {
    const nodeId = input.nodeId.trim();
    if (!NODE_ID_PATTERN.test(nodeId)) {
      throw new ValidationError("Custom node id must be 3-64 lowercase letters, numbers, or hyphens and start with a letter.");
    }
    const projectRoot = path.resolve(input.projectRoot);
    const root = path.resolve(projectRoot, ".code-ux", "nodes", nodeId);
    this.requireContained(projectRoot, root);
    if (!input.overwrite) {
      await fs.access(root).then(
        () => { throw new ValidationError(`Custom node project already exists: ${nodeId}`); },
        () => undefined,
      );
    } else {
      await fs.rm(root, { recursive: true, force: true });
    }

    const manifest = defaultManifest(nodeId, input.name, input.description ?? "");
    const files = projectFiles(manifest);
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    for (const [relativePath, content] of Object.entries(files)) {
      const target = path.resolve(root, relativePath);
      this.requireContained(root, target);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, content, { encoding: "utf8", mode: 0o600 });
    }
    return { root, manifest, files: Object.keys(files).sort() };
  }

  async readManifest(projectRoot: string, nodeId: string): Promise<CustomNodeManifest> {
    const root = this.resolveNodeRoot(projectRoot, nodeId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(root, "node.json"), "utf8"));
    } catch (error) {
      throw new ValidationError(`Unable to read custom node manifest: ${error instanceof Error ? error.message : String(error)}`);
    }
    return parsed as CustomNodeManifest;
  }

  async writeManifest(projectRoot: string, nodeId: string, manifest: CustomNodeManifest): Promise<void> {
    const root = this.resolveNodeRoot(projectRoot, nodeId);
    if (manifest.id !== nodeId || manifest.nodeType !== `custom.${nodeId}`) throw new ValidationError("Custom node manifest identity does not match its project.");
    await fs.writeFile(path.join(root, "node.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  resolveNodeRoot(projectRoot: string, nodeId: string): string {
    if (!NODE_ID_PATTERN.test(nodeId)) throw new ValidationError("Invalid custom node id.");
    const base = path.resolve(projectRoot);
    const root = path.resolve(base, ".code-ux", "nodes", nodeId);
    this.requireContained(base, root);
    return root;
  }

  private requireContained(basePath: string, targetPath: string): void {
    const relative = path.relative(basePath, targetPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ValidationError("Custom node path escapes the project root.");
  }
}

function defaultManifest(nodeId: string, name: string, description: string): CustomNodeManifest {
  return {
    schemaVersion: CUSTOM_NODE_SCHEMA_VERSION,
    id: nodeId,
    nodeType: `custom.${nodeId}`,
    version: 1,
    name: name.trim() || nodeId,
    description: description.trim(),
    entrypoint: "dist/index.js",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    configurationSchema: { type: "object" },
    capabilities: ["clock.read"],
    credentials: [],
    resources: { cpu: 0.5, memoryMb: 128, pids: 64, timeoutMs: 30_000, maxOutputBytes: 262_144, scratchMb: 32 },
  };
}

function projectFiles(manifest: CustomNodeManifest): Record<string, string> {
  const packageName = `@codeux-custom/${manifest.id}`;
  return {
    "node.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "package.json": `${JSON.stringify({
      name: packageName, version: `${manifest.version}.0.0`, private: true, type: "module", packageManager: "pnpm@11.13.0",
      scripts: { typecheck: "tsc --noEmit", build: "tsc", test: "node --test dist/tests/*.test.js" },
      devDependencies: { "@types/node": "25.6.0", typescript: "5.9.3" },
    }, null, 2)}\n`,
    "pnpm-lock.yaml": lockfile(packageName),
    "tsconfig.json": `${JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      outDir: "dist", rootDir: ".", declaration: true, noUncheckedIndexedAccess: true,
    }, include: ["src/**/*.ts", "tests/**/*.ts"] }, null, 2)}\n`,
    "src/sdk.ts": sdkSource(),
    "src/index.ts": `import type { CustomNodeHandler } from "./sdk.js";\n\nexport const run: CustomNodeHandler = async (context) => {\n  context.logger.info("custom node started", { correlationId: context.correlationId });\n  return { ...context.input, executedAt: context.clock.now() };\n};\n`,
    "src/runner.ts": runnerSource(),
    "tests/index.test.ts": `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { run } from "../src/index.js";\n\ntest("returns deterministic fixture output", async () => {\n  const context = { input: { value: 1 }, config: {}, correlationId: "fixture", invocationId: "fixture", signal: new AbortController().signal, logger: { debug() {}, info() {}, warn() {}, error() {} }, clock: { now: () => "2026-01-01T00:00:00.000Z" }, http: { request: async () => { throw new Error("not declared"); } }, credentials: { get: async () => { throw new Error("not declared"); } }, temporaryStorage: { read: async () => null, write: async () => undefined }, artifacts: { write: async (name: string, content: string | Uint8Array) => ({ name, digest: "fixture", size: typeof content === "string" ? content.length : content.byteLength }) } };\n  assert.deepEqual(await run(context), { value: 1, executedAt: "2026-01-01T00:00:00.000Z" });\n});\n`,
    "fixtures/basic.json": `${JSON.stringify({ input: { value: 1 }, config: {}, output: { value: 1, executedAt: "2026-01-01T00:00:00.000Z" } }, null, 2)}\n`,
    "Dockerfile": createCustomNodeDockerfile(),
  };
}

function lockfile(packageName: string): string {
  return `lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: false\n  excludeLinksFromLockfile: false\n\nimporters:\n  .:\n    devDependencies:\n      '@types/node':\n        specifier: 25.6.0\n        version: 25.6.0\n      typescript:\n        specifier: 5.9.3\n        version: 5.9.3\n\npackages:\n  '@types/node@25.6.0':\n    resolution: {integrity: sha512-+qIYRKdNYJwY3vRCZMdJbPLJAtGjQBudzZzdzwQYkEPQd+PJGixUL5QfvCLDaULoLv+RhT3LDkwEfKaAkgSmNQ==}\n  typescript@5.9.3:\n    resolution: {integrity: sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==}\n    engines: {node: '>=14.17'}\n    hasBin: true\n  undici-types@7.19.2:\n    resolution: {integrity: sha512-qYVnV5OEm2AW8cJMCpdV20CDyaN3g0AjDlOGf1OW4iaDEx8MwdtChUp4zu4H0VP3nDRF/8RKWH+IPp9uW0YGZg==}\n\nsnapshots:\n  '@types/node@25.6.0':\n    dependencies:\n      undici-types: 7.19.2\n  typescript@5.9.3: {}\n  undici-types@7.19.2: {}\n# ${packageName}\n`;
}

function sdkSource(): string {
  return `export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };\nexport type JsonObject = { [key: string]: Json };\nexport interface NodeExecutionContext {\n  readonly input: Readonly<JsonObject>; readonly config: Readonly<JsonObject>; readonly correlationId: string; readonly invocationId: string; readonly signal: AbortSignal;\n  readonly logger: { debug(message: string, fields?: JsonObject): void; info(message: string, fields?: JsonObject): void; warn(message: string, fields?: JsonObject): void; error(message: string, fields?: JsonObject): void };\n  readonly clock: { now(): string };\n  readonly http: { request(request: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }> };\n  readonly credentials: { get(slot: string): Promise<string> };\n  readonly temporaryStorage: { read(path: string): Promise<Uint8Array | null>; write(path: string, content: string | Uint8Array): Promise<void> };\n  readonly artifacts: { write(name: string, content: string | Uint8Array, mediaType: string): Promise<{ name: string; digest: string; size: number }> };\n}\nexport type CustomNodeHandler = (context: NodeExecutionContext) => Promise<JsonObject>;\n`;
}

function runnerSource(): string {
  return runnerTemplateSource()
    .replace(
      'const log = (level: string, message: string, fields?: JsonObject): void => process.stderr.write(JSON.stringify({ level, message: redactText(message), fields: fields ? redactJson(fields) : undefined, correlationId: envelope.correlationId }) + "\\n");',
      'const log = (level: string, message: string, fields?: JsonObject): void => { process.stderr.write(JSON.stringify({ level, message: redactText(message), fields: fields ? redactJson(fields) : undefined, correlationId: envelope.correlationId }) + "\\n"); };',
    )
    .replace('socket.on("data", (chunk) => response.push(chunk));', 'socket.on("data", (chunk) => response.push(Buffer.from(chunk)));');
}

function runnerTemplateSource(): string {
  return `import * as fs from "node:fs/promises";\nimport * as crypto from "node:crypto";\nimport * as net from "node:net";\nimport * as path from "node:path";\nimport { run } from "./index.js";\nimport type { Json, JsonObject, NodeExecutionContext } from "./sdk.js";\nconst scratch = "/tmp/codeux"; const chunks: Buffer[] = []; for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));\nconst envelope = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: JsonObject; config: JsonObject; correlationId: string; invocationId: string; credentials: Record<string, string>; now: string; egress?: { socketPath: string; token: string } };\nconst secrets = [...Object.values(envelope.credentials), ...(envelope.egress ? [envelope.egress.token] : [])]; const redactText = (value: string): string => { let text = value; for (const secret of secrets) if (secret) text = text.split(secret).join("[REDACTED]"); return text; }; const redactJson = (value: Json): Json => typeof value === "string" ? redactText(value) : Array.isArray(value) ? value.map(redactJson) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry)])) : value;\nconst log = (level: string, message: string, fields?: JsonObject): void => process.stderr.write(JSON.stringify({ level, message: redactText(message), fields: fields ? redactJson(fields) : undefined, correlationId: envelope.correlationId }) + "\\n");\nconst safePath = (value: string): string => { const target = path.resolve(scratch, value); if (target !== scratch && !target.startsWith(scratch + path.sep)) throw new Error("temporary storage path escaped scratch"); return target; };\nconst httpRequest: NodeExecutionContext["http"]["request"] = async (request) => { if (!envelope.egress) throw new Error("network.http capability is not declared"); const responseText = await new Promise<string>((resolve, reject) => { const socket = net.createConnection(envelope.egress!.socketPath); const response: Buffer[] = []; socket.on("connect", () => socket.end(JSON.stringify({ token: envelope.egress!.token, request }))); socket.on("data", (chunk) => response.push(chunk)); socket.on("end", () => resolve(Buffer.concat(response).toString("utf8"))); socket.on("error", reject); }); const result = JSON.parse(responseText) as { ok: boolean; response?: { status: number; headers: Record<string, string>; body: string }; error?: string }; if (!result.ok || !result.response) throw new Error(result.error ?? "HTTP bridge request failed"); return result.response; };\nconst context: NodeExecutionContext = { input: Object.freeze(envelope.input), config: Object.freeze(envelope.config), correlationId: envelope.correlationId, invocationId: envelope.invocationId, signal: new AbortController().signal, logger: { debug: (m,f) => log("debug",m,f), info: (m,f) => log("info",m,f), warn: (m,f) => log("warn",m,f), error: (m,f) => log("error",m,f) }, clock: { now: () => envelope.now }, http: { request: httpRequest }, credentials: { get: async (slot) => { const value = envelope.credentials[slot]; if (!value) throw new Error("credential slot is unavailable"); return value; } }, temporaryStorage: { read: async (file) => fs.readFile(safePath(file)).catch(() => null), write: async (file, content) => { const target = safePath(file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); } }, artifacts: { write: async (name, content) => { const target = safePath("artifacts/" + name); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); const bytes = typeof content === "string" ? Buffer.from(content) : content; return { name, digest: "sha256:" + crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.byteLength }; } } };\ntry { const output = await run(context); process.stdout.write(JSON.stringify(output)); } catch (error) { log("error", error instanceof Error ? error.message : String(error)); process.exitCode = 1; }\n`;
}

export function createCustomNodeDockerfile(): string {
  return `# syntax=docker/dockerfile:1.7\nFROM node:22-bookworm-slim AS build\nWORKDIR /build\nCOPY package.json pnpm-lock.yaml ./\nRUN corepack enable && pnpm install --frozen-lockfile --ignore-scripts\nCOPY tsconfig.json ./\nCOPY src ./src\nCOPY tests ./tests\nRUN --network=none pnpm run typecheck && pnpm run build && pnpm run test\n\nFROM gcr.io/distroless/nodejs22-debian12:nonroot\nWORKDIR /app\nCOPY --from=build --chown=65532:65532 /build/dist ./dist\nUSER 65532:65532\nENTRYPOINT ["/nodejs/bin/node", "/app/dist/src/runner.js"]\n`;
}
