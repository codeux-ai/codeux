import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createPreviewHostMiddleware } from "../../../src/server/preview-host-middleware.js";
import type { DashboardServerOptions } from "../../../src/server/dashboard-server.js";
import type { AddressInfo } from "node:net";

function getServerPort(server: { address(): string | AddressInfo | null }): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to be listening on a TCP port");
  }
  return address.port;
}

describe("preview-host-middleware", () => {
  it("rejects hostile origin for preview control paths with 403", async () => {
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue({
        id: "session-1",
        projectId: "proj-1",
        sprintId: "sprint-1",
        status: "running",
        hostPort: 3000,
      }),
      startSprintPreviewSession: vi.fn(),
      rebuildSprintPreviewSession: vi.fn(),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .post("/_code_ux/preview-start")
      .set("Host", "preview-session-1.localhost:4444")
      .set("Origin", "http://evil.com");

    expect(res.status).toBe(403);
    expect(res.text).toContain("Forbidden");
    expect(res.headers["access-control-allow-origin"]).not.toBe("http://evil.com");
  });

  it("allows same-preview-origin for preview control paths", async () => {
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue({
        id: "session-1",
        projectId: "proj-1",
        sprintId: "sprint-1",
        status: "running",
        hostPort: 3000,
      }),
      startSprintPreviewSession: vi.fn().mockResolvedValue({}),
      rebuildSprintPreviewSession: vi.fn(),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .post("/_code_ux/preview-start")
      .set("Host", "preview-session-1.localhost:4444")
      .set("Origin", "http://preview-session-1.localhost:4444");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://preview-session-1.localhost:4444");
  });

  it("allows dashboard-origin for preview control paths", async () => {
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue({
        id: "session-1",
        projectId: "proj-1",
        sprintId: "sprint-1",
        status: "running",
        hostPort: 3000,
      }),
      startSprintPreviewSession: vi.fn().mockResolvedValue({}),
      rebuildSprintPreviewSession: vi.fn(),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .post("/_code_ux/preview-start")
      .set("Host", "preview-session-1.localhost:4444")
      .set("Origin", "http://localhost:4444");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:4444");
  });

  it("returns 404 for preview control paths when the host session does not resolve", async () => {
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue(null),
      startSprintPreviewSession: vi.fn(),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .get("/_code_ux/preview-status")
      .set("Host", "preview-foreign-session.localhost:4444")
      .set("Origin", "http://preview-foreign-session.localhost:4444");

    expect(res.status).toBe(404);
    expect(res.text).toContain("Sprint preview session is unavailable.");
  });

  it("rebuilds preview-host controls through the resolved project and sprint scope", async () => {
    const session = {
      id: "session-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      status: "running",
      hostPort: 3000,
    };
    const rebuildSprintPreviewSessionForProjectSprint = vi.fn().mockResolvedValue(session);
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue(session),
      rebuildSprintPreviewSessionForProjectSprint,
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .post("/_code_ux/preview-rebuild")
      .set("Host", "preview-session-1.localhost:4444")
      .set("Origin", "http://preview-session-1.localhost:4444");

    expect(res.status).toBe(200);
    expect(rebuildSprintPreviewSessionForProjectSprint).toHaveBeenCalledWith("proj-1", "sprint-1", "session-1");
  });

  it("allows canonical same-origin control requests with origin path syntax", async () => {
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue({
        id: "session-1",
        projectId: "proj-1",
        sprintId: "sprint-1",
        status: "running",
        hostPort: 3000,
      }),
      startSprintPreviewSession: vi.fn().mockResolvedValue({}),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const res = await request(app)
      .post("/_code_ux/preview-start")
      .set("Host", "preview-session-1.localhost:4444")
      .set("Origin", "http://preview-session-1.localhost:4444/some/path");

    expect(res.status).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://preview-session-1.localhost:4444");
  });

  it("rejects request if body exceeds PREVIEW_MAX_REQUEST_BODY_BYTES", async () => {
    const session = {
      id: "session-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      status: "running",
      hostPort: 0,
    };
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue(session),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const http = await import("http");
    const server = http.createServer((req, res) => {
      req.on('data', () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    session.hostPort = getServerPort(server);

    const appServer = app.listen(0);
    await new Promise<void>(resolve => appServer.on('listening', resolve));
    const appPort = getServerPort(appServer);

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: appPort,
          method: 'POST',
          path: '/upload',
          headers: { 'Host': 'preview-session-1.localhost:4444' }
        }, (res) => {
          if (res.statusCode === 413) {
            resolve();
          } else {
            reject(new Error(`Expected 413, got ${res.statusCode}`));
          }
        });

        req.on('error', (e) => {
           if (e.message.includes('socket hang up') || (e as any).code === 'ECONNRESET') {
              resolve();
           } else {
              reject(e);
           }
        });

        const chunk = Buffer.alloc(1024 * 1024, 'a');
        let i = 0;
        const writeNext = () => {
          if (i < 6) {
             i++;
             req.write(chunk, (err) => {
               if (err) return;
               setTimeout(writeNext, 10);
             });
          } else {
             req.end();
          }
        };
        writeNext();
      });
    } finally {
      server.close();
      appServer.close();
    }
  });

  it("rejects response if HTML exceeds PREVIEW_MAX_STREAMED_HTML_BYTES", async () => {
    const session = {
      id: "session-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      status: "running",
      hostPort: 0,
    };
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue(session),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const http = await import("http");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB chunk

      let i = 0;
      const writeNext = () => {
        if (i < 6) {
           i++;
           res.write(chunk, (err) => {
             if (!err) setTimeout(writeNext, 10);
           });
        } else {
           res.end();
        }
      };
      writeNext();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    session.hostPort = getServerPort(server);

    const appServer = app.listen(0);
    await new Promise<void>(resolve => appServer.on('listening', resolve));
    const appPort = getServerPort(appServer);

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: appPort,
          method: 'GET',
          path: '/something',
          headers: { 'Host': 'preview-session-1.localhost:4444' }
        }, (res) => {
          if (res.statusCode === 502) {
            resolve();
          } else {
            reject(new Error(`Expected 502, got ${res.statusCode}`));
          }
        });
        req.on('error', (e) => {
           if (e.message.includes('socket hang up') || (e as any).code === 'ECONNRESET') {
              resolve();
           } else {
              reject(e);
           }
        });
        req.end();
      });
    } finally {
      server.close();
      appServer.close();
    }
  });

  it("rejects response if binary exceeds PREVIEW_MAX_BUFFERED_RESPONSE_BYTES", async () => {
    const session = {
      id: "session-1",
      projectId: "proj-1",
      sprintId: "sprint-1",
      status: "running",
      hostPort: 0,
    };
    const options = {
      getSprintPreviewSession: vi.fn().mockResolvedValue(session),
    } as unknown as DashboardServerOptions;

    const app = express();
    app.use(createPreviewHostMiddleware(options));

    const http = await import("http");
    const server = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      const chunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB chunk

      let i = 0;
      const writeNext = () => {
        if (i < 6) {
           i++;
           res.write(chunk, (err) => {
             if (!err) setTimeout(writeNext, 10);
           });
        } else {
           res.end();
        }
      };
      writeNext();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    session.hostPort = getServerPort(server);

    const appServer = app.listen(0);
    await new Promise<void>(resolve => appServer.on('listening', resolve));
    const appPort = getServerPort(appServer);

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: appPort,
          method: 'GET',
          path: '/something.bin',
          headers: { 'Host': 'preview-session-1.localhost:4444' }
        }, (res) => {
          // It streams, so we'll receive 200 initially, then it will get an error/close mid-stream.
          let received = 0;
          res.on('data', (chunk) => {
             received += chunk.length;
          });
          res.on('end', () => {
             // connection ends prematurely
             if (received < 6 * 1024 * 1024) {
               resolve();
             } else {
               reject(new Error("Expected connection to be destroyed before full file download"));
             }
          });
          res.on('error', () => {
             resolve();
          });
        });
        req.on('error', (e) => {
           if (e.message.includes('socket hang up') || (e as any).code === 'ECONNRESET') {
              resolve();
           } else {
              reject(e);
           }
        });
        req.end();
      });
    } finally {
      server.close();
      appServer.close();
    }
  });
});
