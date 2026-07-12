import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  CustomNodeArtifact,
  CustomNodeExecutionRequest,
  CustomNodeExecutionResult,
  CustomNodeManifest,
} from "../../contracts/custom-node-types.js";
import type { NodeFlowJsonObject, NodeFlowJsonValue, NodeFlowValueSchema } from "../../contracts/node-flow-types.js";
import type { CustomNodeRepository } from "../../repositories/custom-node-repository.js";
import { EntityNotFoundError, ValidationError } from "../../repositories/repository-utils.js";
import { DOCKER_DROP_ALL_CAPS_ARGS, DOCKER_NETWORK_NONE_ARGS, DOCKER_NO_NEW_PRIVILEGES_ARGS } from "../cli-docker-utils.js";
import { runCommandStrict, type CommandResult } from "../cli-process-runner.js";
import type { CredentialBroker } from "../credentials/credential-broker.js";
import type { EgressPolicyService } from "../node-flows/egress-policy-service.js";

export const CUSTOM_NODE_CONTAINER_SCRATCH = "/tmp/codeux";

export interface CustomNodeDockerPlanInput {
  artifact: CustomNodeArtifact;
  containerName: string;
  seccompProfile?: string;
  appArmorProfile?: string;
}

export function buildCustomNodeDockerRunArgs(input: CustomNodeDockerPlanInput): string[] {
  const limits = input.artifact.manifest.resources;
  const args = [
    "run", "--rm", "-i", "--name", input.containerName,
    ...DOCKER_NETWORK_NONE_ARGS,
    ...DOCKER_NO_NEW_PRIVILEGES_ARGS,
    ...DOCKER_DROP_ALL_CAPS_ARGS,
    "--read-only",
    "--user", "65532:65532",
    "--pids-limit", String(limits.pids),
    "--memory", `${limits.memoryMb}m`,
    "--memory-swap", `${limits.memoryMb}m`,
    "--cpus", String(limits.cpu),
    "--tmpfs", `${CUSTOM_NODE_CONTAINER_SCRATCH}:rw,nosuid,nodev,noexec,size=${limits.scratchMb}m,mode=700,uid=65532,gid=65532`,
    "--log-driver", "none",
    "--label", "code-ux.managed=true",
    "--label", "code-ux.custom-node=true",
    "--label", `code-ux.custom-node-digest=${input.artifact.digest}`,
  ];
  if (input.seccompProfile) args.push("--security-opt", `seccomp=${input.seccompProfile}`);
  if (input.appArmorProfile) args.push("--security-opt", `apparmor=${input.appArmorProfile}`);
  args.push(input.artifact.runtimeImageDigest);
  return args;
}

export interface CustomNodeRuntimeServiceDeps {
  repository: CustomNodeRepository;
  credentialBroker: CredentialBroker;
  egressPolicyService: EgressPolicyService;
  featureEnabled?: boolean;
  commandRunner?: (command: string, args: string[], cwd: string, options: { signal?: AbortSignal; timeout: number; maxStdoutChars: number; stdinFile?: string }) => Promise<CommandResult>;
  seccompProfile?: string;
  appArmorProfile?: string;
}

export class CustomNodeRuntimeService {
  constructor(private readonly deps: CustomNodeRuntimeServiceDeps) {}

