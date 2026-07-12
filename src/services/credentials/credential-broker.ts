import { randomUUID } from "node:crypto";
import type { AutomationCredentialMetadata, CreateAutomationCredentialInput, CredentialBackendHealth, CredentialResolutionRequest, ResolvedCredential } from "../../contracts/automation-credential-types.js";
import type { AutomationCredentialRepository } from "../../repositories/automation-credential-repository.js";
import type { KeyProvider } from "./key-provider.js";
import type { SecretStore } from "./secret-store.js";
import type { AutomationAuditExportService } from "../automation-audit-export-service.js";

export class CredentialAccessDeniedError extends Error {
  constructor(message: string) { super(message); this.name = "CredentialAccessDeniedError"; }
}

export class CredentialBroker {
  constructor(private readonly repository: AutomationCredentialRepository, private readonly secretStore: SecretStore, private readonly keyProvider: KeyProvider, private readonly auditService?: AutomationAuditExportService) {}

  health(): Promise<CredentialBackendHealth> { return this.keyProvider.health(); }
  list(projectId: string): AutomationCredentialMetadata[] { return this.repository.list(projectId); }

  async create(projectId: string, input: CreateAutomationCredentialInput): Promise<AutomationCredentialMetadata> {
    this.repository.requireProject(projectId);
    const name=input.name?.trim(); const kind=input.kind?.trim(); const value=input.value;
    if (!name || !kind || typeof value !== "string" || value.length === 0) throw new Error("name, kind, and a non-empty value are required.");
    const scope=input.scope ?? "project";
    const allowedProjectIds=scope === "global" ? [...new Set(input.allowedProjectIds ?? [])] : [];
    if (scope === "global" && !allowedProjectIds.includes(projectId)) throw new Error("Global credentials require an explicit allowlist containing the configuring project.");
    const health=await this.keyProvider.health();
    if (!health.available || !health.secure || !health.keyId || health.keyVersion === null) throw new Error(health.reason ?? "Secure credential storage is unavailable.");
    const id=randomUUID();
    const metadata=this.repository.create({id,name,kind,scope,projectId:scope === "project" ? projectId:null,allowedProjectIds,capabilities:[...new Set(input.capabilities ?? [])],keyId:health.keyId,keyVersion:health.keyVersion});
    const plaintext=Buffer.from(value,"utf8");
    try { await this.secretStore.put(this.context(metadata),plaintext); }
    catch (error) { this.repository.updateStatus(id,"unavailable"); throw error; }
    finally { plaintext.fill(0); }
    return this.repository.get(id)!;
  }

  bind(projectId: string, credentialId: string, bindingKey: string, capabilities: string[]) {
    const credential=this.requireAccessible(projectId,credentialId);
    if (credential.status !== "active") throw new CredentialAccessDeniedError("Only active credentials can be bound.");
    const required=[...new Set(capabilities)];
    if (required.some((capability)=>!credential.capabilities.includes(capability))) throw new CredentialAccessDeniedError("Binding requests capabilities the credential does not grant.");
    return this.repository.bind(credentialId,projectId,bindingKey.trim(),required);
  }

  async test(projectId: string, credentialId: string): Promise<AutomationCredentialMetadata> {
    const credential=this.requireAccessible(projectId,credentialId);
    try { const plaintext=await this.secretStore.get(this.context(credential)); plaintext.fill(0); return this.repository.updateValidation(credentialId,"valid"); }
    catch { this.repository.updateValidation(credentialId,"invalid"); throw new Error("Credential validation failed."); }
  }

  async rotate(projectId: string, credentialId: string, value: string): Promise<AutomationCredentialMetadata> { return this.replaceValue(projectId,credentialId,value,true); }
  async replace(projectId: string, credentialId: string, value: string): Promise<AutomationCredentialMetadata> { return this.replaceValue(projectId,credentialId,value,false); }
  revoke(projectId: string, credentialId: string): AutomationCredentialMetadata { this.requireAccessible(projectId,credentialId); return this.repository.updateStatus(credentialId,"revoked"); }
  async promote(projectId: string, credentialId: string, allowedProjectIds: string[]): Promise<AutomationCredentialMetadata> { const credential=this.requireAccessible(projectId,credentialId); if (credential.scope !== "project" || credential.projectId !== projectId) throw new CredentialAccessDeniedError("Only the owning project can promote this credential."); if (!allowedProjectIds.includes(projectId)) throw new Error("The global allowlist must retain the owning project."); const plaintext=await this.secretStore.get(this.context(credential)); const promoted=this.repository.promote(credentialId,[...new Set(allowedProjectIds)]); try { await this.secretStore.put(this.context(promoted),plaintext); return this.repository.get(credentialId)!; } catch(error){this.repository.updateStatus(credentialId,"unavailable");throw error;} finally { plaintext.fill(0); } }
  restrict(projectId: string, credentialId: string, allowedProjectIds: string[], capabilities: string[]): AutomationCredentialMetadata { const credential=this.requireAccessible(projectId,credentialId); if (credential.scope === "global" && !allowedProjectIds.includes(projectId)) throw new Error("The configuring project must remain allowlisted."); return this.repository.restrict(credentialId,[...new Set(allowedProjectIds)],[...new Set(capabilities)]); }

