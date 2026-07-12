import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { registerAutomationCredentialRoutes } from "../../../src/server/automation-credential-routes.js";
import { toHttpRouteError } from "../../../src/server/http-errors.js";
import { CredentialAccessDeniedError } from "../../../src/services/credentials/credential-broker.js";
import { CredentialConcurrentModificationError } from "../../../src/repositories/automation-credential-repository.js";

describe("automation credential routes",()=>{
  it("passes secret values only into write operations and returns metadata",async()=>{const metadata={id:"credential-1",name:"Token",kind:"api-token",scope:"project",projectId:"project-1",allowedProjectIds:[],capabilities:["read"],status:"active",configured:true,keyId:"root",keyVersion:1,version:1,lastValidatedAt:null,validationStatus:"untested",createdAt:"now",updatedAt:"now"};const credentialBroker={create:vi.fn().mockResolvedValue(metadata)};const app=express();app.use(express.json());registerAutomationCredentialRoutes(app,{credentialBroker} as any);const response=await request(app).post("/api/projects/project-1/credentials").send({name:"Token",kind:"api-token",value:"super-secret",capabilities:["read"]});expect(response.status).toBe(201);expect(response.body).toEqual(metadata);expect(JSON.stringify(response.body)).not.toContain("super-secret");expect(credentialBroker.create).toHaveBeenCalledWith("project-1",expect.objectContaining({value:"super-secret"}));});

  it("maps credential denials and concurrent writes to explicit HTTP outcomes", () => {
    expect(toHttpRouteError(new CredentialAccessDeniedError("Credential is not managed by this project."))).toMatchObject({ status: 403 });
    expect(toHttpRouteError(new CredentialConcurrentModificationError("Credential changed; retry."))).toMatchObject({ status: 409 });
  });
});