  async execute(request: CustomNodeExecutionRequest): Promise<CustomNodeExecutionResult> {
    if (!(this.deps.featureEnabled ?? process.env.CODE_UX_CUSTOM_NODES_ENABLED === "true")) {
      throw new ValidationError("Custom node execution is disabled by the custom-node feature gate.");
    }
    const resolved = this.deps.repository.resolvePublished(request.nodeType, request.version);
    if (!resolved || resolved.publication.projectId !== request.projectId) {
      throw new EntityNotFoundError(`Published custom node not found: ${request.nodeType}@${request.version}`);
    }
    const { artifact } = resolved;
    await this.validateDeclaredEgress(artifact.manifest);
    const credentials = await this.resolveCredentials(artifact.manifest, request);
    const secrets = Object.values(credentials);
    const runDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-custom-node-run-"));
    try {
      if (process.platform !== "win32") await fs.chmod(runDirectory, 0o700);
      const envelope = {
        input: request.input,
        config: request.config,
        correlationId: request.correlationId,
        invocationId: request.invocationId,
        credentials,
        now: new Date().toISOString(),
      };
      const inputPath = path.join(runDirectory, "input.json");
      await fs.writeFile(inputPath, JSON.stringify(envelope), { mode: 0o600 });
      if (process.platform !== "win32") await fs.chmod(inputPath, 0o600);
      const dockerArgs = buildCustomNodeDockerRunArgs({
        artifact,
        containerName: containerName(request.invocationId),
        seccompProfile: this.deps.seccompProfile,
        appArmorProfile: this.deps.appArmorProfile,
      });
      const runner = this.deps.commandRunner ?? (async (command, args, cwd, options) => runCommandStrict(command, args, cwd, process.env, options));
      const result = await runner("docker", dockerArgs, process.cwd(), {
        signal: request.signal,
        timeout: artifact.manifest.resources.timeoutMs,
        maxStdoutChars: artifact.manifest.resources.maxOutputBytes,
        stdinFile: inputPath,
      });
      const rawOutput = result.stdout;
      if (Buffer.byteLength(rawOutput) > artifact.manifest.resources.maxOutputBytes) throw new ValidationError("Custom node output exceeded its declared limit.");
      let output: unknown;
      try { output = JSON.parse(rawOutput); } catch { throw new ValidationError("Custom node did not produce valid JSON output."); }
      const schemaIssues = validateValueAgainstSchema(output, artifact.manifest.outputSchema, "output");
      if (schemaIssues.length > 0) throw new ValidationError(`Custom node output schema validation failed: ${schemaIssues[0]}`);
      const safeOutput = redactJson(output as NodeFlowJsonValue, secrets);
      if (!isObject(safeOutput)) throw new ValidationError("Custom node output must be a JSON object.");
      return {
        output: safeOutput,
        artifactDigest: artifact.digest,
        logs: redactSecrets(result.stderr, secrets),
        diagnostics: JSON.stringify(safeOutput),
      };
    } finally {
      for (const key of Object.keys(credentials)) credentials[key] = "";
      await fs.rm(runDirectory, { recursive: true, force: true });
    }
  }

  private async resolveCredentials(manifest: CustomNodeManifest, request: CustomNodeExecutionRequest): Promise<Record<string, string>> {
    const resolved: Record<string, string> = {};
    for (const slot of manifest.credentials) {
      const bindingKey = request.credentialBindings[slot.slot];
      if (!bindingKey) {
        if (slot.required) throw new ValidationError(`Required custom node credential slot is not bound: ${slot.slot}`);
        continue;
      }
      const credential = await this.deps.credentialBroker.resolveCredentialId({
        projectId: request.projectId,
        bindingKey,
        credentialId: bindingKey,
        capability: slot.requiredCapability,
        workspaceId: request.workspaceId,
      });
      resolved[slot.slot] = credential.value;
    }
    return resolved;
  }

  private async validateDeclaredEgress(manifest: CustomNodeManifest): Promise<void> {
    if (!manifest.capabilities.includes("network.http")) return;
    if (!manifest.http) throw new ValidationError("Published custom node is missing its bounded HTTP policy.");
    for (const host of manifest.http.allowedHosts) {
      await this.deps.egressPolicyService.validateUrl(`https://${host}`, {
        allowedHosts: manifest.http.allowedHosts,
        allowedPorts: manifest.http.allowedPorts ?? [443],
        timeoutMs: manifest.http.timeoutMs,
        maxResponseBytes: manifest.http.maxResponseBytes,
        requestsPerMinute: manifest.http.maxRequests,
      });
    }
  }
}

function containerName(invocationId: string): string {
  return `code-ux-custom-node-${invocationId.toLowerCase().replace(/[^a-z0-9_.-]/g, "-").slice(0, 48)}`;
}

export function validateValueAgainstSchema(value: unknown, schema: NodeFlowValueSchema, field: string): string[] {
  if (schema.type === "any") return [];
  if (schema.type === "null") return value === null ? [] : [`${field} must be null`];
  if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${field} must be an array`];
    return schema.items ? value.flatMap((item, index) => validateValueAgainstSchema(item, schema.items!, `${field}[${index}]`)) : [];
  }
  if (schema.type === "object") {
    if (!isObject(value)) return [`${field} must be an object`];
    const issues = (schema.required ?? []).filter((key) => !(key in value)).map((key) => `${field}.${key} is required`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) issues.push(...validateValueAgainstSchema(value[key], child, `${field}.${key}`));
    }
    return issues;
  }
  return typeof value === schema.type ? [] : [`${field} must be ${schema.type}`];
}

export function redactSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) if (secret) redacted = redacted.split(secret).join("[REDACTED]");
  return redacted;
}

function redactJson(value: NodeFlowJsonValue, secrets: readonly string[]): NodeFlowJsonValue {
  if (typeof value === "string") return redactSecrets(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redactJson(entry, secrets));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactJson(entry as NodeFlowJsonValue, secrets)]));
  return value;
}

function isObject(value: unknown): value is NodeFlowJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
