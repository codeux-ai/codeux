import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (repoRelativePath: string): string => (
  readFileSync(join(process.cwd(), repoRelativePath), "utf8")
);

const mainSource = readSource("dashboard/src/main.tsx");
const prefetchSource = readSource("dashboard/src/v2/router/route-prefetch.ts");
const dashboardMiddlewareSource = readSource("src/server/dashboard-middleware.ts");

const extractCreateRoute = (source: string, symbol: string): string => {
  const start = source.indexOf(`const ${symbol} = createRoute({`);
  expect(start, `${symbol} should be registered with createRoute`).toBeGreaterThanOrEqual(0);

  const end = source.indexOf("\n});", start);
  expect(end, `${symbol} createRoute block should close`).toBeGreaterThan(start);

  return source.slice(start, end);
};

const extractRouteChildren = (source: string): string[] => {
  const start = source.indexOf("rootRoute.addChildren([");
  expect(start, "routeTree should add child routes explicitly").toBeGreaterThanOrEqual(0);

  const openBracket = source.indexOf("[", start);
  const close = source.indexOf("]);", openBracket);
  expect(close, "routeTree child list should close").toBeGreaterThan(openBracket);

  return source
    .slice(openBracket + 1, close)
    .split(",")
    .map((route) => route.trim())
    .filter(Boolean);
};

describe("chat route registration", () => {
  it("lazy-loads the canonical ChatPage module and registers /chat with ChatPage", () => {
    expect(mainSource).toContain('const ChatPage      = lazy(() => import("./v2/ChatPage.js")');
    expect(mainSource).toContain("default: m.ChatPage");

    const chatRoute = extractCreateRoute(mainSource, "chatRoute");
    expect(chatRoute).toContain('path: "/chat"');
    expect(chatRoute).toContain("component: ChatPage");
    expect(chatRoute).not.toContain("DocsWebPage");
    expect(chatRoute).not.toContain('"/docs');
  });

  it("keeps /chat in the route tree before the wildcard route", () => {
    const routeChildren = extractRouteChildren(mainSource);
    const chatRouteIndex = routeChildren.indexOf("chatRoute");
    const notFoundRouteIndex = routeChildren.indexOf("notFoundRoute");

    expect(chatRouteIndex).toBeGreaterThanOrEqual(0);
    expect(notFoundRouteIndex).toBeGreaterThanOrEqual(0);
    expect(chatRouteIndex).toBeLessThan(notFoundRouteIndex);
    expect(routeChildren[routeChildren.length - 1]).toBe("notFoundRoute");
  });

  it("prefetches /chat by importing ChatPage instead of docs or placeholder content", () => {
    expect(prefetchSource).toContain('"/chat": { importer: () => import("../ChatPage.js") }');
    expect(prefetchSource).not.toContain('"/chat": { importer: () => import("../docs-web/DocsWebPage.js")');
    expect(prefetchSource).not.toContain('"/chat": { importer: () => import("../docs');
  });

  it("keeps direct /chat refresh compatible with the extensionless SPA fallback", () => {
    expect(extname("/chat")).toBe("");
    expect(dashboardMiddlewareSource).toContain('const isExtensionless = path.extname(req.path) === "";');
    expect(dashboardMiddlewareSource).toContain("if (isGet && !isApi && isExtensionless && !isPreviewHost)");
    expect(dashboardMiddlewareSource).toContain("res.sendFile(indexPath");
  });
});
