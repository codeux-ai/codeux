import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const globalsCss = readFileSync(resolve(process.cwd(), "dashboard/src/v2/styles/globals.css"), "utf8");
const rootCss = readFileSync(resolve(process.cwd(), "dashboard/src/styles.css"), "utf8");

const extractBlock = (selector: string): string => {
  const match = globalsCss.match(new RegExp(`\\${selector} \\{([\\s\\S]*?)\\n  \\}`));
  if (!match?.[1]) {
    throw new Error(`Missing CSS block for ${selector}`);
  }
  return match[1];
};

const extractHexToken = (block: string, token: string): string => {
  const match = block.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6})`, "i"));
  if (!match?.[1]) {
    throw new Error(`Missing hex token --${token}`);
  }
  return match[1];
};

const luminance = (hex: string): number => {
  const channels = hex.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
};

const contrastRatio = (foreground: string, background: string): number => {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

describe("theme-aware link colors", () => {
  it("overrides Tailwind Typography links with the shared semantic tokens", () => {
    expect(rootCss).toMatch(/@layer utilities \{[\s\S]*\.prose:not\(\.not-prose\)/);
    expect(rootCss).toMatch(/\.prose:not\(\.not-prose\) \{\s*--tw-prose-links: var\(--link-text\);/);
    expect(rootCss).toMatch(/\.prose :where\(a\[href\]\):hover,[\s\S]*color: var\(--link-text-hover\);/);
    expect(rootCss).toMatch(/a \{\s*color: var\(--link-text\);/);
  });

  it("keeps dark-mode links at enhanced contrast on chat surfaces", () => {
    const darkTokens = extractBlock(".dark");
    const link = extractHexToken(darkTokens, "signal-300");
    const hover = extractHexToken(darkTokens, "signal-400");

    expect(darkTokens).toContain("--link-text: var(--signal-300);");
    expect(darkTokens).toContain("--link-text-hover: var(--signal-400);");
    for (const surface of ["#0e0c0a", "#181411"]) {
      expect(contrastRatio(link, surface)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(hover, surface)).toBeGreaterThanOrEqual(7);
    }
  });
});
