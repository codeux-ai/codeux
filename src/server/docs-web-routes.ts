import type { Express } from "express";
import { DocsWebCatalogService } from "../services/docs-web-catalog-service.js";
import { syncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";

export function registerDocsWebRoutes(app: Express, service = new DocsWebCatalogService()): void {
  app.get("/api/docs-web", syncRoute((_req, res) => {
    res.json(service.getCollection());
  }));

  app.get("/api/docs-web/:docId", syncRoute((req, res) => {
    const docId = requireTrimmedString(req.params.docId, "docId");
    const doc = service.getDocument(docId);
    if (!doc) {
      res.status(404).json({ error: `Documentation page "${docId}" was not found.` });
      return;
    }
    res.json({ doc });
  }));
}
