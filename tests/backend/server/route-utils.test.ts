import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { HttpRouteError } from "../../../src/server/http-errors.js";
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
  describe.each([
    {
      name: "syncRoute",
      createRoute: (error: unknown) => syncRoute(() => {
        throw error;
      }),
    },
    {
      name: "asyncRoute",
      createRoute: (error: unknown) => asyncRoute(async () => {
        throw error;
      }),
    },
  ])("$name error mapping", ({ createRoute }) => {
    it.each([
      {
        label: "ValidationError",
        error: new ValidationError("Invalid field"),
        status: 400,
        body: { error: "Invalid field" },
        delegatesToNext: false,
      },
      {
        label: "parser-style Invalid error",
        error: new Error("Invalid stats window"),
        status: 400,
        body: { error: "Invalid stats window" },
        delegatesToNext: false,
      },
      {
        label: "parser-style Missing error",
        error: new Error("Missing required field"),
        status: 400,
        body: { error: "Missing required field" },
        delegatesToNext: false,
      },
      {
        label: "EntityNotFoundError",
        error: new EntityNotFoundError("User not found"),
        status: 404,
        body: { error: "User not found" },
        delegatesToNext: false,
      },
      {
        label: "explicit HttpRouteError",
        error: new HttpRouteError(409, "Conflict while updating route"),
        status: 409,
        body: { error: "Conflict while updating route" },
        delegatesToNext: false,
      },
      {
        label: "unexpected error",
        error: new Error("Database password leaked in stack"),
        status: 500,
        body: { error: "Internal Server Error" },
        delegatesToNext: true,
      },
    ])("maps $label", async ({ error, status, body, delegatesToNext }) => {
      const route = createRoute(error);
      const req = createMockRequest();
      const { res, jsonSpy, statusSpy } = createMockResponse();
      const nextSpy = vi.fn();

      await route(req, res, nextSpy);

      expect(statusSpy).toHaveBeenCalledWith(status);
      expect(jsonSpy).toHaveBeenCalledWith(body);
      if (delegatesToNext) {
        expect(nextSpy).toHaveBeenCalledWith(error);
        expect(jsonSpy).not.toHaveBeenCalledWith({ error: (error as Error).message });
      } else {
        expect(nextSpy).not.toHaveBeenCalled();
      }
    });
  });

  describe("syncRoute", () => {
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
