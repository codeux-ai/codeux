import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { syncRoute, asyncRoute } from "../../../src/server/route-utils.js";
import { EntityNotFoundError, ValidationError } from "../../../src/repositories/repository-utils.js";

function createMockResponse(): { res: Response; jsonSpy: any; statusSpy: any } {
  const jsonSpy = vi.fn();
  const statusSpy = vi.fn().mockReturnValue({ json: jsonSpy });
  const res = {
    headersSent: false,
    status: statusSpy,
    json: jsonSpy,
  } as unknown as Response;
  return { res, jsonSpy, statusSpy };
}

function createMockRequest(): Request {
  return {} as Request;
}

describe("route-utils", () => {
  describe("syncRoute", () => {
    it("handles sync validation failure", () => {
      const handler = () => {
        throw new ValidationError("Invalid field");
      };
      const route = syncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({ error: "Invalid field" });
      expect(nextSpy).not.toHaveBeenCalled();
    });

    it("handles parsing failure", () => {
      const handler = () => {
        throw new Error("Missing required field");
      };
      const route = syncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(400);
      expect(jsonSpy).toHaveBeenCalledWith({ error: "Missing required field" });
      expect(nextSpy).not.toHaveBeenCalled();
    });

    it("handles unexpected sync failure", () => {
      const unexpectedError = new Error("Database explosion");
      const handler = () => {
        throw unexpectedError;
      };
      const route = syncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({ error: "Internal Server Error" });
      expect(nextSpy).toHaveBeenCalledWith(unexpectedError);
    });

    it("handles headers-sent delegation", () => {
      const handler = () => {
        throw new Error("Too late");
      };
      const route = syncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      res.headersSent = true;
      const nextSpy = vi.fn();

      route(req, res, nextSpy);

      expect(statusSpy).not.toHaveBeenCalled();
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(nextSpy).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe("asyncRoute", () => {
    it("handles async not-found failure", async () => {
      const handler = async () => {
        throw new EntityNotFoundError("User not found");
      };
      const route = asyncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      await route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(404);
      expect(jsonSpy).toHaveBeenCalledWith({ error: "User not found" });
      expect(nextSpy).not.toHaveBeenCalled();
    });

    it("handles unexpected async failure", async () => {
      const unexpectedError = new Error("Network timeout");
      const handler = async () => {
        throw unexpectedError;
      };
      const route = asyncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      await route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(500);
      expect(jsonSpy).toHaveBeenCalledWith({ error: "Internal Server Error" });
      expect(nextSpy).toHaveBeenCalledWith(unexpectedError);
    });

    it("handles headers-sent delegation for asyncRoute", async () => {
      const handler = async () => {
        throw new Error("Too late for async");
      };
      const route = asyncRoute(handler);

      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      res.headersSent = true;
      const nextSpy = vi.fn();

      await route(req, res, nextSpy);

      expect(statusSpy).not.toHaveBeenCalled();
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(nextSpy).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
