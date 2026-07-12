import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import type { CreateAutomationCredentialInput } from "../contracts/automation-credential-types.js";

function broker(deps: DashboardDependencies) { if (!deps.credentialBroker) throw new Error("Credential broker is not enabled."); return deps.credentialBroker; }

export function registerAutomationCredentialRoutes(app: Express,deps:DashboardDependencies):void{
  app.get("/api/credentials/health",asyncRoute(async(_req,res)=>{res.json(await broker(deps).health());}));
  app.get("/api/projects/:projectId/credentials",asyncRoute(async(req,res)=>{res.json(broker(deps).list(requireTrimmedString(req.params.projectId,"projectId")));}));
  app.post("/api/projects/:projectId/credentials",asyncRoute(async(req,res)=>{res.status(201).json(await broker(deps).create(requireTrimmedString(req.params.projectId,"projectId"),req.body as CreateAutomationCredentialInput));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/bind",asyncRoute(async(req,res)=>{const body=req.body as Record<string,unknown>;res.json(broker(deps).bind(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId"),requireTrimmedString(body.bindingKey,"bindingKey"),body.capabilities));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/test",asyncRoute(async(req,res)=>{res.json(await broker(deps).test(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId")));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/rotate",asyncRoute(async(req,res)=>{res.json(await broker(deps).rotate(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId"),requireTrimmedString((req.body as Record<string,unknown>).value,"value")));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/replace",asyncRoute(async(req,res)=>{res.json(await broker(deps).replace(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId"),requireTrimmedString((req.body as Record<string,unknown>).value,"value")));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/revoke",asyncRoute(async(req,res)=>{res.json(broker(deps).revoke(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId")));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/promote",asyncRoute(async(req,res)=>{res.json(await broker(deps).promote(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId"),(req.body as Record<string,unknown>).allowedProjectIds));}));
  app.post("/api/projects/:projectId/credentials/:credentialId/restrict",asyncRoute(async(req,res)=>{const body=req.body as Record<string,unknown>;res.json(broker(deps).restrict(requireTrimmedString(req.params.projectId,"projectId"),requireTrimmedString(req.params.credentialId,"credentialId"),body.allowedProjectIds,body.capabilities));}));
}
