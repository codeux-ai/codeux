import { randomUUID } from "node:crypto";
import type { AutomationCredentialAccessEvent, AutomationCredentialBinding, AutomationCredentialMetadata, AutomationCredentialRotation, AutomationCredentialScope, AutomationCredentialStatus } from "../contracts/automation-credential-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, ValidationError, toNumber } from "./repository-utils.js";
import type { StoredSecretEnvelope } from "../services/credentials/secret-store.js";

interface CredentialRow { id: string; name: string; kind: string; scope: AutomationCredentialScope; project_id: string | null; allowed_project_ids_json: string; capabilities_json: string; status: AutomationCredentialStatus; key_id: string; key_version: number; version: number; last_validated_at: string | null; validation_status: AutomationCredentialMetadata["validationStatus"]; created_at: string; updated_at: string; configured?: number }
interface SecretRow { credential_id: string; ciphertext: Buffer; nonce: Buffer; auth_tag: Buffer; wrapped_data_key: Buffer; wrap_nonce: Buffer; wrap_auth_tag: Buffer; key_id: string; key_version: number }
interface BindingRow { id: string; credential_id: string; project_id: string; binding_key: string; required_capabilities_json: string; created_at: string; updated_at: string }

export class AutomationCredentialRepository {
  private readonly db: DatabaseAdapter;
  constructor(storage: AppDbStorage = new AppDbStorage()) { this.db = storage.getDatabase(); }

  requireProject(projectId: string): void {
    if (!this.db.prepare("SELECT id FROM projects WHERE id = ?").get(projectId)) throw new EntityNotFoundError(`Project not found: ${projectId}`);
  }

  countEncryptedSecrets(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM automation_credential_secrets").get() as { count?: number | bigint } | undefined;
    return Number(row?.count ?? 0);
  }

