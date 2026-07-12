import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptEnvelope, encryptEnvelope } from "../../../src/services/credentials/encryption-utils.js";

const context={credentialId:"credential-1",projectId:"project-1",workspaceId:"workspace-1"};
const root={key:Buffer.alloc(32,7),keyId:"root",version:1};

describe("credential envelope encryption",()=>{
  it("round trips with unique payload and wrap nonces",()=>{const first=encryptEnvelope(context,Buffer.from("secret"),root);const second=encryptEnvelope(context,Buffer.from("secret"),root);expect(decryptEnvelope(context,first,root).toString()).toBe("secret");expect(first.nonce.equals(second.nonce)).toBe(false);expect(first.wrapNonce.equals(second.wrapNonce)).toBe(false);expect(first.ciphertext.toString("utf8")).not.toContain("secret");});
  it.each(["ciphertext","authTag","wrappedDataKey","wrapAuthTag"] as const)("rejects %s tampering",(field)=>{const envelope=encryptEnvelope(context,Buffer.from("secret"),root);envelope[field][0]^=1;expect(()=>decryptEnvelope(context,envelope,root)).toThrow();});
  it("rejects wrong keys and authenticated context",()=>{const envelope=encryptEnvelope(context,Buffer.from("secret"),root);expect(()=>decryptEnvelope(context,envelope,{...root,key:randomBytes(32)})).toThrow();expect(()=>decryptEnvelope({...context,workspaceId:"other"},envelope,root)).toThrow();});
});
