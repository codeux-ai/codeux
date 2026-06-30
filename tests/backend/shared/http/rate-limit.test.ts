import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { createHttpRateLimiter } from "../../../../src/shared/http/rate-limit.js";

describe("createHttpRateLimiter", () => {
  it("allows requests under the limit and 429s once the limit is exceeded", async () => {
    const app = express();
    app.use(createHttpRateLimiter({ windowMs: 60_000, max: 3 }));
    app.get("/x", (_req, res) => res.status(200).send("ok"));

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).get("/x");
      expect(ok.status).toBe(200);
    }

    const limited = await request(app).get("/x");
    expect(limited.status).toBe(429);
  });

  it("emits standard RateLimit headers and not legacy ones", async () => {
    const app = express();
    app.use(createHttpRateLimiter({ windowMs: 60_000, max: 5 }));
    app.get("/y", (_req, res) => res.status(200).send("ok"));

    const res = await request(app).get("/y");
    expect(res.headers["ratelimit-limit"] ?? res.headers["ratelimit"]).toBeDefined();
    expect(res.headers["x-ratelimit-limit"]).toBeUndefined();
  });
});