  list(projectId: string): AutomationCredentialMetadata[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`SELECT c.*, EXISTS(SELECT 1 FROM automation_credential_secrets s WHERE s.credential_id=c.id) AS configured FROM automation_credentials c WHERE c.project_id = ? OR (c.scope = 'global' AND EXISTS (SELECT 1 FROM json_each(c.allowed_project_ids_json) WHERE value = ?)) ORDER BY c.updated_at DESC`).all(projectId, projectId) as CredentialRow[];
    return rows.map((row) => this.mapCredential(row));
  }

  get(id: string): AutomationCredentialMetadata | null {
    const row = this.db.prepare("SELECT c.*, EXISTS(SELECT 1 FROM automation_credential_secrets s WHERE s.credential_id=c.id) AS configured FROM automation_credentials c WHERE c.id = ?").get(id) as CredentialRow | undefined;
    return row ? this.mapCredential(row) : null;
  }

  create(input: { id?: string; name: string; kind: string; scope: AutomationCredentialScope; projectId: string | null; allowedProjectIds: string[]; capabilities: string[]; keyId: string; keyVersion: number }): AutomationCredentialMetadata {
    if (input.scope === "project" && !input.projectId) throw new ValidationError("Project credentials require a projectId.");
    if (input.scope === "global" && input.projectId) throw new ValidationError("Global credentials cannot have an owning projectId.");
    if (input.projectId) this.requireProject(input.projectId);
    for (const projectId of input.allowedProjectIds) this.requireProject(projectId);
    const id = input.id ?? randomUUID(); const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO automation_credentials (id,name,kind,scope,project_id,allowed_project_ids_json,capabilities_json,status,key_id,key_version,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?,1,?,?)`).run(id, input.name, input.kind, input.scope, input.projectId, JSON.stringify(input.allowedProjectIds), JSON.stringify(input.capabilities), input.keyId, input.keyVersion, now, now);
    return this.get(id)!;
  }

  updateSecretMetadata(id: string, keyId: string, keyVersion: number, version: number): AutomationCredentialMetadata {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE automation_credentials SET key_id=?, key_version=?, version=?, status='active', validation_status='untested', last_validated_at=NULL, updated_at=? WHERE id=?").run(keyId, keyVersion, version, now, id);
    const result = this.get(id); if (!result) throw new EntityNotFoundError(`Credential not found: ${id}`); return result;
  }

  updateStatus(id: string, status: AutomationCredentialStatus): AutomationCredentialMetadata {
    this.db.prepare("UPDATE automation_credentials SET status=?, updated_at=? WHERE id=?").run(status, new Date().toISOString(), id);
    const result = this.get(id); if (!result) throw new EntityNotFoundError(`Credential not found: ${id}`); return result;
  }

  updateValidation(id: string, status: AutomationCredentialMetadata["validationStatus"]): AutomationCredentialMetadata {
    this.db.prepare("UPDATE automation_credentials SET validation_status=?, last_validated_at=?, updated_at=? WHERE id=?").run(status, new Date().toISOString(), new Date().toISOString(), id);
    const result = this.get(id); if (!result) throw new EntityNotFoundError(`Credential not found: ${id}`); return result;
  }

  restrict(id: string, allowedProjectIds: string[], capabilities: string[]): AutomationCredentialMetadata {
    const credential = this.get(id); if (!credential) throw new EntityNotFoundError(`Credential not found: ${id}`);
    for (const projectId of allowedProjectIds) this.requireProject(projectId);
    this.db.prepare("UPDATE automation_credentials SET allowed_project_ids_json=?, capabilities_json=?, updated_at=? WHERE id=?").run(JSON.stringify(allowedProjectIds), JSON.stringify(capabilities), new Date().toISOString(), id);
    return this.get(id)!;
  }

  promote(id: string, allowedProjectIds: string[]): AutomationCredentialMetadata {
    const credential = this.get(id); if (!credential) throw new EntityNotFoundError(`Credential not found: ${id}`);
    for (const projectId of allowedProjectIds) this.requireProject(projectId);
    this.db.prepare("UPDATE automation_credentials SET scope='global', project_id=NULL, allowed_project_ids_json=?, updated_at=? WHERE id=?").run(JSON.stringify(allowedProjectIds), new Date().toISOString(), id);
    return this.get(id)!;
  }

  putEnvelope(envelope: StoredSecretEnvelope): void {
    this.db.prepare(`INSERT INTO automation_credential_secrets (credential_id,ciphertext,nonce,auth_tag,wrapped_data_key,wrap_nonce,wrap_auth_tag,key_id,key_version,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(credential_id) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,auth_tag=excluded.auth_tag,wrapped_data_key=excluded.wrapped_data_key,wrap_nonce=excluded.wrap_nonce,wrap_auth_tag=excluded.wrap_auth_tag,key_id=excluded.key_id,key_version=excluded.key_version,updated_at=excluded.updated_at`).run(envelope.credentialId,envelope.ciphertext,envelope.nonce,envelope.authTag,envelope.wrappedDataKey,envelope.wrapNonce,envelope.wrapAuthTag,envelope.keyId,envelope.keyVersion,new Date().toISOString());
  }
  getEnvelope(credentialId: string): StoredSecretEnvelope | null { const row=this.db.prepare("SELECT * FROM automation_credential_secrets WHERE credential_id=?").get(credentialId) as SecretRow|undefined; return row ? {credentialId:row.credential_id,ciphertext:row.ciphertext,nonce:row.nonce,authTag:row.auth_tag,wrappedDataKey:row.wrapped_data_key,wrapNonce:row.wrap_nonce,wrapAuthTag:row.wrap_auth_tag,keyId:row.key_id,keyVersion:toNumber(row.key_version)} : null; }
  deleteEnvelope(id: string): void { this.db.prepare("DELETE FROM automation_credential_secrets WHERE credential_id=?").run(id); }

  bind(credentialId: string, projectId: string, bindingKey: string, requiredCapabilities: string[]): AutomationCredentialBinding {
    this.requireProject(projectId); const now=new Date().toISOString(); const id=randomUUID();
    this.db.prepare(`INSERT INTO automation_credential_bindings (id,credential_id,project_id,binding_key,required_capabilities_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(project_id,binding_key) DO UPDATE SET credential_id=excluded.credential_id,required_capabilities_json=excluded.required_capabilities_json,updated_at=excluded.updated_at`).run(id,credentialId,projectId,bindingKey,JSON.stringify(requiredCapabilities),now,now);
    return this.getBinding(projectId,bindingKey)!;
  }
  getBinding(projectId: string, bindingKey: string): AutomationCredentialBinding | null { const row=this.db.prepare("SELECT * FROM automation_credential_bindings WHERE project_id=? AND binding_key=?").get(projectId,bindingKey) as BindingRow|undefined; return row ? this.mapBinding(row):null; }
  recordAccess(input: Omit<AutomationCredentialAccessEvent,"id"|"createdAt">): void { this.db.prepare(`INSERT INTO automation_credential_access_events (id,credential_id,project_id,binding_key,capability,operation,outcome,reason,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(randomUUID(),input.credentialId,input.projectId,input.bindingKey,input.capability,input.operation,input.outcome,input.reason,new Date().toISOString()); }
  recordRotation(input: Omit<AutomationCredentialRotation,"id"|"rotatedAt">): void { this.db.prepare(`INSERT INTO automation_credential_rotations (id,credential_id,from_version,to_version,key_id,key_version,rotated_at) VALUES (?,?,?,?,?,?,?)`).run(randomUUID(),input.credentialId,input.fromVersion,input.toVersion,input.keyId,input.keyVersion,new Date().toISOString()); }

  private mapCredential(row: CredentialRow): AutomationCredentialMetadata { return {id:row.id,name:row.name,kind:row.kind,scope:row.scope,projectId:row.project_id,allowedProjectIds:JSON.parse(row.allowed_project_ids_json) as string[],capabilities:JSON.parse(row.capabilities_json) as string[],status:row.status,configured:toNumber(row.configured)===1,keyId:row.key_id,keyVersion:toNumber(row.key_version),version:toNumber(row.version),lastValidatedAt:row.last_validated_at,validationStatus:row.validation_status,createdAt:row.created_at,updatedAt:row.updated_at}; }
  private mapBinding(row: BindingRow): AutomationCredentialBinding { return {id:row.id,credentialId:row.credential_id,projectId:row.project_id,bindingKey:row.binding_key,requiredCapabilities:JSON.parse(row.required_capabilities_json) as string[],createdAt:row.created_at,updatedAt:row.updated_at}; }
}
