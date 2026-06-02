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
const logoInnerSvg = rawSvg
  .replace(/^[\s\S]*?<svg\b[^>]*>/i, "")
  .replace(/<\/svg>\s*$/i, "");

const VB = 1254;
const RADIUS = Math.round(VB * 0.2);

const roundedSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${VB}" height="${VB}" viewBox="0 0 ${VB} ${VB}">
  <defs><clipPath id="rc"><rect width="${VB}" height="${VB}" rx="${RADIUS}" ry="${RADIUS}"/></clipPath></defs>
  <g clip-path="url(#rc)">${rawSvg}</g>
</svg>`;

const renderPng = (svg, width) => {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "rgba(0,0,0,0)",
  });
  return resvg.render().asPng();
};

const renderBitmap = (svg, width, height) => {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "#0D0F12",
  });
  const image = resvg.render();
  return {
    width,
    height,
    pixels: Buffer.from(image.pixels),
  };
};

const writeBmp = (filePath, image) => {
  const rowSize = Math.ceil((image.width * 3) / 4) * 4;
  const pixelDataSize = rowSize * image.height;
  const fileSize = 54 + pixelDataSize;
  const bmp = Buffer.alloc(fileSize);

  bmp.write("BM", 0);
  bmp.writeUInt32LE(fileSize, 2);
  bmp.writeUInt32LE(54, 10);
  bmp.writeUInt32LE(40, 14);
  bmp.writeInt32LE(image.width, 18);
  bmp.writeInt32LE(image.height, 22);
  bmp.writeUInt16LE(1, 26);
  bmp.writeUInt16LE(24, 28);
  bmp.writeUInt32LE(0, 30);
  bmp.writeUInt32LE(pixelDataSize, 34);
  bmp.writeInt32LE(2835, 38);
  bmp.writeInt32LE(2835, 42);

  for (let y = 0; y < image.height; y += 1) {
    const sourceY = image.height - 1 - y;
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < image.width; x += 1) {
      const sourceOffset = (sourceY * image.width + x) * 4;
      const targetOffset = rowOffset + x * 3;
      bmp[targetOffset] = image.pixels[sourceOffset + 2];
      bmp[targetOffset + 1] = image.pixels[sourceOffset + 1];
      bmp[targetOffset + 2] = image.pixels[sourceOffset];
    }
  }

  writeFileSync(filePath, bmp);
};

const writeIco = (filePath, pngEntries) => {
  const headerSize = 6;
  const directorySize = pngEntries.length * 16;
  let imageOffset = headerSize + directorySize;
  const ico = Buffer.alloc(imageOffset + pngEntries.reduce((total, entry) => total + entry.png.length, 0));

  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(pngEntries.length, 4);

  pngEntries.forEach((entry, index) => {
    const directoryOffset = headerSize + index * 16;
    ico[directoryOffset] = entry.size >= 256 ? 0 : entry.size;
    ico[directoryOffset + 1] = entry.size >= 256 ? 0 : entry.size;
    ico[directoryOffset + 2] = 0;
    ico[directoryOffset + 3] = 0;
    ico.writeUInt16LE(1, directoryOffset + 4);
    ico.writeUInt16LE(32, directoryOffset + 6);
    ico.writeUInt32LE(entry.png.length, directoryOffset + 8);
    ico.writeUInt32LE(imageOffset, directoryOffset + 12);
    entry.png.copy(ico, imageOffset);
    imageOffset += entry.png.length;
  });

  writeFileSync(filePath, ico);
};

const iconSizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const pngBySize = new Map();

for (const size of iconSizes) {
  const png = renderPng(roundedSvg, size);
  pngBySize.set(size, png);
  writeFileSync(join(buildDir, `icon-${size}.png`), png);
  if (size === 1024) {
    writeFileSync(join(buildDir, "icon.png"), png);
  }
}

writeIco(
  join(buildDir, "icon.ico"),
  [16, 24, 32, 48, 64, 128, 256].map((size) => ({
    size,
    png: pngBySize.get(size),
  })),
);

const installerSidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <rect width="164" height="314" fill="#0D0F12"/>
  <rect x="20" y="26" width="124" height="124" rx="28" fill="#050608"/>
  <g transform="translate(34 40) scale(${96 / VB})">${logoInnerSvg}</g>
  <rect x="20" y="178" width="68" height="4" rx="2" fill="#00E9A8"/>
  <rect x="20" y="194" width="102" height="2" rx="1" fill="#FCFBFC" opacity="0.72"/>
  <rect x="20" y="206" width="84" height="2" rx="1" fill="#FCFBFC" opacity="0.42"/>
</svg>`;

const installerHeaderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#0D0F12"/>
  <g transform="translate(6 6) scale(${45 / VB})">${logoInnerSvg}</g>
  <rect x="62" y="18" width="54" height="3" rx="1.5" fill="#00E9A8"/>
  <rect x="62" y="31" width="76" height="2" rx="1" fill="#FCFBFC" opacity="0.54"/>
</svg>`;

writeBmp(join(buildDir, "installerSidebar.bmp"), renderBitmap(installerSidebarSvg, 164, 314));
writeBmp(join(buildDir, "uninstallerSidebar.bmp"), renderBitmap(installerSidebarSvg, 164, 314));
writeBmp(join(buildDir, "installerHeader.bmp"), renderBitmap(installerHeaderSvg, 150, 57));

console.log("Generated electron icons and installer artwork in build/");