  async resolve(request: CredentialResolutionRequest): Promise<ResolvedCredential> {
    const binding=this.repository.getBinding(request.projectId,request.bindingKey);
    if (!binding) return this.deny(request,null,"No credential binding exists.");
    const credential=this.repository.get(binding.credentialId);
    if (!credential) return this.deny(request,binding.credentialId,"Bound credential is missing.");
    if (!this.canAccess(credential,request.projectId)) return this.deny(request,credential.id,"Credential is outside the project scope.");
    if (credential.status !== "active") return this.deny(request,credential.id,"Credential is not active.");
    if (!credential.capabilities.includes(request.capability) || !binding.requiredCapabilities.includes(request.capability)) return this.deny(request,credential.id,"Required capability is not approved.");
    try {
      const secret=await this.secretStore.get(this.context(credential)); const value=secret.toString("utf8"); secret.fill(0);
      this.repository.recordAccess({credentialId:credential.id,projectId:request.projectId,bindingKey:request.bindingKey,capability:request.capability,operation:"resolve",outcome:"granted",reason:null});
      this.auditService?.recordSystem({ action: "credential.access", resourceType: "automation_credential", resourceId: credential.id, projectId: request.projectId, outcome: "succeeded", metadata: { bindingKey: request.bindingKey, capability: request.capability, credentialVersion: credential.version } });
      return {credentialId:credential.id,value,version:credential.version};
    } catch { return this.deny(request,credential.id,"Credential backend is unavailable or authentication failed."); }
  }

  async resolveCredentialId(request: CredentialResolutionRequest & { credentialId: string }): Promise<ResolvedCredential> {
    const credential=this.repository.get(request.credentialId);
    if (!credential) return this.deny(request,request.credentialId,"Credential is missing.");
    if (!this.canAccess(credential,request.projectId)) return this.deny(request,credential.id,"Credential is outside the project scope.");
    if (credential.status !== "active") return this.deny(request,credential.id,"Credential is not active.");
    if (!credential.capabilities.includes(request.capability)) return this.deny(request,credential.id,"Required capability is not approved.");
    try {
      const secret=await this.secretStore.get(this.context(credential)); const value=secret.toString("utf8"); secret.fill(0);
      this.repository.recordAccess({credentialId:credential.id,projectId:request.projectId,bindingKey:request.bindingKey,capability:request.capability,operation:"resolve",outcome:"granted",reason:null});
      this.auditService?.recordSystem({ action: "credential.access", resourceType: "automation_credential", resourceId: credential.id, projectId: request.projectId, outcome: "succeeded", metadata: { bindingKey: request.bindingKey, capability: request.capability, credentialVersion: credential.version } });
      return {credentialId:credential.id,value,version:credential.version};
    } catch { return this.deny(request,credential.id,"Credential backend is unavailable or authentication failed."); }
  }

  private async replaceValue(projectId:string,credentialId:string,value:string,rotation:boolean):Promise<AutomationCredentialMetadata>{ const credential=this.requireAccessible(projectId,credentialId); if (!value) throw new Error("A non-empty replacement value is required."); const plaintext=Buffer.from(value,"utf8"); try { const envelope=await this.secretStore.put(this.context(credential),plaintext); const next=this.repository.updateSecretMetadata(credentialId,envelope.keyId,envelope.keyVersion,credential.version+1); if(rotation)this.repository.recordRotation({credentialId,fromVersion:credential.version,toVersion:next.version,keyId:envelope.keyId,keyVersion:envelope.keyVersion}); return next; } finally { plaintext.fill(0); } }
  private context(credential:AutomationCredentialMetadata){ return {credentialId:credential.id,projectId:credential.projectId ?? "global",workspaceId:credential.projectId ?? "global"}; }
  private canAccess(credential:AutomationCredentialMetadata,projectId:string):boolean{return credential.scope === "project" ? credential.projectId === projectId : credential.allowedProjectIds.includes(projectId);}
  private requireAccessible(projectId:string,credentialId:string):AutomationCredentialMetadata{this.repository.requireProject(projectId);const credential=this.repository.get(credentialId);if(!credential||!this.canAccess(credential,projectId))throw new CredentialAccessDeniedError("Credential is not available to this project.");return credential;}
  private deny(request:CredentialResolutionRequest,credentialId:string|null,reason:string):never{this.repository.recordAccess({credentialId,projectId:request.projectId,bindingKey:request.bindingKey,capability:request.capability,operation:"resolve",outcome:"denied",reason});this.auditService?.recordSystem({action:"credential.access",resourceType:"automation_credential",resourceId:credentialId,projectId:request.projectId,outcome:"denied",metadata:{bindingKey:request.bindingKey,capability:request.capability,reason}});throw new CredentialAccessDeniedError(reason);}
}
