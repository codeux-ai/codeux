import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");
const svgPath = join(projectRoot, "dashboard/public/logo.svg");
const buildDir = join(projectRoot, "build");

mkdirSync(buildDir, { recursive: true });

const { Resvg } = await import("@resvg/resvg-js");
const rawSvg = readFileSync(svgPath, "utf8");

const VB = 1254;
const RADIUS = Math.round(VB * 0.2);

const roundedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <defs><clipPath id="rc"><rect width="${VB}" height="${VB}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath></defs>
  <g clip-path="url(#rc)">${rawSvg}</g>
</svg>`;

for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  const resvg = new Resvg(roundedSvg, {
    fitTo: { mode: "width", value: size },
    background: "rgba(0,0,0,0)",
  });
  const png = resvg.render().asPng();
  writeFileSync(join(buildDir, `icon-${size}.png`), png);
  if (size === 1024) {
    writeFileSync(join(buildDir, "icon.png"), png);
  }
}

console.log("Generated electron icons in build/");
