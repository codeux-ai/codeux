import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CustomNodeArtifact,
  CustomNodeCapability,
  CustomNodeDependency,
  CustomNodeManifest,
  CustomNodeValidationCheck,
  CustomNodeValidationIssue,
  CustomNodeValidationReport,
} from "../../contracts/custom-node-types.js";
import { CUSTOM_NODE_SCHEMA_VERSION } from "../../contracts/custom-node-types.js";
import type { CustomNodeRepository } from "../../repositories/custom-node-repository.js";
import { EntityNotFoundError, ValidationError } from "../../repositories/repository-utils.js";
import { customNodeDefinitionFromArtifact } from "../../contracts/custom-node-types.js";
import { registerCustomNodeDefinition } from "../../domain/node-flows/node-definition-registry.js";
import { runCommandStrict, type CommandResult } from "../cli-process-runner.js";
import { createCustomNodeDockerfile, CustomNodeProjectService } from "./custom-node-project-service.js";
import { buildCustomNodeDockerRunArgs, redactSecrets, validateValueAgainstSchema } from "./custom-node-runtime-service.js";

const ALLOWED_CAPABILITIES = new Set<CustomNodeCapability>([
  "network.http", "credentials.read", "temporary-storage.write", "artifacts.write", "clock.read",
]);
const SOURCE_LIMIT_BYTES = 2 * 1024 * 1024;
const FILE_LIMIT = 256;
const PROHIBITED_SOURCE_PATTERNS: Array<{ code: string; pattern: RegExp; message: string }> = [
  { code: "host_filesystem", pattern: /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:node:)?fs(?:\/promises)?["']|process\.cwd|import\.meta\.url/, message: "Host filesystem APIs are prohibited." },
  { code: "host_environment", pattern: /process\.env|process\.argv|process\.execPath/, message: "Host process environment APIs are prohibited." },
  { code: "subprocess", pattern: /["'](?:node:)?child_process["']|\bspawn\s*\(|\bexec(?:File)?\s*\(|\bfork\s*\(/, message: "Subprocess APIs are prohibited." },
  { code: "docker", pattern: /\/var\/run\/docker\.sock|DOCKER_HOST|\bdocker\s+(?:run|exec|build)/i, message: "Docker access is prohibited." },
  { code: "raw_network", pattern: /\bfetch\s*\(|["'](?:node:)?(?:http|https|net|tls|dns)(?:\/promises)?["']|\bWebSocket\b/, message: "Raw network APIs are prohibited; use context.http." },
  { code: "native_escape", pattern: /["'](?:node:)?(?:worker_threads|cluster)["']|\bDeno\.|\bBun\./, message: "Native worker and alternate runtime APIs are prohibited." },
];

export interface CustomNodeAuditResult { passed: boolean; details: string }
export interface ValidateCustomNodeInput {
  projectRoot: string;
  nodeId: string;
  creator: string;
  invocationId: string;
  correlationId: string;
  signal?: AbortSignal;
}

export interface CustomNodeBuildServiceDeps {
  repository: CustomNodeRepository;
  projectService?: CustomNodeProjectService;
  commandRunner?: (command: string, args: string[], cwd: string, options?: { signal?: AbortSignal; timeout?: number; maxStdoutChars?: number; stdinFile?: string }) => Promise<CommandResult>;
  vulnerabilityAudit?: (dependencies: readonly CustomNodeDependency[], signal?: AbortSignal) => Promise<CustomNodeAuditResult>;
  runtimeImage?: string;
}

export class CustomNodeBuildService {
  private readonly projectService: CustomNodeProjectService;

  constructor(private readonly deps: CustomNodeBuildServiceDeps) {
    this.projectService = deps.projectService ?? new CustomNodeProjectService();
  }

  publish(nodeId: string, publishedBy: string): CustomNodeArtifact {
    const publication = this.deps.repository.publish(nodeId, publishedBy);
    const artifact = this.deps.repository.getArtifact(publication.artifactDigest);
    if (!artifact) throw new EntityNotFoundError(`Custom node artifact not found: ${publication.artifactDigest}`);
    registerCustomNodeDefinition(customNodeDefinitionFromArtifact(artifact));
    return artifact;
  }

  registerPublishedDefinitions(): number {
    const published = this.deps.repository.listPublications();
    for (const { artifact } of published) registerCustomNodeDefinition(customNodeDefinitionFromArtifact(artifact));
    return published.length;
  }

  async validateAndBuild(input: ValidateCustomNodeInput): Promise<{ report: CustomNodeValidationReport; artifact: CustomNodeArtifact | null }> {
    const node = this.deps.repository.getNode(input.nodeId);
    if (!node) throw new EntityNotFoundError(`Custom node not found: ${input.nodeId}`);
    const root = this.projectService.resolveNodeRoot(input.projectRoot, input.nodeId);
    this.deps.repository.beginValidation(node.id);
    const started = Date.now();
    const checks: CustomNodeValidationCheck[] = [];
    const issues: CustomNodeValidationIssue[] = [];
    try {
      const bundle = await readSourceBundle(root);
      const manifest = parseManifest(bundle.get("node.json"));
      runCheck("manifest-schema", checks, issues, () => validateManifest(manifest, node.manifest));
      runCheck("prohibited-api-scan", checks, issues, () => scanProhibitedApis(bundle));
      runCheck("capability-comparison", checks, issues, () => compareCapabilities(manifest, bundle));
      const packageJson = parsePackageJson(bundle.get("package.json"));
      const dependencies = dependencyInventory(packageJson);
      runCheck("lockfile-verification", checks, issues, () => verifyLockfile(bundle.get("pnpm-lock.yaml"), dependencies));
      runCheck("trusted-build-recipe", checks, issues, () => {
        if (bundle.get("Dockerfile") !== createCustomNodeDockerfile()) throw new ValidationError("Custom node Dockerfile must match the trusted generated build recipe.");
        if (bundle.get("src/runner.ts") !== this.projectService.generatedRunnerSource()) throw new ValidationError("Custom node runner must match the trusted generated bridge.");
      });
      runCheck("resource-policy", checks, issues, () => validateResourcePolicy(manifest));

      if (issues.length === 0) {
        const auditStarted = Date.now();
        const audit = this.deps.vulnerabilityAudit
          ? await this.deps.vulnerabilityAudit(dependencies, input.signal)
          : { passed: false, details: "The governed vulnerability-audit hook is not configured." };
        checks.push({ name: "vulnerability-audit", passed: audit.passed, durationMs: Date.now() - auditStarted, details: audit.details });
        if (!audit.passed) issues.push({ check: "vulnerability-audit", code: "vulnerability_audit_failed", message: audit.details });
      }

      let runtimeImageDigest = "";
      if (issues.length === 0) {
        const sourceDigest = digestBundle(bundle);
        const tag = `code-ux-custom-node:${sourceDigest.slice("sha256:".length, 28)}`;
        const buildStarted = Date.now();
        try {
          await this.run("docker", ["build", "--pull=false", "--label", `code-ux.custom-node-source=${sourceDigest}`, "-t", tag, "."], root, input.signal, 10 * 60_000);
          const inspect = await this.run("docker", ["image", "inspect", "--format", "{{.Id}}", tag], root, input.signal, 30_000);
          runtimeImageDigest = inspect.stdout.trim();
          if (!/^sha256:[a-f0-9]{64}$/i.test(runtimeImageDigest)) throw new Error("Docker returned a non-content-addressed image id.");
          checks.push({ name: "typescript-and-tests", passed: true, durationMs: Date.now() - buildStarted, details: "Frozen install, typecheck, build, and deterministic tests completed in the image build." });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          checks.push({ name: "typescript-and-tests", passed: false, durationMs: Date.now() - buildStarted, details: message });
          issues.push({ check: "typescript-and-tests", code: "container_build_failed", message });
        }

        if (runtimeImageDigest && issues.length === 0) {
          await this.validateFixture({ root, manifest, runtimeImageDigest, sourceDigest, input, checks, issues });
        }

        if (issues.length === 0) {
          const report = reportFor(checks, issues);
          const artifactSeed = {
            nodeId: node.id, projectId: node.projectId, version: manifest.version,
            sourceRevision: node.sourceRevision, buildDigest: sourceDigest, runtimeImageDigest,
            dependencies, validationReport: report, createdBy: input.creator,
            invocationId: input.invocationId, correlationId: input.correlationId,
            capabilities: manifest.capabilities, manifest,
          };
          const createdAt = new Date().toISOString();
          const digest = `sha256:${createHash("sha256").update(canonicalJson(artifactSeed)).digest("hex")}`;
          const artifact: CustomNodeArtifact = { digest, ...artifactSeed, createdAt };
          this.deps.repository.completeValidation(node.id, report, artifact);
          return { report, artifact };
        }
      }
    } catch (error) {
      issues.push({ check: "validation", code: "validation_error", message: error instanceof Error ? error.message : String(error) });
    }
    const report = reportFor(checks, issues);
    if (checks.length === 0) checks.push({ name: "validation", passed: false, durationMs: Date.now() - started, details: issues[0]?.message });
    this.deps.repository.completeValidation(node.id, report, null);
    return { report, artifact: null };
  }

  private async validateFixture(args: {
    root: string; manifest: CustomNodeManifest; runtimeImageDigest: string; sourceDigest: string;
    input: ValidateCustomNodeInput; checks: CustomNodeValidationCheck[]; issues: CustomNodeValidationIssue[];
  }): Promise<void> {
    const started = Date.now();
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-custom-node-validation-"));
    const canary = `CODEUX_SECRET_CANARY_${args.input.correlationId}`;
    try {
      const fixture = JSON.parse(await fs.readFile(path.join(args.root, "fixtures", "basic.json"), "utf8")) as { input: unknown; config: unknown; output: unknown };
      if (!isObject(fixture.input) || !isObject(fixture.config) || !isObject(fixture.output)) throw new ValidationError("Fixture input, config, and output must be objects.");
      const inputIssues = validateValueAgainstSchema(fixture.input, args.manifest.inputSchema, "fixture.input");
      if (inputIssues.length) throw new ValidationError(inputIssues[0]!);
      const envelope = { input: fixture.input, config: fixture.config, correlationId: args.input.correlationId, invocationId: args.input.invocationId, credentials: { __canary: canary }, now: "2026-01-01T00:00:00.000Z" };
      const inputPath = path.join(runDirectory, "input.json");
      await fs.writeFile(inputPath, JSON.stringify(envelope), { mode: 0o600 });
      if (process.platform !== "win32") await fs.chmod(inputPath, 0o600);
      const artifact = {
        digest: args.sourceDigest, runtimeImageDigest: args.runtimeImageDigest, manifest: args.manifest,
      } as CustomNodeArtifact;
      const plan = buildCustomNodeDockerRunArgs({ artifact, containerName: `code-ux-custom-node-validation-${args.input.nodeId}` });
      const result = await this.run("docker", plan, args.root, args.input.signal, args.manifest.resources.timeoutMs, inputPath);
      const outputText = result.stdout;
      if (Buffer.byteLength(outputText) > args.manifest.resources.maxOutputBytes) throw new ValidationError("Fixture output exceeded the declared limit.");
      const output = JSON.parse(outputText) as unknown;
      const outputIssues = validateValueAgainstSchema(output, args.manifest.outputSchema, "fixture.output");
      if (outputIssues.length) throw new ValidationError(outputIssues[0]!);
      if (canonicalJson(output) !== canonicalJson(fixture.output)) throw new ValidationError("Fixture output did not match the deterministic expected output.");
      const observable = redactSecrets(`${result.stdout}\n${result.stderr}\n${outputText}`, [canary]);
      if (observable.includes(canary)) throw new ValidationError("Secret canary survived output redaction.");
      args.checks.push({ name: "fixture-resource-network-secret", passed: true, durationMs: Date.now() - started, details: "Fixture ran with network-none, bounded resources, an ephemeral scratch/run directory, and secret-canary redaction." });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      args.checks.push({ name: "fixture-resource-network-secret", passed: false, durationMs: Date.now() - started, details: message });
      args.issues.push({ check: "fixture-resource-network-secret", code: "fixture_failed", message });
    } finally {
      await fs.rm(runDirectory, { recursive: true, force: true });
    }
  }

  private async run(command: string, args: string[], cwd: string, signal: AbortSignal | undefined, timeout: number, stdinFile?: string): Promise<CommandResult> {
    const runner = this.deps.commandRunner ?? ((cmd, argv, dir, options) => runCommandStrict(cmd, argv, dir, process.env, options));
    return runner(command, args, cwd, { signal, timeout, maxStdoutChars: 1024 * 1024, stdinFile });
  }
}

async function readSourceBundle(root: string): Promise<Map<string, string>> {
  const bundle = new Map<string, string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (entry.isSymbolicLink()) throw new ValidationError(`Symbolic links are prohibited in custom node packages: ${relative}`);
      if (entry.isDirectory()) {
        if (!new Set(["node_modules", "dist", ".git"]).has(entry.name)) await visit(target);
        continue;
      }
      if (!entry.isFile()) continue;
      if (bundle.size >= FILE_LIMIT) throw new ValidationError("Custom node package contains too many files.");
      const stat = await fs.stat(target);
      if (stat.size > SOURCE_LIMIT_BYTES) throw new ValidationError(`Custom node file is too large: ${relative}`);
      bundle.set(relative, await fs.readFile(target, "utf8"));
    }
  };
  await visit(root);
  for (const required of ["node.json", "package.json", "pnpm-lock.yaml", "tsconfig.json", "Dockerfile", "src/index.ts", "src/sdk.ts", "src/runner.ts", "tests/index.test.ts", "fixtures/basic.json"]) {
    if (!bundle.has(required)) throw new ValidationError(`Custom node package is missing ${required}.`);
  }
  return bundle;
}

function parseManifest(value: string | undefined): CustomNodeManifest {
  if (!value) throw new ValidationError("Custom node manifest is missing.");
  try { return JSON.parse(value) as CustomNodeManifest; } catch { throw new ValidationError("Custom node manifest is invalid JSON."); }
}

function parsePackageJson(value: string | undefined): Record<string, unknown> {
  if (!value) throw new ValidationError("Custom node package metadata is missing.");
  try { const parsed = JSON.parse(value) as unknown; if (isObject(parsed)) return parsed; } catch { /* normalized below */ }
  throw new ValidationError("Custom node package metadata is invalid JSON.");
}

function validateManifest(manifest: CustomNodeManifest, persisted: CustomNodeManifest): void {
  if (manifest.schemaVersion !== CUSTOM_NODE_SCHEMA_VERSION) throw new ValidationError("Unsupported custom node manifest schema version.");
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(manifest.id) || manifest.nodeType !== `custom.${manifest.id}`) throw new ValidationError("Custom node id or type is invalid.");
  if (manifest.id !== persisted.id || manifest.nodeType !== persisted.nodeType || manifest.version !== persisted.version) throw new ValidationError("Filesystem manifest does not match the persisted draft identity.");
  if (!Number.isInteger(manifest.version) || manifest.version < 1 || manifest.entrypoint !== "dist/index.js") throw new ValidationError("Custom node version or entrypoint is invalid.");
  for (const schema of [manifest.inputSchema, manifest.outputSchema, manifest.configurationSchema]) validateSchema(schema);
  const slots = new Set<string>();
  for (const slot of manifest.credentials) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(slot.slot) || slots.has(slot.slot) || !slot.requiredCapability.trim()) throw new ValidationError("Custom node credential slots must be unique and valid.");
    slots.add(slot.slot);
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length || manifest.capabilities.some((capability) => !ALLOWED_CAPABILITIES.has(capability))) throw new ValidationError("Custom node declares an unknown or duplicate capability.");
  if (manifest.http && !manifest.capabilities.includes("network.http")) throw new ValidationError("HTTP policy requires network.http capability.");
  if (manifest.capabilities.includes("network.http") && !manifest.http) throw new ValidationError("network.http capability requires a bounded HTTP policy.");
  if (manifest.credentials.length && !manifest.capabilities.includes("credentials.read")) throw new ValidationError("Credential slots require credentials.read capability.");
}

function validateSchema(schema: unknown): void {
  if (!isObject(schema) || !["any", "object", "array", "string", "number", "boolean", "null"].includes(String(schema.type))) throw new ValidationError("Custom node value schema is invalid.");
  if (schema.type === "object" && schema.properties !== undefined) {
    if (!isObject(schema.properties)) throw new ValidationError("Custom node schema properties must be an object.");
    for (const child of Object.values(schema.properties)) validateSchema(child);
  }
  if (schema.type === "array" && schema.items !== undefined) validateSchema(schema.items);
}

function scanProhibitedApis(bundle: ReadonlyMap<string, string>): void {
  for (const [file, source] of bundle) {
    if (!file.startsWith("src/") || file === "src/sdk.ts" || file === "src/runner.ts") continue;
    for (const rule of PROHIBITED_SOURCE_PATTERNS) if (rule.pattern.test(source)) throw new ValidationError(`${rule.message} (${file}, ${rule.code})`);
  }
}

function compareCapabilities(manifest: CustomNodeManifest, bundle: ReadonlyMap<string, string>): void {
  const source = [...bundle].filter(([file]) => file.startsWith("src/") && !["src/sdk.ts", "src/runner.ts"].includes(file)).map(([, content]) => content).join("\n");
  const inferred = new Set<CustomNodeCapability>();
  if (/context\.http\b/.test(source)) inferred.add("network.http");
  if (/context\.credentials\b/.test(source)) inferred.add("credentials.read");
  if (/context\.temporaryStorage\b/.test(source)) inferred.add("temporary-storage.write");
  if (/context\.artifacts\b/.test(source)) inferred.add("artifacts.write");
  if (/context\.clock\b/.test(source)) inferred.add("clock.read");
  const declared = new Set(manifest.capabilities);
  const missing = [...inferred].filter((capability) => !declared.has(capability));
  const unused = [...declared].filter((capability) => !inferred.has(capability) && capability !== "credentials.read");
  if (missing.length || unused.length) throw new ValidationError(`Declared capabilities must exactly match SDK usage (missing: ${missing.join(", ") || "none"}; unused: ${unused.join(", ") || "none"}).`);
}

function validateResourcePolicy(manifest: CustomNodeManifest): void {
  const { resources } = manifest;
  if (!(resources.cpu >= 0.1 && resources.cpu <= 4)) throw new ValidationError("Custom node CPU limit must be between 0.1 and 4.");
  if (!Number.isInteger(resources.memoryMb) || resources.memoryMb < 32 || resources.memoryMb > 2048) throw new ValidationError("Custom node memory limit must be between 32 and 2048 MiB.");
  if (!Number.isInteger(resources.pids) || resources.pids < 16 || resources.pids > 256) throw new ValidationError("Custom node PID limit must be between 16 and 256.");
  if (!Number.isInteger(resources.timeoutMs) || resources.timeoutMs < 100 || resources.timeoutMs > 120_000) throw new ValidationError("Custom node timeout must be between 100 and 120000ms.");
  if (!Number.isInteger(resources.maxOutputBytes) || resources.maxOutputBytes < 1024 || resources.maxOutputBytes > 2 * 1024 * 1024) throw new ValidationError("Custom node output limit is invalid.");
  if (!Number.isInteger(resources.scratchMb) || resources.scratchMb < 1 || resources.scratchMb > 256) throw new ValidationError("Custom node scratch limit is invalid.");
  if (manifest.http) {
    if (!manifest.http.allowedHosts.length || manifest.http.allowedHosts.some((host) => !/^[a-z0-9.-]+$/i.test(host))) throw new ValidationError("Custom node HTTP hosts must be explicit DNS names.");
    if (manifest.http.allowHttp !== undefined && typeof manifest.http.allowHttp !== "boolean") throw new ValidationError("Custom node HTTP opt-in must be a boolean.");
    if (manifest.http.allowedPorts?.some((port) => !Number.isInteger(port) || port < 1 || port > 65_535)) throw new ValidationError("Custom node HTTP ports must be valid TCP ports.");
    if (manifest.http.allowedContentTypes?.some((contentType) => !/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+)?$/i.test(contentType))) throw new ValidationError("Custom node HTTP content types are invalid.");
    if (manifest.http.maxRedirects !== undefined && (!Number.isInteger(manifest.http.maxRedirects) || manifest.http.maxRedirects < 0 || manifest.http.maxRedirects > 10)) throw new ValidationError("Custom node HTTP redirect limit is invalid.");
    if (manifest.http.maxRetries !== undefined && (!Number.isInteger(manifest.http.maxRetries) || manifest.http.maxRetries < 0 || manifest.http.maxRetries > 5)) throw new ValidationError("Custom node HTTP retry limit is invalid.");
    if (!Number.isInteger(manifest.http.maxRequests) || manifest.http.maxRequests < 1 || manifest.http.maxRequests > 100
      || !Number.isInteger(manifest.http.timeoutMs) || manifest.http.timeoutMs < 1 || manifest.http.timeoutMs > resources.timeoutMs
      || !Number.isInteger(manifest.http.maxResponseBytes) || manifest.http.maxResponseBytes < 1 || manifest.http.maxResponseBytes > resources.maxOutputBytes) {
      throw new ValidationError("Custom node HTTP policy exceeds resource bounds.");
    }
  }
}

function dependencyInventory(packageJson: Record<string, unknown>): CustomNodeDependency[] {
  const result: CustomNodeDependency[] = [];
  for (const field of ["dependencies", "devDependencies"] as const) {
    const dependencies = packageJson[field];
    if (!isObject(dependencies)) continue;
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new ValidationError(`Dependency ${name} must use an exact version.`);
      result.push({ name, version });
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

function verifyLockfile(lockfile: string | undefined, dependencies: readonly CustomNodeDependency[]): void {
  if (!lockfile?.startsWith("lockfileVersion: '9.0'")) throw new ValidationError("A pnpm v9 frozen lockfile is required.");
  for (const dependency of dependencies) {
    if (!lockfile.includes(`specifier: ${dependency.version}`) || !lockfile.includes(`version: ${dependency.version}`)) throw new ValidationError(`Lockfile does not pin ${dependency.name}@${dependency.version}.`);
  }
}

function digestBundle(bundle: ReadonlyMap<string, string>): string {
  const hash = createHash("sha256");
  for (const [file, content] of [...bundle].sort(([left], [right]) => left.localeCompare(right))) hash.update(file).update("\0").update(content).update("\0");
  return `sha256:${hash.digest("hex")}`;
}

function runCheck(name: string, checks: CustomNodeValidationCheck[], issues: CustomNodeValidationIssue[], action: () => void): void {
  const started = Date.now();
  try { action(); checks.push({ name, passed: true, durationMs: Date.now() - started }); }
  catch (error) { const message = error instanceof Error ? error.message : String(error); checks.push({ name, passed: false, durationMs: Date.now() - started, details: message }); issues.push({ check: name, code: `${name.replace(/-/g, "_")}_failed`, message }); }
}

function reportFor(checks: CustomNodeValidationCheck[], issues: CustomNodeValidationIssue[]): CustomNodeValidationReport {
  return { valid: issues.length === 0, checks, issues, validatedAt: new Date().toISOString() };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
