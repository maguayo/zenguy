import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const publicDir = new URL("../public/", import.meta.url);
const publicDirs = [publicDir, new URL("../../frontend/public/", import.meta.url)];
const svg = await readFile(new URL("favicon.svg", publicDir), "utf8");
const background = svg.match(/<rect\b[^>]*fill="([^"]+)"[^>]*\/>/u);
if (!background) throw new Error("Expected the logo's background rectangle in favicon.svg");

async function writeAsset(filename, data) {
  for (const directory of publicDirs) {
    await writeFile(new URL(filename, directory), data);
  }
}

// Both deployed origins must serve their own copy of every icon.
await writeAsset("favicon.svg", svg);

// Let iOS and Android apply their own corner masks to a full-bleed background.
// The Z and dot already fit inside the central 80%-diameter maskable safe zone.
const opaqueSvg = svg.replace(
  background[0],
  `<rect width="32" height="32" fill="${background[1]}" />`,
);

async function png(source, size) {
  return sharp(Buffer.from(source), { density: (72 * size * 4) / 32 })
    .resize(size, size)
    .png()
    .toBuffer();
}

const faviconSizes = [16, 32, 48];
const faviconPngs = [];
for (const size of faviconSizes) {
  const data = await png(svg, size);
  faviconPngs.push(data);
  await writeAsset(`favicon-${size}x${size}.png`, data);
}

// An ICO directory followed by its three lossless PNG frames.
const directory = Buffer.alloc(6 + faviconSizes.length * 16);
directory.writeUInt16LE(1, 2); // Image type: icon.
directory.writeUInt16LE(faviconSizes.length, 4);
let offset = directory.length;
for (const [index, size] of faviconSizes.entries()) {
  const entry = 6 + index * 16;
  directory.writeUInt8(size, entry);
  directory.writeUInt8(size, entry + 1);
  directory.writeUInt16LE(1, entry + 4); // Color planes.
  directory.writeUInt16LE(32, entry + 6); // Bits per pixel (RGBA).
  directory.writeUInt32LE(faviconPngs[index].length, entry + 8);
  directory.writeUInt32LE(offset, entry + 12);
  offset += faviconPngs[index].length;
}
await writeAsset("favicon.ico", Buffer.concat([directory, ...faviconPngs]));

for (const [filename, size, source] of [
  ["apple-touch-icon.png", 180, opaqueSvg],
  ["icon-192x192.png", 192, svg],
  ["icon-512x512.png", 512, svg],
  ["icon-maskable-512x512.png", 512, opaqueSvg],
]) {
  await writeAsset(filename, await png(source, size));
}

// Safari pinned tabs use only the mark, in black on a transparent background.
const mark = svg.replace(background[0], "").match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/u)[1];
const pinnedSvg = `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(-5 -5) scale(0.8)">
    ${mark.trim().replace(/#[0-9a-f]{6}/giu, "#000000")}
  </g>
</svg>
`;
await writeAsset("safari-pinned-tab.svg", pinnedSvg);

console.log("Generated favicons, home-screen icons and the Safari mask for the website and webapp.");
